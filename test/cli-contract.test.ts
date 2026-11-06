/**
 * The real contract: the bundled CLI (dist/yof-cli.cjs, made by `npm run build`) run the way the extension runs it,
 * its JSON mapped to diagnostics. Skipped before the first build.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCheckJson, toDiagnostics } from "../src/diagnostics";
import { resolveCli, runCli } from "../src/process";
import { checkArgs, DEFAULTS } from "../src/settings";

const bundled = join(__dirname, "..", "dist", "yof-cli.cjs");
const rand = (n: number) => Array.from({ length: n }, (_, i) => "abcdefghijkLMNOPQRSTuvwxyz0123456789"[(i * 7 + 3) % 36]).join("");

describe.skipIf(!existsSync(bundled))("the bundled CLI, run like the extension runs it", () => {
  it("offline check: a fake key becomes an error diagnostic with the plain words and a masked prompt", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yof-vscode-"));
    const key = ["sk", "_live_", rand(28)].join("");
    writeFileSync(join(dir, "pay.ts"), `export const stripe = "${key}";\n`);
    const cli = resolveCli({ cliPath: "", folder: dir, trusted: false, bundledScript: bundled, execPath: process.execPath });
    const r = await runCli(cli, checkArgs(DEFAULTS), { cwd: dir, timeoutMs: 30_000 });
    expect(r.code).toBe(1);
    expect(r.stdout.includes(key)).toBe(false);
    const report = parseCheckJson(r.stdout);
    expect(report.offline).toBe(true);
    const [d] = toDiagnostics(report, { readText: () => `export const stripe = "${key}";\n` });
    expect(d).toMatchObject({ file: "pay.ts", line: 0, startColumn: 23, endColumn: 23 + key.length, level: "error", code: "secret.stripe_live" });
    expect(d!.message).toMatch(/^Stripe live secret key \(fix now\): sk_live_\S+\. Anyone can use it to take payments/);
    expect(d!.fixPrompt).toMatch(/Where: pay\.ts, line 1\./);
    expect(d!.fixPrompt.includes(key)).toBe(false);
  });
});
