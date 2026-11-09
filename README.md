<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/yof-logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/yof-logo-light.png">
    <img alt="yof" src=".github/assets/yof-logo-light.png" width="220">
  </picture>
</p>

<p align="center"><strong>Security checks for apps you build with AI</strong></p>

<p align="center">Catch leaked keys, risky or made-up packages and access holes between accounts before you ship. Free and open source.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@yof/cli"><img alt="@yof/cli on npm" src="https://img.shields.io/npm/v/@yof/cli?label=%40yof%2Fcli"></a>
  <a href="./LICENSE"><img alt="Licence: Apache-2.0" src="https://img.shields.io/badge/licence-Apache--2.0-blue"></a>
  <a href="https://yof.io/benchmark"><img alt="Benchmark" src="https://img.shields.io/badge/benchmark-results-36c98a"></a>
  <a href="https://yof.io"><img alt="yof.io" src="https://img.shields.io/badge/web-yof.io-0c0d11"></a>
</p>

# yof for VS Code

Security checks for code you write with AI builders. Leaked secrets and made-up packages show up in **Problems** when you save, each with a plain explanation and a fix prompt you can paste into the AI assistant that wrote the code. Works in VS Code, and in Cursor, Windsurf and other editors that install extensions from Open VSX.

It runs the open-source [yof CLI](https://github.com/yof-dev/yof) on your machine. Rules only, no AI, no account, and no telemetry unless you opt in.

## What it does

- **On save**, `yof check` runs for the workspace folder in the background. Typing is never blocked: a newer save cancels an older check, and every check has a time limit.
- **Problems**: each finding with its urgency (fix now is an error, fix this week a warning), the masked value and what can happen, in plain words.
- **Quick fix**: "yof: Copy the fix prompt for your AI assistant" puts a ready prompt on the clipboard. It carries the masked value only, never the full key.
- **Accept a risk**: the quick fix "yof: Accept this risk…" asks for a one-sentence reason and writes it to `.yof/accepted.json` in your workspace, with your git `user.name` (or a name you type) and the date. Commit the file so your team and the yof CLI see it too. An accepted finding stays in Problems as information, "Accepted by … on …: reason", and leaves the open count; it is never hidden. If the finding's line changes, it is open again. "yof: Reopen accepted risk" removes the entry. yof's signed reports list these entries in their "Accepted risks and why" appendix.
- **After a check you start** (the command or the status bar): **Copy fix prompt** (every open finding's prompt, numbered), **Get a signed report** and **Turn on Patch**. The last two only open app.yof.io in your browser. Until ordering opens they read "(opens soon)", as they do in the yof app. A [sample report](https://yof.io/sample) of a made-up site shows what you get, SBOM included.
- **Status bar**: what to fix now and this week, and how many risks are accepted. Click it to check again.
- **yof: Attack my app** runs `yof attack` against your own app (by default `http://localhost:3000`) with your `.yof/attack.json`, in the background. You are asked first; cancel from its notification.

## Privacy

- **No telemetry unless you opt in.** `yof.shareScanCount` is off by default. After your first finished scan, yof asks once: "Help yof count scans?" If you say yes, each finished scan sends one request to `api.mondaily.com` with exactly four fields: `scan_finished`, the extension version, the editor's name (VS Code, Cursor, Windsurf, VSCodium or other) and the day. No code, file names, paths, findings or ids. The server keeps only a daily count per version and editor, and does not store your IP address. While your editor's own telemetry setting is off, yof never asks and never sends. Turn it off any time in Settings.
- The check makes **no network call** unless you turn on `yof.packageLookups` (then package names and pinned versions go to npm, PyPI and OSV, nothing else).
- "Get a signed report" and "Turn on Patch" only open a web page; the extension sends nothing for them.
- The extension bundles the CLI, so nothing is downloaded. It uses your project's own `node_modules/.bin/yof` when there is one.
- In a workspace you have not trusted, only the bundled CLI runs (never a program from the project) and yof attack is off.
- yof attack only goes where the CLI allows it: localhost, a preview GitHub reports as a deployment of your repository, or your live host with your yof proof token. It needs your written consent in `.yof/attack.json`, word for word.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `yof.checkOnSave` | `true` | Check when you save |
| `yof.packageLookups` | `false` | Also check dependencies against npm, PyPI and OSV |
| `yof.profile` | (from .yof.yml) | `relaxed`, `balanced` or `strict` |
| `yof.cliPath` | (empty) | A yof executable to run instead |
| `yof.checkTimeoutSeconds` | `60` | Stop a check that takes longer |
| `yof.attack.target` | `http://localhost:3000` | The address yof attack tests |
| `yof.attack.config` | `.yof/attack.json` | The attack config |
| `yof.attack.mode` | `full` | `full`, or `light` for read-only requests |
| `yof.attack.envFile` | (empty) | A KEY=VALUE file with your test accounts; only `YOF_` names are read |
| `yof.shareScanCount` | `false` | Opt-in scan count (see Privacy); always off while your editor's telemetry is off |

## Commands

- **yof: Check this workspace**
- **yof: Accept this risk…**
- **yof: Reopen accepted risk**
- **yof: Get a signed report**
- **yof: Turn on Patch**
- **yof: Attack my app (yof attack)**
- **yof: Stop yof attack**
- **yof: Show output**

## Try it

The [yof demo app](https://github.com/yof-dev/yof-demo) has five planted, clearly labelled problems for yof check and yof attack to find.

## Licence

Apache 2.0. Security reports: security@yof.io (see SECURITY.md).
