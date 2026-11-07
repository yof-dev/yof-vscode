/**
 * The opt-in scan count (2026-11-07). OFF by default. It runs only when BOTH are true:
 *   - the person turned on yof.shareScanCount (asked once, after the first finished scan), and
 *   - the editor's own telemetry setting is on (vscode.env.isTelemetryEnabled).
 * Then each finished scan sends ONE request with exactly four fields: event "scan_finished", the extension version,
 * the editor's name (vscode, cursor, windsurf, vscodium or other) and the day (YYYY-MM-DD, UTC). No code, file names,
 * paths, findings, machine or user ids. The server keeps only a daily counter per version and editor, never the IP.
 * A failed send is dropped silently (it never retries, never queues, never blocks a check). No VS Code import here.
 */

export const SCAN_COUNT_URL = "https://api.mondaily.com/api/v1/public/yof-scan-count";
export const SCAN_COUNT_PROMPT = "Help yof count scans? It sends only 'a scan finished' and the extension version: no code, file names or paths.";
export const SCAN_COUNT_YES = "Yes, count my scans";
export const SCAN_COUNT_NO = "No";
export const SCAN_COUNT_TIMEOUT_MS = 3000;

export type Editor = "vscode" | "cursor" | "windsurf" | "vscodium" | "other";
export interface ScanCountBody { event: "scan_finished"; version: string; editor: Editor; day: string }

/** The editor from vscode.env.appName ("Visual Studio Code", "Cursor", "Windsurf", "VSCodium"...). */
export function editorOf(appName: string | undefined): Editor {
  const a = String(appName ?? "").toLowerCase();
  if (a.includes("cursor")) return "cursor";
  if (a.includes("windsurf")) return "windsurf";
  if (a.includes("vscodium")) return "vscodium";
  if (a.includes("visual studio code") || a.startsWith("code")) return "vscode";
  return "other";
}

export function shouldSend(o: { optedIn: boolean; telemetryEnabled: boolean }): boolean {
  return o.optedIn === true && o.telemetryEnabled === true;
}

/** Ask once: only after a finished scan, only when not asked before, and never when the editor's telemetry is off. */
export function shouldAsk(o: { asked: boolean; optedIn: boolean; telemetryEnabled: boolean }): boolean {
  return !o.asked && !o.optedIn && o.telemetryEnabled;
}

export function scanCountBody(version: string, appName: string | undefined, now = new Date()): ScanCountBody {
  return { event: "scan_finished", version: /^\d+\.\d+\.\d+$/.test(version) ? version : "0.0.0", editor: editorOf(appName), day: now.toISOString().slice(0, 10) };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<unknown>;

/** Send one count. Returns whether it was sent (false when off, or when the request failed). */
export async function sendScanCount(o: { optedIn: boolean; telemetryEnabled: boolean; version: string; appName?: string; fetch?: FetchLike; now?: Date }): Promise<boolean> {
  if (!shouldSend(o)) return false;
  const f = o.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!f) return false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SCAN_COUNT_TIMEOUT_MS);
  try {
    await f(SCAN_COUNT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scanCountBody(o.version, o.appName, o.now)), signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
