/**
 * Cancelling yof attack from the editor: SIGTERM first, so the CLI can delete its test records and exit; SIGKILL only
 * when it is still running after the grace period, and only then the "records may be left" warning.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ATTACK_STOP_GRACE_MS, stoppedText } from "../src/attack";
import { LatestRunner, runCli, type CliCommand } from "../src/process";

const node: CliCommand = { command: process.execPath, prefix: [], env: {}, source: "bundled" };
const cwd = tmpdir();
// Each child writes a "ready" file once its SIGTERM handler is installed, so the cancel never races its start.
const readyFile = () => join(mkdtempSync(join(tmpdir(), "yof-cancel-")), "ready");
// Stands in for the CLI: on SIGTERM it "cleans up" for a moment, says so on stderr and exits 143.
const POLITE = (ready: string) => ["-e", `
  process.on("SIGTERM", () => setTimeout(() => { process.stderr.write("yof attack: stopped. Deleted all 3 test records it created.\\n"); process.exit(143); }, 150));
  require("fs").writeFileSync(${JSON.stringify(ready)}, "1");
  setInterval(() => {}, 1000);
`];
// Ignores SIGTERM (a stuck run).
const STUCK = (ready: string) => ["-e", `process.on("SIGTERM", () => {}); require("fs").writeFileSync(${JSON.stringify(ready)}, "1"); setInterval(() => {}, 1000);`];

async function untilReady(file: string) {
  for (let i = 0; i < 200 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 25));
}

/** Starts a run and cancels it once the child is listening for signals. */
async function cancelAfterReady(child: (ready: string) => string[], graceMs: number) {
  const signals: string[] = [];
  const ctl = new AbortController();
  const ready = readyFile();
  const pending = runCli(node, child(ready), { cwd, signal: ctl.signal, timeoutMs: 60_000, graceMs, onSignal: (s) => signals.push(s) });
  await untilReady(ready);
  ctl.abort();
  const t0 = performance.now();
  const r = await pending;
  return { r, signals, ms: performance.now() - t0 };
}

describe("cancel sends SIGTERM first", () => {
  it("a CLI that cleans up gets SIGTERM only, its exit code and its clean-up line are kept", async () => {
    const { r, signals } = await cancelAfterReady(POLITE, 5_000);
    expect(signals).toEqual(["SIGTERM"]);
    expect(r).toMatchObject({ cancelled: true, forced: false, code: 143 });
    expect(stoppedText(r)).toBe("yof attack stopped. Deleted all 3 test records it created.");
  });

  it("a run that ignores SIGTERM is killed after the grace period, and only then the warning shows", async () => {
    const { r, signals, ms } = await cancelAfterReady(STUCK, 300);
    expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(r).toMatchObject({ cancelled: true, forced: true });
    expect(ms).toBeGreaterThanOrEqual(250);
    expect(ms).toBeLessThan(5_000);
    expect(stoppedText(r)).toMatch(/did not stop in time and was ended\. Test records it had created may still be there/);
  });

  it("the attack waits for the CLI's own clean-up deadline (10 s) before killing", () => {
    expect(ATTACK_STOP_GRACE_MS).toBeGreaterThan(10_000);
  });

  it("the attack keeps a cancelled run's result (LatestRunner keepCancelled); a check still drops it", async () => {
    const runner = new LatestRunner();
    const r1 = readyFile();
    const kept = runner.run((signal) => runCli(node, POLITE(r1), { cwd, signal, timeoutMs: 60_000, graceMs: 5_000 }), { keepCancelled: true });
    await untilReady(r1);
    runner.cancel();
    expect((await kept)?.code).toBe(143);
    const r2 = readyFile();
    const dropped = runner.run((signal) => runCli(node, POLITE(r2), { cwd, signal, timeoutMs: 60_000, graceMs: 5_000 }));
    await untilReady(r2);
    runner.cancel();
    expect(await dropped).toBeNull();
  });

  it("the stop text reports records left by route, from the CLI's lines", () => {
    const stderr = "yof attack: stopping. Deleting the test records this run created (send the signal again to quit at once).\nTest records: 2 deleted, 1 left.\n  Not deleted (delete them in your app; they hold this run's yof marker text): /api/notes/{id}\n";
    expect(stoppedText({ forced: false, stderr })).toBe("yof attack stopped. Test records: 2 deleted, 1 left. Not deleted (delete them in your app; they hold this run's yof marker text): /api/notes/{id}");
    expect(stoppedText({ forced: false, stderr: "" })).toBe("yof attack stopped.");
  });
});
