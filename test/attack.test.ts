import { describe, expect, it } from "vitest";
import { confirmText, consentText, parseEnvFile, preflight, summarizeAttack } from "../src/attack";
import { checkVsix } from "../scripts/check-vsix.mjs";

describe("attack preflight", () => {
  const ok = JSON.stringify({ app: "localhost:3000", consent: consentText("localhost:3000") });
  it("needs the config, valid JSON, the app and the consent sentence word for word", () => {
    expect(preflight(null, ".yof/attack.json")).toMatchObject({ ok: false, reason: expect.stringMatching(/There is no \.yof\/attack\.json yet/) });
    expect(preflight("{", ".yof/attack.json")).toMatchObject({ ok: false });
    expect(preflight(JSON.stringify({ consent: "yes" }), "c")).toMatchObject({ ok: false, reason: expect.stringMatching(/name your app/) });
    expect(preflight(JSON.stringify({ app: "localhost:3000", consent: "sure" }), "c")).toMatchObject({ ok: false, reason: expect.stringContaining(consentText("localhost:3000")) });
    expect(preflight(ok, "c")).toEqual({ ok: true, app: "localhost:3000", consent: consentText("localhost:3000") });
  });
  it("the question names the address, the config and what the mode does", () => {
    expect(confirmText("http://localhost:3000", ".yof/attack.json", "light")).toBe("yof attack will send read-only requests to http://localhost:3000, signed in as the test accounts named in .yof/attack.json. Start it?");
    expect(confirmText("http://localhost:3000", "c", "full")).toMatch(/test records it creates and deletes again/);
  });
  it("only YOF_ variables are read from the env file", () => {
    expect(parseEnvFile("YOF_ATTACK_A=Bearer a\nexport YOF_ATTACK_B=\"Bearer b\"\nDATABASE_PASSWORD=x\n# YOF_C=1\n")).toEqual({ YOF_ATTACK_A: "Bearer a", YOF_ATTACK_B: "Bearer b" });
  });
  it("the summary says what was found, and never claims safety when nothing was", () => {
    const found = summarizeAttack({ target: { host: "localhost" }, mode: "full", requests: 40, findings: [{ title: "Another account can read this record", severity: "fix_now", method: "GET", route: "/api/notes/{id}", as: "b", evidence: "200" }] });
    expect(found.headline).toBe("yof attack found 1 problem, 1 to fix now.");
    expect(found.lines).toContain("    GET /api/notes/{id} as account b: 200");
    expect(summarizeAttack({ findings: [] }).headline).toMatch(/not that nothing can go wrong/);
  });
});

describe("check-vsix", () => {
  const entry = (name: string, text = "x") => ({ name, data: Buffer.from(text) });
  const good = [
    entry("[Content_Types].xml"), entry("extension.vsixmanifest"),
    entry("extension/package.json", JSON.stringify({ license: "Apache-2.0" })), entry("extension/README.md"), entry("extension/LICENSE.txt"),
    entry("extension/dist/extension.js"), entry("extension/dist/yof-cli.cjs", "rules mention sk_live_ and ghp_ prefixes only"),
  ];
  it("passes the expected files", () => { expect(checkVsix(good)).toEqual([]); });
  it("refuses source, tests, node_modules and env files, and key-shaped text", () => {
    const bad = [...good, entry("extension/src/extension.ts"), entry("extension/test/a.test.ts"), entry("extension/node_modules/x/index.js"), entry("extension/.env"),
      entry("extension/CHANGELOG.md", ["sk", "_live_", "A".repeat(24)].join(""))];
    const p = checkVsix(bad);
    expect(p.filter((x: string) => x.startsWith("unexpected file"))).toHaveLength(4);
    expect(p.some((x: string) => x.includes("shaped like a real key"))).toBe(true);
  });
  it("needs the licence and a self-contained bundle", () => {
    expect(checkVsix(good.filter((e) => e.name !== "extension/LICENSE.txt"))).toContain("missing: LICENSE");
    expect(checkVsix(good.map((e) => (e.name === "extension/package.json" ? entry(e.name, JSON.stringify({ license: "MIT", dependencies: { a: "1" } })) : e))).length).toBe(2);
  });
});
