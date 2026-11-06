# yof for VS Code

Leaked keys and made-up packages show up in **Problems** when you save, each with a plain explanation and a prompt you can paste into the AI assistant that wrote the code. Works in VS Code, and in Cursor, Windsurf and other editors that install extensions from Open VSX.

It runs the open-source [yof CLI](https://github.com/yof-dev/yof) on your machine. Rules only, no AI, no account, no telemetry.

## What it does

- **On save**, `yof check` runs for the workspace folder in the background. Typing is never blocked: a newer save cancels an older check, and every check has a time limit.
- **Problems**: each finding with its urgency (fix now is an error, fix this week a warning), the masked value and what can happen, in plain words.
- **Quick fix**: "yof: Copy the fix prompt for your AI assistant" puts a ready prompt on the clipboard. It carries the masked value only, never the full key.
- **Status bar**: what to fix now and this week. Click it to check again.
- **yof: Attack my app** runs `yof attack` against your own app (by default `http://localhost:3000`) with your `.yof/attack.json`, in the background. You are asked first; cancel from its notification.

## Private by default

- The check makes **no network call** unless you turn on `yof.packageLookups` (then package names and pinned versions go to npm, PyPI and OSV, nothing else).
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

## Commands

- **yof: Check this workspace**
- **yof: Attack my app (yof attack)**
- **yof: Stop yof attack**
- **yof: Show output**

## Try it

The [yof demo app](https://github.com/yof-dev/yof-demo) has one planted, clearly labelled problem for yof attack to find.

## Licence

Apache 2.0. Security reports: security@mondaily.com (see SECURITY.md).
