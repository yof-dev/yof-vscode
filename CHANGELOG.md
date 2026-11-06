# Changelog

## Unreleased

## 0.1.0 (2026-11-04)

- Runs `yof check` on the workspace folder when you save, in the background. Findings show in Problems with the plain-words explanation; a quick fix copies the prompt to paste into your AI assistant.
- Offline by default: no network call unless `yof.packageLookups` is on.
- "yof: Attack my app" runs `yof attack` against `yof.attack.target` with `.yof/attack.json`, after a question in the editor. Cancel from its notification: the CLI gets SIGTERM and deletes its test records before it exits (it is ended only if it is still running after 15 seconds).
- Status bar item with the counts; settings for the profile, the CLI path and the attack.
- Bundles `@yof/cli` 0.2.0, so nothing is downloaded. In a workspace you have not trusted, only that bundled copy runs and yof attack is off.
- No telemetry.
