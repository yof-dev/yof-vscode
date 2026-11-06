import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attackArgs, checkArgs, DEFAULTS, readSettings, SETTING_KEYS } from "../src/settings";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
const props = pkg.contributes.configuration.properties as Record<string, { default: unknown; enum?: unknown[] }>;

describe("settings", () => {
  it("every setting is contributed in package.json with the same default", () => {
    for (const [k, id] of Object.entries(SETTING_KEYS)) {
      expect(props[`yof.${id}`], id).toBeDefined();
      expect(props[`yof.${id}`]!.default, id).toEqual(DEFAULTS[k as keyof typeof DEFAULTS]);
    }
    expect(Object.keys(props).sort()).toEqual(Object.values(SETTING_KEYS).map((id) => `yof.${id}`).sort());
  });

  it("nothing set: the defaults (check on save, offline, the profile from .yof.yml, localhost)", () => {
    expect(readSettings(() => undefined)).toEqual(DEFAULTS);
    expect(DEFAULTS).toMatchObject({ checkOnSave: true, packageLookups: false, profile: "", attackTarget: "http://localhost:3000" });
  });

  it("values of the wrong type or outside their choices fall back to the default", () => {
    const s = readSettings((k) => ({ checkOnSave: "yes", packageLookups: 1, profile: "loud", "attack.mode": "everything", checkTimeoutSeconds: 99999, "attack.target": "  " } as Record<string, unknown>)[k]);
    expect(s).toMatchObject({ checkOnSave: true, packageLookups: false, profile: "", attackMode: "full", checkTimeoutSeconds: 600, attackTarget: "http://localhost:3000" });
    expect(readSettings((k) => (k === "checkTimeoutSeconds" ? 1 : undefined)).checkTimeoutSeconds).toBe(5);
  });

  it("check: always JSON, --offline unless package lookups are on, the profile when set", () => {
    expect(checkArgs(DEFAULTS)).toEqual(["check", ".", "--json", "--offline"]);
    expect(checkArgs({ ...DEFAULTS, packageLookups: true, profile: "strict" })).toEqual(["check", ".", "--json", "--profile", "strict"]);
  });

  it("attack: the target, config and mode from the settings, as JSON", () => {
    expect(attackArgs({ ...DEFAULTS, attackMode: "light" })).toEqual(["attack", "http://localhost:3000", "--config", ".yof/attack.json", "--mode", "light", "--json"]);
  });

  it("untrusted workspaces can't set the CLI path or the env file", () => {
    expect(pkg.capabilities.untrustedWorkspaces).toMatchObject({ supported: "limited", restrictedConfigurations: ["yof.cliPath", "yof.attack.envFile"] });
  });

  it("no telemetry: nothing in the extension's source talks to the network", () => {
    for (const f of ["extension.ts", "diagnostics.ts", "process.ts", "settings.ts", "attack.ts"]) {
      const src = readFileSync(join(__dirname, "..", "src", f), "utf8");
      expect(src, f).not.toMatch(/\bfetch\(|node:https?|node:net|XMLHttpRequest|telemetry\w*\.send|TelemetryReporter/);
    }
  });
});
