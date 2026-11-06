/**
 * Running the yof CLI without ever blocking the editor: every run is a child process, awaited asynchronously, with a
 * hard time limit and a cancel signal. Stopping is polite first: SIGTERM, so `yof attack` can delete its test records
 * and exit (143), and SIGKILL only if it is still running after the grace period. No VS Code import here.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface CliCommand {
  /** The executable. */
  command: string;
  /** Arguments that come before the yof arguments (the script path when running the bundled CLI with Node). */
  prefix: string[];
  /** Extra environment (ELECTRON_RUN_AS_NODE for the bundled CLI). */
  env: Record<string, string>;
  /** Where it came from, for the output panel. */
  source: "setting" | "workspace" | "bundled";
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the run was cancelled or ran out of time. */
  cancelled: boolean;
  timedOut: boolean;
  /** True when it did not end within the grace period after SIGTERM and was killed (SIGKILL). */
  forced: boolean;
}

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  env?: Record<string, string | undefined>;
  /** Output above this is cut off (a check's JSON is small; this keeps memory bounded). */
  maxBytes?: number;
  /** How long to wait after SIGTERM before SIGKILL (default 2 s; yof attack gets its clean-up time). */
  graceMs?: number;
  /** The process to signal (tests); default: the real child. */
  onSignal?: (signal: NodeJS.Signals) => void;
}

/** Runs one CLI command. Resolves (never rejects) when the process ends, is cancelled or times out. */
export function runCli(cli: CliCommand, args: string[], o: RunOptions): Promise<RunResult> {
  const max = o.maxBytes ?? 8 * 1024 * 1024;
  return new Promise((resolve) => {
    if (o.signal?.aborted) { resolve({ code: null, stdout: "", stderr: "", cancelled: true, timedOut: false, forced: false }); return; }
    let stdout = "", stderr = "", done = false, timedOut = false, cancelled = false, forced = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const child = spawn(cli.command, [...cli.prefix, ...args], {
      cwd: o.cwd,
      env: { ...process.env, ...o.env, ...cli.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(cli.command),
    });
    const signal = (s: NodeJS.Signals) => { o.onSignal?.(s); child.kill(s); };
    const kill = () => {
      if (child.exitCode !== null || graceTimer) return;
      signal("SIGTERM");
      graceTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) { forced = true; signal("SIGKILL"); } }, o.graceMs ?? 2_000);
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, o.timeoutMs);
    const onAbort = () => { cancelled = true; kill(); };
    o.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      o.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, cancelled: cancelled || timedOut, timedOut, forced });
    };
    child.stdout!.setEncoding("utf8").on("data", (s: string) => { if (stdout.length < max) stdout += s; });
    child.stderr!.setEncoding("utf8").on("data", (s: string) => { if (stderr.length < max) stderr += s; });
    child.on("error", (e) => { stderr += e.message; finish(null); });
    child.on("close", (code) => finish(code));
  });
}

/**
 * Keeps at most one run of a kind going: starting a new one cancels the one before (a newer save makes an older check
 * pointless). `run` resolves with null for a run that was replaced.
 */
export class LatestRunner {
  private current: AbortController | null = null;

  /** `keepCancelled`: return the result of a cancelled run too (yof attack reports its clean-up after a stop). */
  async run<T>(work: (signal: AbortSignal) => Promise<T>, opts: { keepCancelled?: boolean } = {}): Promise<T | null> {
    this.current?.abort();
    const ctl = new AbortController();
    this.current = ctl;
    try {
      const out = await work(ctl.signal);
      return ctl.signal.aborted && !opts.keepCancelled ? null : out;
    } finally {
      if (this.current === ctl) this.current = null;
    }
  }

  cancel(): void { this.current?.abort(); this.current = null; }
  get busy(): boolean { return this.current !== null; }
}

export interface ResolveOptions {
  /** yof.cliPath, already checked to be allowed (only in a trusted workspace). */
  cliPath: string;
  /** The workspace folder; its node_modules/.bin/yof is used only in a trusted workspace. */
  folder: string;
  trusted: boolean;
  /** The CLI copy shipped inside the extension. */
  bundledScript: string;
  /** The editor's own executable, run as plain Node for the bundled CLI. */
  execPath: string;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
}

/**
 * Which yof to run. In a trusted workspace: the yof.cliPath setting, then the project's own installed yof. Always
 * last, and the only choice in an untrusted workspace: the copy bundled with the extension (no download, no network).
 */
export function resolveCli(o: ResolveOptions): CliCommand {
  const exists = o.exists ?? existsSync;
  const win = (o.platform ?? process.platform) === "win32";
  if (o.trusted && o.cliPath.trim()) return { command: o.cliPath.trim(), prefix: [], env: {}, source: "setting" };
  if (o.trusted) {
    const local = join(o.folder, "node_modules", ".bin", win ? "yof.cmd" : "yof");
    if (exists(local)) return { command: local, prefix: [], env: {}, source: "workspace" };
  }
  return { command: o.execPath, prefix: [o.bundledScript], env: { ELECTRON_RUN_AS_NODE: "1" }, source: "bundled" };
}
