# Changelog

## 0.1.1 (2026-11-07)

- A file with two or more problems gets one more quick fix: "Copy one fix prompt for all N problems in this file", so your AI assistant edits the file once. The single prompt stays.
- A finding that several rules caught says so ("Also matched: ...") instead of showing twice.

- "yof: Accept this risk…" (a quick fix on a yof finding, and a command): asks for a one-sentence reason and writes it to `.yof/accepted.json` with your git `user.name` (or a name you type) and the date. Accepted findings stay in Problems as information with the reason and leave the open count; a changed line is open again. "yof: Reopen accepted risk" removes the entry. The same file is honoured by the yof CLI and listed in yof's signed reports.
- After a check you start: Copy fix prompt (every open finding's prompt, numbered), Get a signed report and Turn on Patch. The last two only open app.yof.io and read "(opens soon)" until ordering opens.
- Opt-in scan count, off by default: `yof.shareScanCount`, asked once after the first finished scan and never while the editor's telemetry is off. When on, one request per finished scan with `scan_finished`, the version, the editor's name and the day. Nothing else. The description now says "no telemetry unless you opt in".
- Store listing: mentions Cursor, Windsurf, AI builders, security, secrets, the SBOM in signed reports and fix prompts.

## 0.1.0 (2026-11-04)

- Runs `yof check` on the workspace folder when you save, in the background. Findings show in Problems with the plain-words explanation; a quick fix copies the prompt to paste into your AI assistant.
- Offline by default: no network call unless `yof.packageLookups` is on.
- "yof: Attack my app" runs `yof attack` against `yof.attack.target` with `.yof/attack.json`, after a question in the editor. Cancel from its notification: the CLI gets SIGTERM and deletes its test records before it exits (it is ended only if it is still running after 15 seconds).
- Status bar item with the counts; settings for the profile, the CLI path and the attack.
- Bundles `@yof/cli` 0.2.0, so nothing is downloaded. In a workspace you have not trusted, only that bundled copy runs and yof attack is off.
- No telemetry.
