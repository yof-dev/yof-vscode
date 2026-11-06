/**
 * yof attack from the editor: what is checked before the CLI starts, and how its JSON report is shown. The CLI itself
 * enforces every safety rule again (proven host, consent, production window, budgets, no destructive requests); this
 * file only makes sure the person sees what is about to happen first. No VS Code import here.
 */

/**
 * How long a cancelled yof attack gets after SIGTERM before it is killed: the CLI's own clean-up deadline (10 s) plus
 * room to print its report and exit.
 */
export const ATTACK_STOP_GRACE_MS = 15_000;

/** What to say after a cancelled run: the CLI's own clean-up line, or, only when it had to be killed, the warning. */
export function stoppedText(r: { forced: boolean; stderr: string }): string {
  if (r.forced) return "yof attack did not stop in time and was ended. Test records it had created may still be there (they hold the run's yof marker text); delete them in your app.";
  const lines = r.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const records = lines.filter((l) => l.startsWith("Test records:") || l.startsWith("Not deleted"));
  if (records.length) return `yof attack stopped. ${records.join(" ")}`;
  return lines.filter((l) => l.startsWith("yof attack: stopped.")).pop()?.replace(/^yof attack: /, "yof attack ") ?? "yof attack stopped.";
}

/** The consent sentence the CLI requires, word for word, in .yof/attack.json (the same words as the CLI's catalog). */
export const consentText = (app: string) =>
  `I own ${app} and allow yof attack to test it and its preview builds with my own test accounts.`;

export type Preflight =
  | { ok: true; app: string; consent: string }
  | { ok: false; reason: string };

/** Reads the attack config text: it must exist, be JSON, name the app and carry the consent sentence for it. */
export function preflight(configText: string | null, configPath: string): Preflight {
  if (configText == null) return { ok: false, reason: `There is no ${configPath} yet. yof attack needs one: it names your app, your written consent and the test accounts (as environment variable names, never passwords). The yof README has an example.` };
  let raw: unknown;
  try { raw = JSON.parse(configText); } catch { return { ok: false, reason: `${configPath} is not valid JSON.` }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: `${configPath} must be a JSON object.` };
  const app = (raw as { app?: unknown }).app;
  const consent = (raw as { consent?: unknown }).consent;
  if (typeof app !== "string" || !app.trim()) return { ok: false, reason: `${configPath} must name your app ("app").` };
  const expected = consentText(app.trim().toLowerCase());
  if (typeof consent !== "string" || consent.trim() !== expected) return { ok: false, reason: `${configPath} must carry your consent, word for word: ${expected}` };
  return { ok: true, app: app.trim().toLowerCase(), consent: expected };
}

/** The question shown before a run. It is a normal (non-modal) notification, so typing goes on while it waits. */
export function confirmText(target: string, configPath: string, mode: "full" | "light"): string {
  const what = mode === "light" ? "read-only requests" : "requests, including test records it creates and deletes again";
  return `yof attack will send ${what} to ${target}, signed in as the test accounts named in ${configPath}. Start it?`;
}

/** Only YOF_ variables from the env file reach the CLI: the test accounts, nothing else from that file. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?(YOF_[A-Z0-9_]{1,60})\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

export interface AttackSummaryInput {
  target?: { host?: string };
  mode?: string;
  findings?: { title?: string; severity?: string; method?: string; route?: string; as?: string; evidence?: string }[];
  tests?: unknown[];
  stopped?: string | null;
  requests?: number;
  unconfirmed?: number;
}

const LABEL: Record<string, string> = { fix_now: "fix now", fix_week: "fix this week", nice: "nice to have" };

/** The report in a few plain lines for the output panel, and a one-line summary for the notification. */
export function summarizeAttack(r: AttackSummaryInput): { lines: string[]; headline: string } {
  const findings = Array.isArray(r.findings) ? r.findings : [];
  const lines = [`yof attack on ${r.target?.host ?? "?"} (${r.mode ?? "?"} run, ${r.requests ?? 0} requests)`];
  if (r.stopped) lines.push(`Stopped early: the ${r.stopped === "requests" ? "request" : "time"} budget ran out.`);
  for (const f of findings) {
    lines.push(`  ${f.title ?? "Finding"} (${LABEL[f.severity ?? ""] ?? f.severity ?? "?"})`);
    lines.push(`    ${f.method ?? ""} ${f.route ?? ""} as ${f.as === "anon" ? "nobody signed in" : `account ${f.as ?? "?"}`}: ${f.evidence ?? ""}`);
  }
  if (r.unconfirmed) lines.push(`${r.unconfirmed} possible finding(s) did not show a second time and are not reported.`);
  const now = findings.filter((f) => f.severity === "fix_now").length;
  const headline = findings.length
    ? `yof attack found ${findings.length} problem${findings.length === 1 ? "" : "s"}${now ? `, ${now} to fix now` : ""}.`
    : "yof attack found nothing in what it tested. A run shows what it tried, not that nothing can go wrong.";
  lines.push("", headline);
  return { lines, headline };
}
