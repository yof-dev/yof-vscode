/**
 * One problem, one finding (2026-11-07): the CLI's `alsoMatched` shows in the message, and its `filePrompts` become
 * one more quick fix, "Copy one fix prompt for all N problems in this file". An older CLI without them still works.
 */
import { describe, expect, it } from "vitest";
import { CheckOutputError, fileActionTitle, parseCheckJson, toDiagnostics, type CheckJson } from "../src/diagnostics";
import { acceptFingerprint } from "../src/accepted";

const MASKED = ["sk", "_live_", "FwIw", "••••••••"].join("");
const report = (over: Partial<CheckJson> = {}): CheckJson => ({
  tool: "yof", version: "0.2.0", profile: "balanced", offline: true,
  keys: [
    { file: "src/pay.ts", line: 1, column: 5, rule: "secret.stripe_live", name: "Stripe live secret key", severity: "fix_now", masked: MASKED, fixPrompt: "one", alsoMatched: ["secret.named_env"] },
    { file: "src/pay.ts", line: 3, column: 5, rule: "secret.github", name: "GitHub token", severity: "fix_now", masked: "ghp_ab••••", fixPrompt: "two" },
    { file: "src/one.ts", line: 1, column: 5, rule: "secret.stripe_test", name: "Stripe test secret key", severity: "fix_week", masked: "sk_test_ab••••", fixPrompt: "three" },
  ],
  packages: [],
  filePrompts: [{ file: "src/pay.ts", count: 2, prompt: "Fix these 2 problems in src/pay.ts together, so the file is edited once:" }],
  counts: { fix_now: 2, fix_week: 1, info: 0 }, failed: true,
  ...over,
});

describe("one finding, one fix prompt per file", () => {
  it("names the other rules that matched, in the message", () => {
    const d = toDiagnostics(parseCheckJson(JSON.stringify(report())));
    expect(d[0]!.message).toMatch(/Also matched: secret\.named_env\.$/);
    expect(d[1]!.message).not.toMatch(/Also matched/);
  });
  it("every diagnostic of a file with two or more problems carries the file's one prompt; others do not", () => {
    const d = toDiagnostics(report());
    expect(d.filter((x) => x.file === "src/pay.ts").every((x) => x.filePrompt?.startsWith("Fix these 2 problems") && x.fileCount === 2)).toBe(true);
    expect(d.find((x) => x.file === "src/one.ts")!.filePrompt).toBeUndefined();
    expect(d.map((x) => x.fixPrompt)).toEqual(["one", "two", "three"]);   // the single prompts stay
    expect(fileActionTitle(2)).toBe("yof: Copy one fix prompt for all 2 problems in this file");
  });
  it("an older CLI without filePrompts still maps; a broken filePrompts list is refused, never guessed at", () => {
    const { filePrompts: _drop, ...old } = report();
    expect(toDiagnostics(parseCheckJson(JSON.stringify(old))).every((x) => x.filePrompt === undefined)).toBe(true);
    expect(() => parseCheckJson(JSON.stringify({ ...report(), filePrompts: [{ file: 1 }] }))).toThrow(CheckOutputError);
  });
});

describe("accepted risks after grouping", () => {
  it("an acceptance made for a rule folded into this finding (same line) still applies; others do not", () => {
    const text = "const k = 'x';\n";
    const line = "const k = 'x';";
    const entry = (rule: string) => ({ rule, file: "src/pay.ts", fingerprint: acceptFingerprint(rule, "src/pay.ts", line), reason: "Fixture.", acceptedBy: "Sam", acceptedAt: "2026-11-07" });
    const d = toDiagnostics(report(), { readText: (f) => (f === "src/pay.ts" ? text : null), accepted: [entry("secret.named_env")] });
    expect(d[0]).toMatchObject({ level: "information", accepted: { reason: "Fixture." } });
    expect(d[0]!.fingerprint).toBe(acceptFingerprint("secret.stripe_live", "src/pay.ts", line));
    const none = toDiagnostics(report(), { readText: (f) => (f === "src/pay.ts" ? text : null), accepted: [entry("secret.github")] });
    expect(none[0]!.accepted).toBeUndefined();
  });
});
