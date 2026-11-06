# Contributing

Thanks for helping. Bug reports, fixes and small improvements are welcome. For anything bigger, open an issue first.

## Working on it

```sh
npm install
npm install --no-save @yof/cli@0.2.0   # the CLI the extension bundles (package.json "yofCli")
npm run check                           # type check, tests, build
npm run package                         # yof.vsix
```

Open this folder in VS Code and press F5 to start an Extension Development Host with the extension loaded.

The mapping from the CLI's JSON to diagnostics (`src/diagnostics.ts`), the process runner (`src/process.ts`), the settings (`src/settings.ts`) and the attack checks (`src/attack.ts`) have no VS Code import, so their tests run with plain Vitest.

## Rules

- Nothing may block typing: every run is a child process with a time limit and a cancel.
- No telemetry and no network calls from the extension itself.
- Show only the masked values the CLI prints, never a full secret.
- The words for findings come from the CLI's JSON. Change them in the CLI, not here.
- Add a line to CHANGELOG.md under "Unreleased".

By contributing you agree that your work is licensed under the Apache License 2.0, the licence of this project.
