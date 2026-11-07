/**
 * Accepted risks, recorded in the workspace: `.yof/accepted.json`, committed with the code (the same format and the
 * same fingerprint as the yof CLI's src/accepted.ts and yof's reports). No VS Code import here, so it is tested on
 * its own.
 *
 * The extension works out the fingerprint itself from the finding's line, so an accepted finding shows as accepted
 * even with a CLI that predates the file. An accepted finding stays in Problems as information, "Accepted: <reason>",
 * never silently hidden, and leaves the status bar's open count. A changed line has another fingerprint: open again.
 */
import { createHash } from "node:crypto";

export const ACCEPTED_FILE = ".yof/accepted.json";
export const ACCEPTED_REASON_MAX = 300;
const MAX_ENTRIES = 500;

export interface AcceptedEntry { rule: string; file: string; fingerprint: string; reason: string; acceptedBy: string; acceptedAt: string }

export function acceptFingerprint(rule: string, file: string, content: string): string {
  return createHash("sha256").update(`yof-accept/1\n${rule}\n${file.replace(/\\/g, "/")}\n${content.trim()}`).digest("hex").slice(0, 32);
}

const RULE = /^[a-z0-9_.-]{1,80}$/i;
const FP = /^[0-9a-f]{32}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");

export function parseAccepted(text: string | null | undefined): AcceptedEntry[] {
  if (!text) return [];
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const list = raw && typeof raw === "object" && Array.isArray((raw as { accepted?: unknown }).accepted) ? (raw as { accepted: unknown[] }).accepted : [];
  const out: AcceptedEntry[] = [];
  for (const e of list.slice(0, MAX_ENTRIES)) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const entry = {
      rule: str(o.rule, 80), file: str(o.file, 400).replace(/\\/g, "/").replace(/^\.\//, ""), fingerprint: str(o.fingerprint, 64).toLowerCase(),
      reason: str(o.reason, ACCEPTED_REASON_MAX), acceptedBy: str(o.acceptedBy, 120), acceptedAt: str(o.acceptedAt, 40),
    };
    if (!RULE.test(entry.rule) || !entry.file || entry.file.includes("..") || !FP.test(entry.fingerprint) || !entry.reason || !Number.isFinite(Date.parse(entry.acceptedAt))) continue;
    out.push(entry);
  }
  return out;
}

export function withEntry(text: string | null | undefined, entry: AcceptedEntry): string {
  const list = parseAccepted(text).filter((x) => x.fingerprint !== entry.fingerprint);
  list.push(entry);
  list.sort((a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule) || a.fingerprint.localeCompare(b.fingerprint));
  return `${JSON.stringify({ version: 1, accepted: list }, null, 2)}\n`;
}

export function withoutEntry(text: string | null | undefined, fingerprint: string): string {
  return `${JSON.stringify({ version: 1, accepted: parseAccepted(text).filter((x) => x.fingerprint !== fingerprint) }, null, 2)}\n`;
}

/** A reason a person typed: one sentence, 1 to 300 characters, no control characters. null when it can't be used. */
export function cleanReason(raw: string | undefined): string | null {
  const r = String(raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return r.length >= 1 && r.length <= ACCEPTED_REASON_MAX ? r : null;
}

/** The new entry for one finding. */
export function newEntry(f: { code: string; file: string; fingerprint: string }, reason: string, acceptedBy: string, now = new Date()): AcceptedEntry {
  return { rule: f.code, file: f.file, fingerprint: f.fingerprint, reason, acceptedBy: acceptedBy.trim().slice(0, 120), acceptedAt: now.toISOString() };
}
