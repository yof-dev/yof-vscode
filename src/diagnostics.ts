/**
 * `yof check --json` in, plain diagnostics out. No VS Code import here, so the mapping is tested on its own and the
 * same rules can serve other editors.
 *
 * The words come from the CLI as they are: `why` (what can happen) and `fixPrompt` (what to paste into the AI
 * assistant). Nothing is rewritten here, and a value is only ever the masked one the CLI prints.
 */

import { acceptFingerprint, type AcceptedEntry } from "./accepted";

export type Severity = "fix_now" | "fix_week" | "info";
export type Profile = "relaxed" | "balanced" | "strict";
export type DiagnosticLevel = "error" | "warning" | "information";

export interface KeyJson {
  file: string; line: number; column: number; rule: string; name: string; severity: Severity; masked: string;
  why?: string; fixPrompt?: string;
  /** Other rules that caught the same value (CLI 2026-11-07): one finding, named here. */
  alsoMatched?: string[];
}
/** One combined prompt for every problem in one file (CLI 2026-11-07), for files with two or more. */
export interface FilePromptJson { file: string; count: number; prompt: string }
export interface PackageJson {
  file: string; name: string; ecosystem: "npm" | "pypi"; issue: string; severity: "fix_now" | "fix_week"; message: string;
  version?: string; why?: string; fixPrompt?: string;
}
export interface CheckJson {
  tool: "yof"; version: string; profile: Profile; offline: boolean;
  keys: KeyJson[]; packages: PackageJson[];
  /** Absent from a CLI older than 2026-11-07. */
  filePrompts?: FilePromptJson[];
  counts: { fix_now: number; fix_week: number; info: number };
  failed: boolean;
}

export interface PlainDiagnostic {
  /** Relative to the folder that was checked, with forward slashes. */
  file: string;
  /** 0-based. */
  line: number;
  startColumn: number;
  endColumn: number;
  level: DiagnosticLevel;
  /** The rule id, like secret.stripe_live or package.made_up. */
  code: string;
  message: string;
  /** Ready to paste into an AI assistant; empty when the CLI sent none. */
  fixPrompt: string;
  /** The .yof/accepted.json fingerprint of this finding (src/accepted.ts). */
  fingerprint: string;
  /** Set when .yof/accepted.json accepts it: shown as information with the reason, not counted as open. */
  accepted?: { reason: string; acceptedBy: string; acceptedAt: string };
  /** One prompt for every problem in this file, and how many it covers; only when the file has two or more. */
  filePrompt?: string;
  fileCount?: number;
}

export class CheckOutputError extends Error {}

const LABEL: Record<Severity, string> = { fix_now: "fix now", fix_week: "fix this week", info: "fine, public by design" };
const LEVEL: Record<Severity, DiagnosticLevel> = { fix_now: "error", fix_week: "warning", info: "information" };
const SEVERITIES = new Set<string>(["fix_now", "fix_week", "info"]);
const PROFILES = new Set<string>(["relaxed", "balanced", "strict"]);

/** Which findings a profile shows: the same rule as the CLI's text output. */
export const visibleIn = (profile: Profile, severity: Severity) =>
  profile === "strict" ? true : profile === "balanced" ? severity !== "info" : severity === "fix_now";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Parses and checks the CLI's JSON. Anything off shape is an error, never a guess. */
export function parseCheckJson(text: string): CheckJson {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new CheckOutputError("yof did not print JSON. Is the yof CLI 0.2.0 or newer?"); }
  if (!isObj(raw) || raw.tool !== "yof" || !Array.isArray(raw.keys) || !Array.isArray(raw.packages) || !isObj(raw.counts)) {
    throw new CheckOutputError("yof printed JSON in a shape this extension does not know.");
  }
  if (!isStr(raw.profile) || !PROFILES.has(raw.profile)) throw new CheckOutputError("yof printed an unknown profile.");
  for (const k of raw.keys) {
    if (!isObj(k) || !isStr(k.file) || !isInt(k.line) || !isInt(k.column) || !isStr(k.rule) || !isStr(k.name) || !isStr(k.masked) || !isStr(k.severity) || !SEVERITIES.has(k.severity)) {
      throw new CheckOutputError("yof printed a key finding this extension does not know.");
    }
  }
  for (const p of raw.packages) {
    if (!isObj(p) || !isStr(p.file) || !isStr(p.name) || !isStr(p.issue) || !isStr(p.message) || (p.severity !== "fix_now" && p.severity !== "fix_week")) {
      throw new CheckOutputError("yof printed a package finding this extension does not know.");
    }
  }
  if (raw.filePrompts !== undefined && (!Array.isArray(raw.filePrompts) || raw.filePrompts.some((x) => !isObj(x) || !isStr(x.file) || !isInt(x.count) || !isStr(x.prompt)))) {
    throw new CheckOutputError("yof printed file prompts this extension does not know.");
  }
  return raw as unknown as CheckJson;
}

const norm = (f: string) => f.replace(/\\/g, "/").replace(/^\.\//, "");

/** Where a dependency is named in its manifest: the first line that names it as a whole word. */
export function findDependencyLine(text: string, name: string): { line: number; start: number; end: number } | null {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^A-Za-z0-9_.@/-])(${esc})(?=$|[^A-Za-z0-9_.-])`, "i");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]!);
    if (m) { const start = m.index + m[1]!.length; return { line: i, start, end: start + m[2]!.length }; }
  }
  return null;
}

/** The whole key on its line, from the column the CLI gives (1-based) to the next quote, space or end of line. */
export function keySpan(lineText: string | null, column: number, masked: string): { start: number; end: number } {
  const start = Math.max(0, column - 1);
  if (lineText != null && start < lineText.length) {
    const m = /^[^\s"'`,;)]+/.exec(lineText.slice(start));
    if (m) return { start, end: start + m[0].length };
  }
  return { start, end: start + Math.max(1, masked.replace(/•+$/, "").length) };
}

export interface MapOptions {
  /** Overrides the profile the CLI used (the extension's yof.profile setting); default: the CLI's own. */
  profile?: Profile;
  /** Reads a checked file (relative path) so ranges cover the whole key or package name; null when it can't. */
  readText?: (file: string) => string | null;
  /** The workspace's .yof/accepted.json entries. */
  accepted?: readonly AcceptedEntry[];
}

function acceptedNote(a: { reason: string; acceptedBy: string; acceptedAt: string }): string {
  return `Accepted${a.acceptedBy ? ` by ${a.acceptedBy}` : ""}${a.acceptedAt ? ` on ${a.acceptedAt.slice(0, 10)}` : ""}: ${a.reason}`;
}

export function toDiagnostics(report: CheckJson, o: MapOptions = {}): PlainDiagnostic[] {
  const profile = o.profile ?? report.profile;
  const cache = new Map<string, string[] | null>();
  const linesOf = (file: string) => {
    if (!cache.has(file)) { const t = o.readText?.(file) ?? null; cache.set(file, t == null ? null : t.split(/\r?\n/)); }
    return cache.get(file)!;
  };
  const out: PlainDiagnostic[] = [];
  const perFile = new Map((report.filePrompts ?? []).filter((x) => x.count > 1).map((x) => [norm(x.file), x] as const));
  const withFile = (d: PlainDiagnostic): PlainDiagnostic => {
    const fp = perFile.get(d.file);
    return fp ? { ...d, filePrompt: fp.prompt, fileCount: fp.count } : d;
  };
  for (const k of report.keys) {
    if (!visibleIn(profile, k.severity)) continue;
    const file = norm(k.file);
    const line = Math.max(0, k.line - 1);
    const span = keySpan(linesOf(file)?.[line] ?? null, k.column, k.masked);
    const why = k.why ? ` ${k.why}` : "";
    const lineText = linesOf(file)?.[line] ?? "";
    const fingerprint = acceptFingerprint(k.rule, file, lineText);
    // One finding per value (CLI 2026-11-07): an acceptance made for a rule folded into this one still applies.
    const folded = Array.isArray(k.alsoMatched) ? k.alsoMatched.filter(isStr) : [];
    const accepted = (o.accepted ?? []).find((a) => a.file === file && ((a.rule === k.rule && a.fingerprint === fingerprint)
      || (folded.includes(a.rule) && a.fingerprint === acceptFingerprint(a.rule, file, lineText))));
    const also = folded.length ? ` Also matched: ${folded.join(", ")}.` : "";
    const message = `${k.name} (${LABEL[k.severity]}): ${k.masked}.${why}${also}`;
    out.push(withFile({
      file, line, startColumn: span.start, endColumn: span.end, level: accepted ? "information" : LEVEL[k.severity], code: k.rule,
      message: accepted ? `${acceptedNote(accepted)}. ${message}` : message, fixPrompt: k.fixPrompt ?? "", fingerprint,
      ...(accepted ? { accepted: { reason: accepted.reason, acceptedBy: accepted.acceptedBy, acceptedAt: accepted.acceptedAt } } : {}),
    }));
  }
  for (const p of report.packages) {
    if (!visibleIn(profile, p.severity)) continue;
    const file = norm(p.file);
    const text = linesOf(file);
    const at = text ? findDependencyLine(text.join("\n"), p.name) : null;
    const code = `package.${p.issue}`;
    const fingerprint = acceptFingerprint(code, file, `${p.ecosystem}:${p.name}`);
    const accepted = (o.accepted ?? []).find((a) => a.fingerprint === fingerprint && a.rule === code && a.file === file);
    const message = `${p.name}${p.version ? `@${p.version}` : ""} (${p.ecosystem === "npm" ? "npm" : "PyPI"}, ${LABEL[p.severity]}): ${p.why ?? p.message}`;
    out.push(withFile({
      file, line: at?.line ?? 0, startColumn: at?.start ?? 0, endColumn: at?.end ?? 1, level: accepted ? "information" : LEVEL[p.severity], code,
      message: accepted ? `${acceptedNote(accepted)}. ${message}` : message, fixPrompt: p.fixPrompt ?? "", fingerprint,
      ...(accepted ? { accepted: { reason: accepted.reason, acceptedBy: accepted.acceptedBy, acceptedAt: accepted.acceptedAt } } : {}),
    }));
  }
  return out;
}

/** The quick fix that copies the combined prompt of a file. */
export const fileActionTitle = (n: number) => `yof: Copy one fix prompt for all ${n} problems in this file`;

/** The status bar text: counts of what the profile shows. Never a date. */
export function statusText(d: readonly PlainDiagnostic[]): string {
  const now = d.filter((x) => !x.accepted && x.level === "error").length;
  const week = d.filter((x) => !x.accepted && x.level === "warning").length;
  const acc = d.filter((x) => x.accepted).length;
  const tail = acc ? `, ${acc} accepted` : "";
  if (!now && !week) return `yof: nothing to fix${tail}`;
  return `yof: ${[now ? `${now} fix now` : "", week ? `${week} this week` : ""].filter(Boolean).join(", ")}${tail}`;
}
