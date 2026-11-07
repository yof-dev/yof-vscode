/**
 * 0.1.1 (2026-11-07): accepted risks in .yof/accepted.json, the buttons after a check, and the opt-in scan count.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptFingerprint, cleanReason, newEntry, parseAccepted, withEntry, withoutEntry } from "../src/accepted";
import { statusText, toDiagnostics, type CheckJson } from "../src/diagnostics";
import { combinedPrompt, nextStepLabel, nextSteps, nextStepUrl, ORDERING_OPEN } from "../src/next-steps";
import { SCAN_COUNT_PROMPT, editorOf, scanCountBody, sendScanCount, shouldAsk, shouldSend } from "../src/scan-count";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
// Fake key assembled at run time, so no file here holds a string that looks like a real key (the oss/ leak rules).
const FAKE = ["sk", "_live_", "x".repeat(20)].join("");
const LINE = `export const stripe = "${FAKE}";`;
const report = (): CheckJson => ({
  tool: "yof", version: "0.2.0", profile: "balanced", offline: true,
  keys: [{ file: "pay.ts", line: 1, column: 23, rule: "secret.stripe_live", name: "Stripe live secret key", severity: "fix_now", masked: `${FAKE.slice(0, 12)}••••`, fixPrompt: "Rotate the key." }],
  packages: [{ file: "package.json", name: "reqeusts-helper", ecosystem: "npm", issue: "made_up", severity: "fix_now", message: "It doesn't exist on npm.", fixPrompt: "Remove it." }],
  counts: { fix_now: 2, fix_week: 0, info: 0 }, failed: true,
});
const AT = "2026-11-07T10:00:00.000Z";

describe("accepted.json in the editor", () => {
  it("the same fingerprint recipe as the yof CLI and yof's reports", () => {
    const cli = readFileSync(join(__dirname, "..", "..", "yof", "src", "accepted.ts"), "utf8");
    expect(cli).toContain("yof-accept/1\\n${rule}\\n${file.replace(/\\\\/g, \"/\")}\\n${content.trim()}");
    expect(read("src/accepted.ts")).toContain("yof-accept/1\\n${rule}\\n${file.replace(/\\\\/g, \"/\")}\\n${content.trim()}");
  });
  it("an accepted finding becomes information with the reason and leaves the open count; a changed line is open again", () => {
    const fp = acceptFingerprint("secret.stripe_live", "pay.ts", LINE);
    const accepted = parseAccepted(withEntry(null, { rule: "secret.stripe_live", file: "pay.ts", fingerprint: fp, reason: "Revoked key in a fixture", acceptedBy: "Ada", acceptedAt: AT }));
    const files: Record<string, string> = { "pay.ts": `${LINE}\n`, "package.json": '{ "dependencies": { "reqeusts-helper": "1.0.0" } }' };
    const d = toDiagnostics(report(), { readText: (f) => files[f] ?? null, accepted });
    const key = d.find((x) => x.code === "secret.stripe_live")!;
    expect(key.level).toBe("information");
    expect(key.accepted).toEqual({ reason: "Revoked key in a fixture", acceptedBy: "Ada", acceptedAt: AT });
    expect(key.message).toMatch(/^Accepted by Ada on 2026-11-07: Revoked key in a fixture\. Stripe live secret key/);
    expect(statusText(d)).toBe("yof: 1 fix now, 1 accepted");
    const changed = toDiagnostics(report(), { readText: (f) => (f === "pay.ts" ? `${LINE.replace("stripe", "stripeKey")}\n` : files[f] ?? null), accepted });
    expect(changed.find((x) => x.code === "secret.stripe_live")!.level).toBe("error");
    expect(statusText(changed)).toBe("yof: 2 fix now");
  });
  it("a package finding is accepted by its ecosystem and name", () => {
    const fp = acceptFingerprint("package.made_up", "package.json", "npm:reqeusts-helper");
    const accepted = parseAccepted(withEntry(null, { rule: "package.made_up", file: "package.json", fingerprint: fp, reason: "Our private package", acceptedBy: "Ada", acceptedAt: AT }));
    const d = toDiagnostics(report(), { readText: () => null, accepted });
    expect(d.find((x) => x.code === "package.made_up")!.accepted?.reason).toBe("Our private package");
  });
  it("a reason is required, one to 300 characters; reopen removes the entry; bad files are ignored", () => {
    expect(cleanReason("  ")).toBeNull();
    expect(cleanReason("x".repeat(301))).toBeNull();
    expect(cleanReason(" Test key only. ")).toBe("Test key only.");
    const e = newEntry({ code: "secret.stripe_live", file: "pay.ts", fingerprint: "a".repeat(32) }, "Fine", "Ada", new Date(AT));
    expect(e).toEqual({ rule: "secret.stripe_live", file: "pay.ts", fingerprint: "a".repeat(32), reason: "Fine", acceptedBy: "Ada", acceptedAt: AT });
    expect(parseAccepted(withoutEntry(withEntry(null, e), e.fingerprint))).toEqual([]);
    expect(parseAccepted("{oops")).toEqual([]);
  });
  it("the commands and the quick fix are contributed and wired", () => {
    const ids = pkg.contributes.commands.map((c: { command: string }) => c.command);
    for (const id of ["yof.acceptRisk", "yof.reopenRisk", "yof.signedReport", "yof.turnOnPatch"]) expect(ids).toContain(id);
    const ext = read("src/extension.ts");
    expect(ext).toContain('"yof: Accept this risk…"');
    expect(ext).toContain('"yof: Reopen accepted risk"');
    expect(ext).toMatch(/execFile\("git", \["config", "user\.name"\]/);
  });
});

describe("after a check: the next steps", () => {
  it("say '(opens soon)' while ordering is closed and only open app.yof.io pages", () => {
    expect(ORDERING_OPEN).toBe(false);
    expect(nextStepLabel("signedReport")).toBe("Get a signed report (opens soon)");
    expect(nextStepLabel("patch")).toBe("Turn on Patch (opens soon)");
    expect(nextStepLabel("patch", true)).toBe("Turn on Patch");
    expect(nextStepUrl("signedReport")).toBe("https://app.yof.io/yof/orders");
    expect(nextStepUrl("patch")).toBe("https://app.yof.io/yof/patch");
    expect(nextSteps(0)).toEqual(["signedReport", "patch"]);
    expect(nextSteps(2)).toEqual(["copyPrompts", "signedReport", "patch"]);
  });
  it("Copy fix prompt joins every open finding's prompt", () => {
    expect(combinedPrompt(["One."])).toBe("One.");
    expect(combinedPrompt(["One.", "", "Two."])).toBe("yof found 2 problems. Fix them one by one:\n\n1. One.\n\n2. Two.");
  });
  it("no network call for them: the extension opens the address with openExternal only", () => {
    const ext = read("src/extension.ts");
    expect(ext).toContain("vscode.env.openExternal(vscode.Uri.parse(nextStepUrl(step)))");
    expect((ext.match(/fetch\(/g) ?? []).length).toBe(0);
  });
});

describe("opt-in scan count", () => {
  it("off by default, an application-wide setting, and never while the editor's telemetry is off", () => {
    expect(pkg.contributes.configuration.properties["yof.shareScanCount"]).toMatchObject({ type: "boolean", default: false, scope: "application" });
    expect(shouldSend({ optedIn: false, telemetryEnabled: true })).toBe(false);
    expect(shouldSend({ optedIn: true, telemetryEnabled: false })).toBe(false);
    expect(shouldSend({ optedIn: true, telemetryEnabled: true })).toBe(true);
    expect(shouldAsk({ asked: false, optedIn: false, telemetryEnabled: false })).toBe(false);
    expect(shouldAsk({ asked: true, optedIn: false, telemetryEnabled: true })).toBe(false);
    expect(shouldAsk({ asked: false, optedIn: false, telemetryEnabled: true })).toBe(true);
    expect(read("src/extension.ts")).toContain("vscode.env.isTelemetryEnabled");
  });
  it("asks in the owner's words and sends exactly four fields", async () => {
    expect(SCAN_COUNT_PROMPT).toBe("Help yof count scans? It sends only 'a scan finished' and the extension version: no code, file names or paths.");
    expect(scanCountBody("0.1.1", "Cursor", new Date(AT))).toEqual({ event: "scan_finished", version: "0.1.1", editor: "cursor", day: "2026-11-07" });
    expect(scanCountBody("not a version", "Visual Studio Code", new Date(AT)).version).toBe("0.0.0");
    for (const [n, e] of [["Visual Studio Code", "vscode"], ["Windsurf", "windsurf"], ["VSCodium", "vscodium"], ["Something", "other"]] as const) expect(editorOf(n)).toBe(e);
    const sent: { url: string; body: string }[] = [];
    const fetch = async (url: string, init: { body: string }) => { sent.push({ url, body: init.body }); return {}; };
    expect(await sendScanCount({ optedIn: false, telemetryEnabled: true, version: "0.1.1", fetch })).toBe(false);
    expect(await sendScanCount({ optedIn: true, telemetryEnabled: true, version: "0.1.1", appName: "Cursor", fetch, now: new Date(AT) })).toBe(true);
    expect(sent).toEqual([{ url: "https://api.mondaily.com/api/v1/public/yof-scan-count", body: '{"event":"scan_finished","version":"0.1.1","editor":"cursor","day":"2026-11-07"}' }]);
    expect(await sendScanCount({ optedIn: true, telemetryEnabled: true, version: "0.1.1", fetch: async () => { throw new Error("offline"); } })).toBe(false);
  });
  it("the listing says so honestly, and the title names no other product", () => {
    expect(pkg.version).toBe("0.1.1");
    expect(pkg.displayName).toBe("yof");
    expect(pkg.description).toMatch(/no telemetry unless you opt in/i);
    for (const w of ["Cursor", "Windsurf", "AI builders", "secrets", "SBOM", "fix prompt"]) expect(pkg.description).toContain(w);
    expect(read("README.md")).toMatch(/## Privacy[\s\S]*No telemetry unless you opt in/);
    expect(read("CHANGELOG.md")).toMatch(/## 0\.1\.1/);
  });
});
