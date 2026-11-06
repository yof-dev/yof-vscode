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
 *     time limit. No telemetry: the extension sends nothing anywhere.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import { ATTACK_STOP_GRACE_MS, confirmText, parseEnvFile, preflight, stoppedText, summarizeAttack, type AttackSummaryInput } from "./attack";
import { CheckOutputError, parseCheckJson, statusText, toDiagnostics, type PlainDiagnostic } from "./diagnostics";
import { LatestRunner, resolveCli, runCli, type CliCommand } from "./process";
import { attackArgs, checkArgs, readSettings, type Settings } from "./settings";

const DOCS = "https://yof.io/docs#cli";
const SAVE_DELAY_MS = 400;
const ATTACK_TIMEOUT_MS = 16 * 60 * 1000;   // the CLI's own hard ceiling is 15 minutes

let output: vscode.OutputChannel;
let collection: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let bundledScript = "";
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

async function check(folder: vscode.WorkspaceFolder): Promise<void> {
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
    const diags = toDiagnostics(report, { readText: (f) => readIf(join(folder.uri.fsPath, f)) });
    publish(folder, diags);
    setStatus(statusText(diags), `yof check (${report.offline ? "offline" : "with package lookups"}, profile ${report.profile}). Click to check again.`);
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

function schedule(folder: vscode.WorkspaceFolder, delay = SAVE_DELAY_MS) {
  const key = folder.uri.toString();
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => { timers.delete(key); void check(folder); }, delay));
}

class FixPromptActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const list = prompts.get(doc.uri.toString()) ?? [];
    const out: vscode.CodeAction[] = [];
    for (const diag of ctx.diagnostics) {
      if (diag.source !== "yof") continue;
      const code = typeof diag.code === "object" ? String(diag.code.value) : String(diag.code);
      const found = list.find((d) => d.code === code && d.line === diag.range.start.line && d.startColumn === diag.range.start.character);
      if (!found?.fixPrompt) continue;
      const action = new vscode.CodeAction("yof: Copy the fix prompt for your AI assistant", vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diag];
      action.command = { command: "yof.copyFixPrompt", title: "Copy the fix prompt", arguments: [found.fixPrompt] };
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
  output = vscode.window.createOutputChannel("yof");
  collection = vscode.languages.createDiagnosticCollection("yof");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "yof.check";
  setStatus("yof", "yof checks this workspace when you save. Click to check now.");

  context.subscriptions.push(
    output, collection, status,
    vscode.commands.registerCommand("yof.check", () => { for (const f of vscode.workspace.workspaceFolders ?? []) schedule(f, 0); }),
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
