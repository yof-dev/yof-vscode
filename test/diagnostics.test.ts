import { describe, expect, it } from "vitest";
import { CheckOutputError, findDependencyLine, keySpan, parseCheckJson, statusText, toDiagnostics, visibleIn, type CheckJson } from "../src/diagnostics";

// The shape `yof check --json` prints (0.2.0), with masked values only, as the CLI prints them.
const MASKED = ["sk", "_live_", "FwIw", "••••••••"].join("");
function report(over: Partial<CheckJson> = {}): CheckJson {
  return {
    tool: "yof", version: "0.2.0", profile: "balanced", offline: true,
    keys: [
      { file: "src/config.ts", line: 3, column: 24, rule: "secret.stripe_live", name: "Stripe live secret key", severity: "fix_now", masked: MASKED,
        why: "Anyone can use it to take payments, give refunds and read your customers' payment details.", fixPrompt: `yof found this. The value starts like this (shortened on purpose): ${MASKED}` },
      { file: "src/web.ts", line: 1, column: 1, rule: "public.stripe_publishable", name: "Stripe publishable key (public by design)", severity: "info", masked: "pk_live_ab••••" },
      { file: "src\\win.ts", line: 2, column: 5, rule: "secret.stripe_test", name: "Stripe test secret key", severity: "fix_week", masked: "sk_test_ab••••" },
    ],
    packages: [
      { file: "package.json", name: "reqeusts-helper", ecosystem: "npm", issue: "made_up", severity: "fix_now",
        message: "This package doesn't exist on npm.", why: "This package doesn't exist on npm.", fixPrompt: "Do not invent a package name." },
      { file: "requirements.txt", name: "reqests", ecosystem: "pypi", issue: "lookalike", severity: "fix_week", message: "One or two letters away from requests.", version: "2.0.0" },
    ],
    counts: { fix_now: 2, fix_week: 2, info: 1 }, failed: true,
    ...over,
  };
}

const files: Record<string, string> = {
  "src/config.ts": `// config\n\nexport const stripe = "${["sk", "_live_", "x".repeat(24)].join("")}";\n`,
  "package.json": `{\n  "dependencies": {\n    "react": "^18",\n    "reqeusts-helper": "^1.0.0"\n  }\n}\n`,
  "requirements.txt": "requests==2.0.0\nreqests==2.0.0\n",
};
const readText = (f: string) => files[f] ?? null;

describe("parseCheckJson", () => {
  it("accepts the CLI's JSON", () => {
    expect(parseCheckJson(JSON.stringify(report())).keys).toHaveLength(3);
  });
  it("refuses text that is not JSON, or JSON of another shape, instead of guessing", () => {
    expect(() => parseCheckJson("yof checked 2 files")).toThrow(CheckOutputError);
    expect(() => parseCheckJson(JSON.stringify({ tool: "other", keys: [], packages: [], counts: {} }))).toThrow(CheckOutputError);
    expect(() => parseCheckJson(JSON.stringify({ ...report(), profile: "loud" }))).toThrow(/profile/);
    expect(() => parseCheckJson(JSON.stringify({ ...report(), keys: [{ file: "a", line: -1 }] }))).toThrow(/key finding/);
    expect(() => parseCheckJson(JSON.stringify({ ...report(), packages: [{ file: "a", name: "b", issue: "made_up", message: "m", severity: "info" }] }))).toThrow(/package finding/);
  });
});

describe("toDiagnostics", () => {
  const diags = toDiagnostics(report(), { readText });

  it("maps urgency to the editor's levels and hides what the profile hides (balanced: no info)", () => {
    expect(diags.map((d) => [d.code, d.level])).toEqual([
      ["secret.stripe_live", "error"], ["secret.stripe_test", "warning"], ["package.made_up", "error"], ["package.lookalike", "warning"],
    ]);
    expect(toDiagnostics(report(), { profile: "strict" }).some((d) => d.level === "information")).toBe(true);
    expect(toDiagnostics(report(), { profile: "relaxed" }).every((d) => d.level === "error")).toBe(true);
  });

  it("a key: 0-based line, the whole key underlined, masked value and the CLI's plain words", () => {
    const k = diags[0]!;
    expect(k).toMatchObject({ file: "src/config.ts", line: 2, startColumn: 23, endColumn: 23 + 32 });
    expect(k.message).toBe(`Stripe live secret key (fix now): ${MASKED}. Anyone can use it to take payments, give refunds and read your customers' payment details.`);
    expect(k.fixPrompt).toContain(MASKED);
  });

  it("never carries a full key: only what the CLI sent", () => {
    const full = ["sk", "_live_", "x".repeat(24)].join("");
    for (const d of diags) { expect(d.message.includes(full)).toBe(false); expect(d.fixPrompt.includes(full)).toBe(false); }
  });

  it("a package points at its line in the manifest; Windows paths become forward slashes", () => {
    expect(diags[2]).toMatchObject({ file: "package.json", line: 3, startColumn: 5, endColumn: 5 + "reqeusts-helper".length, fixPrompt: "Do not invent a package name." });
    expect(diags[3]).toMatchObject({ file: "requirements.txt", line: 1, startColumn: 0 });
    expect(diags[3]!.message).toBe("reqests@2.0.0 (PyPI, fix this week): One or two letters away from requests.");
    expect(diags[1]!.file).toBe("src/win.ts");
  });

  it("without the file text it still places every finding (key at its column, package on line 0)", () => {
    const bare = toDiagnostics(report());
    expect(bare[0]).toMatchObject({ line: 2, startColumn: 23, endColumn: 23 + "sk_live_FwIw".length });
    expect(bare[2]).toMatchObject({ line: 0, startColumn: 0, endColumn: 1 });
  });
});

describe("helpers", () => {
  it("visibleIn matches the CLI's profiles", () => {
    expect([visibleIn("relaxed", "fix_week"), visibleIn("balanced", "fix_week"), visibleIn("balanced", "info"), visibleIn("strict", "info")]).toEqual([false, true, false, true]);
  });
  it("findDependencyLine matches whole names only", () => {
    expect(findDependencyLine('"react-dom": "1",\n"react": "1"', "react")).toEqual({ line: 1, start: 1, end: 6 });
    expect(findDependencyLine("nothing here", "react")).toBeNull();
  });
  it("keySpan stops at the closing quote", () => {
    expect(keySpan('x = "abc_def";', 6, "abc_••")).toEqual({ start: 5, end: 12 });
  });
  it("the status bar shows counts only, never a date", () => {
    expect(statusText([])).toBe("yof: nothing to fix");
    const text = statusText(toDiagnostics(report()));
    expect(text).toBe("yof: 2 fix now, 2 this week");
    expect(text).not.toMatch(/\d{4}-\d{2}|ago|today/);
  });
});
