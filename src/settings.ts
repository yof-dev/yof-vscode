/**
 * The extension's settings, read through a getter so they are tested without VS Code. A value of the wrong type or
 * outside its choices falls back to the default; it is never guessed at.
 */
import type { Profile } from "./diagnostics";

export type AttackMode = "full" | "light";

export interface Settings {
  /** Run `yof check` when a file is saved. */
  checkOnSave: boolean;
  /** Package-registry lookups (npm, PyPI, OSV). Off by default: then the check makes no network call at all. */
  packageLookups: boolean;
  /** Empty: the profile in .yof.yml (balanced when there is none). */
  profile: Profile | "";
  /** A yof executable to run instead of the project's or the bundled one (trusted workspaces only). */
  cliPath: string;
  /** Seconds before a check is stopped. */
  checkTimeoutSeconds: number;
  attackTarget: string;
  attackConfig: string;
  attackMode: AttackMode;
  /** A KEY=VALUE file with the test accounts' variables; only names starting with YOF_ are read. Empty: none. */
  attackEnvFile: string;
}

export const DEFAULTS: Settings = {
  checkOnSave: true,
  packageLookups: false,
  profile: "",
  cliPath: "",
  checkTimeoutSeconds: 60,
  attackTarget: "http://localhost:3000",
  attackConfig: ".yof/attack.json",
  attackMode: "full",
  attackEnvFile: "",
};

/** The setting ids, as contributed in package.json (yof.<key>). */
export const SETTING_KEYS: Record<keyof Settings, string> = {
  checkOnSave: "checkOnSave",
  packageLookups: "packageLookups",
  profile: "profile",
  cliPath: "cliPath",
  checkTimeoutSeconds: "checkTimeoutSeconds",
  attackTarget: "attack.target",
  attackConfig: "attack.config",
  attackMode: "attack.mode",
  attackEnvFile: "attack.envFile",
};

export function readSettings(get: (key: string) => unknown): Settings {
  const bool = (k: keyof Settings) => { const v = get(SETTING_KEYS[k]); return typeof v === "boolean" ? v : (DEFAULTS[k] as boolean); };
  const text = (k: keyof Settings) => { const v = get(SETTING_KEYS[k]); return typeof v === "string" ? v.trim() : (DEFAULTS[k] as string); };
  const profile = get(SETTING_KEYS.profile);
  const mode = get(SETTING_KEYS.attackMode);
  const timeout = get(SETTING_KEYS.checkTimeoutSeconds);
  return {
    checkOnSave: bool("checkOnSave"),
    packageLookups: bool("packageLookups"),
    profile: profile === "relaxed" || profile === "balanced" || profile === "strict" ? profile : "",
    cliPath: text("cliPath"),
    checkTimeoutSeconds: typeof timeout === "number" && Number.isFinite(timeout) ? Math.min(600, Math.max(5, Math.round(timeout))) : DEFAULTS.checkTimeoutSeconds,
    attackTarget: text("attackTarget") || DEFAULTS.attackTarget,
    attackConfig: text("attackConfig") || DEFAULTS.attackConfig,
    attackMode: mode === "light" ? "light" : "full",
    attackEnvFile: text("attackEnvFile"),
  };
}

/** `yof check` for one workspace folder: always JSON, offline unless package lookups are turned on. */
export function checkArgs(s: Settings): string[] {
  const args = ["check", ".", "--json"];
  if (!s.packageLookups) args.push("--offline");
  if (s.profile) args.push("--profile", s.profile);
  return args;
}

/** `yof attack`: the address, the config and the mode from the settings. The CLI enforces every safety rule again. */
export function attackArgs(s: Settings): string[] {
  return ["attack", s.attackTarget, "--config", s.attackConfig, "--mode", s.attackMode, "--json"];
}
