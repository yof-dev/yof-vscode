import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LatestRunner, resolveCli, runCli, type CliCommand } from "../src/process";

// Plain Node stands in for the CLI: the same child-process path the extension uses.
const node: CliCommand = { command: process.execPath, prefix: [], env: {}, source: "bundled" };
const cwd = tmpdir();
const SLOW = ["-e", "setTimeout(() => process.stdout.write('late'), 30000)"];

describe("runCli never blocks and always ends", () => {
  it("returns at once: the call is asynchronous, the work happens in a child process", async () => {
    const t0 = performance.now();
    const pending = runCli(node, ["-e", "process.stdout.write(JSON.stringify({ok:true})); process.exit(1)"], { cwd, timeoutMs: 10_000 });
    expect(performance.now() - t0).toBeLessThan(200);
    const r = await pending;
    expect(r).toMatchObject({ code: 1, stdout: '{"ok":true}', cancelled: false, timedOut: false });
  });

  it("cancelling kills the process and resolves quickly, with its output ignored", async () => {
    const ctl = new AbortController();
    const t0 = performance.now();
    const pending = runCli(node, SLOW, { cwd, signal: ctl.signal, timeoutMs: 60_000 });
    setTimeout(() => ctl.abort(), 100);
    const r = await pending;
    expect(r.cancelled).toBe(true);
    expect(r.stdout).toBe("");
    expect(performance.now() - t0).toBeLessThan(5_000);
  });

  it("a hard time limit stops a run that hangs", async () => {
    const r = await runCli(node, SLOW, { cwd, timeoutMs: 200 });
    expect(r).toMatchObject({ cancelled: true, timedOut: true });
  });

  it("an already-cancelled signal starts nothing", async () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(await runCli(node, SLOW, { cwd, signal: ctl.signal, timeoutMs: 60_000 })).toMatchObject({ code: null, cancelled: true });
  });

  it("a missing executable resolves with the error instead of throwing", async () => {
    const r = await runCli({ ...node, command: join(cwd, "no-such-yof-binary") }, ["check"], { cwd, timeoutMs: 5_000 });
    expect(r.code).toBeNull();
    expect(r.stderr).toMatch(/ENOENT/);
  });

  it("passes the extra environment (ELECTRON_RUN_AS_NODE for the bundled CLI, YOF_ test accounts for an attack)", async () => {
    const r = await runCli({ ...node, env: { ELECTRON_RUN_AS_NODE: "1" } }, ["-e", "process.stdout.write([process.env.ELECTRON_RUN_AS_NODE, process.env.YOF_ATTACK_A, process.env.NO_COLOR].join(','))"], { cwd, timeoutMs: 10_000, env: { YOF_ATTACK_A: "t" } });
    expect(r.stdout).toBe("1,t,1");
  });
});

describe("LatestRunner: a newer save cancels the older check", () => {
  it("the first run is replaced (null) and its process is killed; the second one's result comes back", async () => {
    const runner = new LatestRunner();
    const first = runner.run((signal) => runCli(node, SLOW, { cwd, signal, timeoutMs: 60_000 }));
    const second = runner.run((signal) => runCli(node, ["-e", "process.stdout.write('new')"], { cwd, signal, timeoutMs: 10_000 }));
    expect(await first).toBeNull();
    expect((await second)?.stdout).toBe("new");
    expect(runner.busy).toBe(false);
  });

  it("cancel() stops the current run", async () => {
    const runner = new LatestRunner();
    const run = runner.run((signal) => runCli(node, SLOW, { cwd, signal, timeoutMs: 60_000 }));
    expect(runner.busy).toBe(true);
    runner.cancel();
    expect(await run).toBeNull();
  });
});

describe("resolveCli: which yof runs", () => {
  const base = { cliPath: "", folder: "/w", bundledScript: "/ext/dist/yof-cli.cjs", execPath: "/editor", platform: "linux" as const };
  it("trusted: the setting first, then the project's own yof, then the bundled copy", () => {
    expect(resolveCli({ ...base, cliPath: "/usr/local/bin/yof", trusted: true, exists: () => true }).source).toBe("setting");
    expect(resolveCli({ ...base, trusted: true, exists: (p) => p === "/w/node_modules/.bin/yof" })).toMatchObject({ source: "workspace", command: "/w/node_modules/.bin/yof" });
    expect(resolveCli({ ...base, trusted: true, exists: () => false })).toEqual({ command: "/editor", prefix: ["/ext/dist/yof-cli.cjs"], env: { ELECTRON_RUN_AS_NODE: "1" }, source: "bundled" });
  });
  it("untrusted: only the bundled copy, never a program from the workspace or a setting", () => {
    expect(resolveCli({ ...base, cliPath: "/evil", trusted: false, exists: () => true }).source).toBe("bundled");
  });
  it("Windows uses yof.cmd", () => {
    expect(resolveCli({ ...base, platform: "win32", trusted: true, exists: (p) => p.endsWith("yof.cmd") }).source).toBe("workspace");
  });
});
