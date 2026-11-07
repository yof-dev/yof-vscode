/**
 * yof for VS Code (and Cursor, Windsurf and other editors that install from Open VSX).
 *
 *   - On save, `yof check --json` runs for the workspace folder in a child process and its findings show in Problems,
 *     with the plain-words explanation and a "Copy the fix prompt" quick fix. Offline by default: no network at all
 *     unless yof.packageLookups is on.
 *   - "yof: Attack my app" runs `yof attack` in the background against yof.attack.target with .yof/attack.json, after
 *     a non-modal question. Cancel any time from the notification: the CLI gets SIGTERM, deletes its test records and
 *     exits; only if it is still running after ATTACK_STOP_GRACE_MS is it killed.
 *   - Nothing here blocks typing: every run is asynchronous, a newer save cancels an older check, and every run has a
 *     time limit.
 *   - 0.1.1 (2026-11-07): "yof: Accept this risk…" (a quick fix) asks for a one-sentence reason and writes it to
 *     .yof/accepted.json, committed with the code; accepted findings stay in Problems as information with the reason
 *     and leave the open count; "yof: Reopen accepted risk" removes the entry. After a check you start, three buttons:
 *     Copy fix prompt, Get a signed report, Turn on Patch (the last two only open a page; "(opens soon)" until
 *     ordering opens).
 *   - No telemetry unless you opt in: yof.shareScanCount is off by default, asked once after the first finished scan,
 *     and stays off whenever the editor's own telemetry is off. When on, one request per finished scan with "a scan
 *     finished", the version, the editor's name and the day (src/scan-count.ts). Nothing else is ever sent.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import { ATTACK_STOP_GRACE_MS, confirmText, parseEnvFile, preflight, stoppedText, summarizeAttack, type AttackSummaryInput } from "./attack";
import { CheckOutputError, fileActionTitle, parseCheckJson, statusText, toDiagnostics, type PlainDiagnostic } from "./diagnostics";
import { LatestRunner, resolveCli, runCli, type CliCommand } from "./process";
import { attackArgs, checkArgs, readSettings, type Settings } from "./settings";
import { ACCEPTED_FILE, cleanReason, newEntry, parseAccepted, withEntry, withoutEntry, type AcceptedEntry } from "./accepted";
import { combinedPrompt, nextStepLabel, nextSteps, nextStepsText, nextStepUrl, type NextStep } from "./next-steps";
import { SCAN_COUNT_NO, SCAN_COUNT_PROMPT, SCAN_COUNT_YES, sendScanCount, shouldAsk } from "./scan-count";

const DOCS = "https://yof.io/docs#cli";
const SAVE_DELAY_MS = 400;
const ATTACK_TIMEOUT_MS = 16 * 60 * 1000;   // the CLI's own hard ceiling is 15 minutes

let output: vscode.OutputChannel;
let collection: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let bundledScript = "";
let extensionVersion = "0.0.0";
let globalState: vscode.Memento | undefined;
const SCAN_COUNT_ASKED = "yof.scanCountAsked";
const runners = new Map<string, LatestRunner>();
const timers = new Map<string, NodeJS.Timeout>();
const prompts = new Map<string, PlainDiagnostic[]>();
const attackRunner = new LatestRunner();
const confirmed = new Set<string>();

const settings = (folder?: vscode.WorkspaceFolder): Settings => {
  const c = vscode.workspace.getConfiguration("yof", folder?.uri);
  return readSettings((k) => c.get(k));
};

function cliFor(folder: vscode.WorkspaceFolder, s: Settings): CliCommand {
  return resolveCli({
    cliPath: s.cliPath, folder: folder.uri.fsPath, trusted: vscode.workspace.isTrusted,
    bundledScript, execPath: process.execPath,
  });
}

const readIf = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

function setStatus(text: string, tooltip: string) {
  status.text = `$(shield) ${text}`;
  status.tooltip = tooltip;
  status.show();
}

const acceptedPath = (folder: vscode.WorkspaceFolder) => join(folder.uri.fsPath, ...ACCEPTED_FILE.split("/"));
const acceptedOf = (folder: vscode.WorkspaceFolder): AcceptedEntry[] => parseAccepted(readIf(acceptedPath(folder)));

async function check(folder: vscode.WorkspaceFolder, manual = false): Promise<void> {
  const s = settings(folder);
  const key = folder.uri.toString();
  let runner = runners.get(key);
  if (!runner) { runner = new LatestRunner(); runners.set(key, runner); }
  const cli = cliFor(folder, s);
  setStatus("yof: checking", `Running yof check on ${folder.name}`);
  const result = await runner.run((signal) => runCli(cli, checkArgs(s), { cwd: folder.uri.fsPath, signal, timeoutMs: s.checkTimeoutSeconds * 1000 }));
  if (!result) return;   // a newer save replaced this run
  if (result.timedOut) { setStatus("yof: stopped", `yof check took longer than ${s.checkTimeoutSeconds} s and was stopped.`); output.appendLine(`[check] ${folder.name}: stopped after ${s.checkTimeoutSeconds} s.`); return; }
  if (result.cancelled) return;
  if (result.code !== 0 && result.code !== 1) {
    setStatus("yof: needs attention", "yof check could not run. Open the yof output for details.");
    output.appendLine(`[check] ${folder.name}: yof (${cli.source}) ended with code ${result.code}. ${result.stderr.trim()}`);
    return;
  }
  try {
    const report = parseCheckJson(result.stdout);
    const diags = toDiagnostics(report, { readText: (f) => readIf(join(folder.uri.fsPath, f)), accepted: acceptedOf(folder) });
    publish(folder, diags);
    setStatus(statusText(diags), `yof check (${report.offline ? "offline" : "with package lookups"}, profile ${report.profile}). Click to check again.`);
    void afterScan(folder, diags, manual);
  } catch (e) {
    const msg = e instanceof CheckOutputError ? e.message : String(e);
    setStatus("yof: needs attention", msg);
    output.appendLine(`[check] ${folder.name}: ${msg}`);
  }
}

function publish(folder: vscode.WorkspaceFolder, diags: PlainDiagnostic[]) {
  // Clear this folder's earlier results, then set the new ones per file.
  for (const uri of [...prompts.keys()]) {
    if (uri.startsWith(folder.uri.toString())) { collection.delete(vscode.Uri.parse(uri)); prompts.delete(uri); }
  }
  const byFile = new Map<string, PlainDiagnostic[]>();
  for (const d of diags) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  for (const [file, list] of byFile) {
    const uri = vscode.Uri.joinPath(folder.uri, ...file.split("/"));
    collection.set(uri, list.map(toVsDiagnostic));
    prompts.set(uri.toString(), list);
  }
}

const LEVEL = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning, information: vscode.DiagnosticSeverity.Information } as const;

function toVsDiagnostic(d: PlainDiagnostic): vscode.Diagnostic {
  const diag = new vscode.Diagnostic(new vscode.Range(d.line, d.startColumn, d.line, d.endColumn), d.message, LEVEL[d.level]);
  diag.source = "yof";
  diag.code = { value: d.code, target: vscode.Uri.parse(DOCS) };
  return diag;
}

function schedule(folder: vscode.WorkspaceFolder, delay = SAVE_DELAY_MS, manual = false) {
  const key = folder.uri.toString();
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); void check(folder, manual); }, delay));
}

/** After a finished scan: the opt-in count (asked once), and the next steps when the person started the check. */
async function afterScan(folder: vscode.WorkspaceFolder, diags: readonly PlainDiagnostic[], manual: boolean): Promise<void> {
  const telemetryEnabled = vscode.env.isTelemetryEnabled;
  const optedIn = settings(folder).shareScanCount;
  if (globalState && shouldAsk({ asked: !!globalState.get(SCAN_COUNT_ASKED), optedIn, telemetryEnabled })) {
    await globalState.update(SCAN_COUNT_ASKED, true);
    void vscode.window.showInformationMessage(SCAN_COUNT_PROMPT, SCAN_COUNT_YES, SCAN_COUNT_NO).then((pick) => {
      if (pick === SCAN_COUNT_YES) void vscode.workspace.getConfiguration("yof").update("shareScanCount", true, vscode.ConfigurationTarget.Global);
    });
  }
  void sendScanCount({ optedIn, telemetryEnabled, version: extensionVersion, appName: vscode.env.appName });
  if (!manual) return;
  const open = diags.filter((d) => !d.accepted && (d.level === "error" || d.level === "warning"));
  const steps = nextSteps(open.length);
  const labels = steps.map((s) => nextStepLabel(s));
  const pick = await vscode.window.showInformationMessage(nextStepsText(open.length), ...labels);
  const step = steps[labels.indexOf(pick ?? "")];
  if (step) await runNextStep(step, open);
}

async function runNextStep(step: NextStep, open: readonly PlainDiagnostic[]): Promise<void> {
  if (step === "copyPrompts") {
    const text = combinedPrompt(open.map((d) => d.fixPrompt));
    if (!text) { void vscode.window.showInformationMessage("yof: these findings have no fix prompt. Open the yof output for details."); return; }
    await vscode.env.clipboard.writeText(text);
    void vscode.window.setStatusBarMessage("yof: fix prompt copied. Paste it into your AI assistant.", 4000);
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(nextStepUrl(step)));
}

/** git's user.name for the folder (a local command, no network), or "" when there is none. */
function gitUserName(cwd: string): Promise<string> {
  return new Promise((done) => {
    execFile("git", ["config", "user.name"], { cwd, timeout: 3000, windowsHide: true }, (err, out) => done(err ? "" : String(out).trim().slice(0, 120)));
  });
}

type AcceptArgs = { folder: string; file: string; code: string; fingerprint: string; message?: string };

async function acceptRisk(arg?: AcceptArgs): Promise<void> {
  const target = arg ?? (await pickOpenFinding());
  if (!target) return;
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(target.folder));
  if (!folder) return;
  const reason = cleanReason(await vscode.window.showInputBox({
    title: "yof: Accept this risk", prompt: `Why is ${target.code} in ${target.file} acceptable? One sentence, saved in ${ACCEPTED_FILE} and shown in yof reports.`,
    placeHolder: "For example: a revoked test key in a fixture, it cannot be used.", ignoreFocusOut: true,
    validateInput: (v) => (cleanReason(v) ? null : "Write a reason of 1 to 300 characters."),
  }));
  if (!reason) return;
  let by = await gitUserName(folder.uri.fsPath);
  if (!by) by = (await vscode.window.showInputBox({ title: "yof: Accept this risk", prompt: "Your name, saved with the reason (git has no user.name here).", ignoreFocusOut: true, validateInput: (v) => (v.trim() ? null : "Write your name.") }))?.trim() ?? "";
  if (!by) return;
  const path = acceptedPath(folder);
  const next = withEntry(readIf(path), newEntry(target, reason, by));
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, ".yof"));
  await vscode.workspace.fs.writeFile(vscode.Uri.file(path), new TextEncoder().encode(next));
  void vscode.window.setStatusBarMessage(`yof: risk accepted in ${ACCEPTED_FILE}. Commit the file to share it.`, 5000);
  schedule(folder, 0);
}

async function pickOpenFinding(): Promise<AcceptArgs | undefined> {
  const items: (vscode.QuickPickItem & { arg: AcceptArgs })[] = [];
  for (const [uri, list] of prompts) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(uri));
    if (!folder) continue;
    for (const d of list) if (!d.accepted) items.push({ label: `${d.file}:${d.line + 1}`, description: d.code, detail: d.message, arg: { folder: folder.uri.toString(), file: d.file, code: d.code, fingerprint: d.fingerprint } });
  }
  if (!items.length) { void vscode.window.showInformationMessage("yof: no open finding to accept. Run a check first."); return undefined; }
  return (await vscode.window.showQuickPick(items, { title: "yof: Accept this risk", placeHolder: "Which finding?" }))?.arg;
}

async function reopenRisk(arg?: { folder: string; fingerprint: string }): Promise<void> {
  let folder = arg ? vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(arg.folder)) : undefined;
  let fingerprint = arg?.fingerprint;
  if (!fingerprint) {
    const items: (vscode.QuickPickItem & { folder: vscode.WorkspaceFolder; fp: string })[] = [];
    for (const f of vscode.workspace.workspaceFolders ?? []) for (const e of acceptedOf(f)) items.push({ label: `${e.file}`, description: e.rule, detail: `${e.acceptedBy}, ${e.acceptedAt.slice(0, 10)}: ${e.reason}`, folder: f, fp: e.fingerprint });
    if (!items.length) { void vscode.window.showInformationMessage(`yof: ${ACCEPTED_FILE} has no accepted risks.`); return; }
    const pick = await vscode.window.showQuickPick(items, { title: "yof: Reopen accepted risk", placeHolder: "Which accepted risk?" });
    if (!pick) return;
    folder = pick.folder; fingerprint = pick.fp;
  }
  if (!folder || !fingerprint) return;
  const path = acceptedPath(folder);
  await vscode.workspace.fs.writeFile(vscode.Uri.file(path), new TextEncoder().encode(withoutEntry(readIf(path), fingerprint)));
  void vscode.window.setStatusBarMessage("yof: risk reopened. Commit the change to share it.", 5000);
  schedule(folder, 0);
}

class FixPromptActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const list = prompts.get(doc.uri.toString()) ?? [];
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const out: vscode.CodeAction[] = [];
    for (const diag of ctx.diagnostics) {
      if (diag.source !== "yof") continue;
      const code = typeof diag.code === "object" ? String(diag.code.value) : String(diag.code);
      const found = list.find((d) => d.code === code && d.line === diag.range.start.line && d.startColumn === diag.range.start.character);
      if (!found) continue;
      if (found.fixPrompt && !found.accepted) {
        const action = new vscode.CodeAction("yof: Copy the fix prompt for your AI assistant", vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diag];
        action.command = { command: "yof.copyFixPrompt", title: "Copy the fix prompt", arguments: [found.fixPrompt] };
        out.push(action);
      }
      if (!folder) continue;
      const accept = new vscode.CodeAction(found.accepted ? "yof: Reopen accepted risk" : "yof: Accept this risk…", vscode.CodeActionKind.QuickFix);
      accept.diagnostics = [diag];
      accept.command = found.accepted
        ? { command: "yof.reopenRisk", title: "Reopen accepted risk", arguments: [{ folder: folder.uri.toString(), fingerprint: found.fingerprint }] }
        : { command: "yof.acceptRisk", title: "Accept this risk", arguments: [{ folder: folder.uri.toString(), file: found.file, code: found.code, fingerprint: found.fingerprint }] };
      out.push(accept);
    }
    // One prompt for the whole file when it holds two or more problems, so the AI assistant edits it once.
    const whole = list.find((d) => d.filePrompt && (d.fileCount ?? 0) > 1);
    if (whole && out.length) {
      const action = new vscode.CodeAction(fileActionTitle(whole.fileCount!), vscode.CodeActionKind.QuickFix);
      action.command = { command: "yof.copyFixPrompt", title: "Copy one fix prompt for this file", arguments: [whole.filePrompt] };
      out.push(action);
    }
    return out;
  }
}

function pickFolder(): vscode.WorkspaceFolder | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  return (active && vscode.workspace.getWorkspaceFolder(active)) ?? vscode.workspace.workspaceFolders?.[0];
}

async function attack(): Promise<void> {
  const folder = pickFolder();
  if (!folder) { void vscode.window.showInformationMessage("Open a folder first: yof attack reads .yof/attack.json from it."); return; }
  if (!vscode.workspace.isTrusted) { void vscode.window.showInformationMessage("yof attack runs only in a trusted workspace."); return; }
  if (attackRunner.busy) { void vscode.window.showInformationMessage("yof attack is already running. Cancel it from its notification first."); return; }
  const s = settings(folder);
  const configPath = isAbsolute(s.attackConfig) ? s.attackConfig : join(folder.uri.fsPath, s.attackConfig);
  const pre = preflight(readIf(configPath), s.attackConfig);
  if (!pre.ok) { void vscode.window.showWarningMessage(pre.reason); return; }

  const key = `${folder.uri.toString()}|${s.attackTarget}|${s.attackMode}`;
  if (!confirmed.has(key)) {
    const pick = await vscode.window.showInformationMessage(confirmText(s.attackTarget, s.attackConfig, s.attackMode), "Start", "Not now");
    if (pick !== "Start") return;
    confirmed.add(key);
  }

  let env: Record<string, string> = {};
  if (s.attackEnvFile) {
    const p = isAbsolute(s.attackEnvFile) ? s.attackEnvFile : join(folder.uri.fsPath, s.attackEnvFile);
    const text = readIf(p);
    if (text == null) { void vscode.window.showWarningMessage(`yof.attack.envFile is set, but ${s.attackEnvFile} could not be read.`); return; }
    env = parseEnvFile(text);
  }

  const cli = cliFor(folder, s);
  output.appendLine(`[attack] ${s.attackTarget} (${s.attackMode} run, ${s.attackConfig}, yof from ${cli.source})`);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `yof attack on ${s.attackTarget}`, cancellable: true },
    async (_progress, token) => {
      const result = await attackRunner.run((signal) => {
        const sub = token.onCancellationRequested(() => attackRunner.cancel());
        return runCli(cli, attackArgs(s), { cwd: folder.uri.fsPath, signal, timeoutMs: ATTACK_TIMEOUT_MS, env, graceMs: ATTACK_STOP_GRACE_MS }).finally(() => sub.dispose());
      }, { keepCancelled: true });
      if (!result) return;
      if (result.cancelled) {
        const text = stoppedText(result);
        output.appendLine(`[attack] ${text}`);
        if (result.forced) void vscode.window.showWarningMessage(text);
        return;
      }
      if (result.code !== 0 && result.code !== 1) {
        output.appendLine(`[attack] could not run (code ${result.code}): ${result.stderr.trim()}`);
        void vscode.window.showWarningMessage(`yof attack could not run: ${result.stderr.trim().split("\n")[0] ?? "see the yof output"}`, "Show details").then((p) => { if (p) output.show(true); });
        return;
      }
      let report: AttackSummaryInput;
      try { report = JSON.parse(result.stdout) as AttackSummaryInput; } catch { output.appendLine("[attack] yof did not print JSON."); return; }
      const sum = summarizeAttack(report);
      for (const l of sum.lines) output.appendLine(l);
      void vscode.window.showInformationMessage(sum.headline, "Show details").then((p) => { if (p) output.show(true); });
    },
  );
}

export function activate(context: vscode.ExtensionContext): void {
  bundledScript = context.asAbsolutePath(join("dist", "yof-cli.cjs"));
  extensionVersion = String((context.extension?.packageJSON as { version?: string } | undefined)?.version ?? "0.0.0");
  globalState = context.globalState;
  output = vscode.window.createOutputChannel("yof");
  collection = vscode.languages.createDiagnosticCollection("yof");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "yof.check";
  setStatus("yof", "yof checks this workspace when you save. Click to check now.");

  context.subscriptions.push(
    output, collection, status,
    vscode.commands.registerCommand("yof.check", () => { for (const f of vscode.workspace.workspaceFolders ?? []) schedule(f, 0, true); }),
    vscode.commands.registerCommand("yof.acceptRisk", (arg?: AcceptArgs) => acceptRisk(arg)),
    vscode.commands.registerCommand("yof.reopenRisk", (arg?: { folder: string; fingerprint: string }) => reopenRisk(arg)),
    vscode.commands.registerCommand("yof.signedReport", () => runNextStep("signedReport", [])),
    vscode.commands.registerCommand("yof.turnOnPatch", () => runNextStep("patch", [])),
    vscode.commands.registerCommand("yof.attack", () => attack()),
    vscode.commands.registerCommand("yof.cancelAttack", () => attackRunner.cancel()),
    vscode.commands.registerCommand("yof.copyFixPrompt", async (prompt: unknown) => {
      if (typeof prompt !== "string" || !prompt) return;
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.setStatusBarMessage("yof: fix prompt copied. Paste it into your AI assistant.", 4000);
    }),
    vscode.commands.registerCommand("yof.showOutput", () => output.show(true)),
    vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new FixPromptActions(), { providedCodeActionKinds: FixPromptActions.kinds }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
      if (folder && settings(folder).checkOnSave) schedule(folder);
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { for (const f of vscode.workspace.workspaceFolders ?? []) schedule(f, 0); }),
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      for (const f of e.removed) { runners.get(f.uri.toString())?.cancel(); publish(f, []); }
      for (const f of e.added) if (settings(f).checkOnSave) schedule(f, 0);
    }),
    { dispose: () => { for (const r of runners.values()) r.cancel(); attackRunner.cancel(); for (const t of timers.values()) clearTimeout(t); } },
  );

  for (const f of vscode.workspace.workspaceFolders ?? []) if (settings(f).checkOnSave) schedule(f, 1000);
}

export function deactivate(): void {
  for (const r of runners.values()) r.cancel();
  attackRunner.cancel();
}
