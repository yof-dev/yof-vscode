/**
 * Builds the extension into dist/:
 *   dist/extension.js   the extension, one CommonJS file (vscode stays external), no runtime dependencies
 *   dist/yof-cli.cjs    the yof CLI itself, one self-contained file, so a check needs no download and no network
 *
 * The CLI comes from, in order: YOF_CLI_DIR, node_modules/@yof/cli (the release workflow installs the version in
 * package.json "yofCli" there), or ../yof (the folder next to this one in the source repository, built first).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const ROOT = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const want = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).yofCli;

const candidates = [process.env.YOF_CLI_DIR, join(ROOT, "node_modules", "@yof", "cli"), join(ROOT, "..", "yof")].filter(Boolean);
const cliDir = candidates.find((d) => existsSync(join(d, "dist", "bin.cjs")));
if (!cliDir) {
  console.error(`No built yof CLI found. Install it (npm install --no-save @yof/cli@${want}) or set YOF_CLI_DIR.`);
  process.exit(1);
}
const got = JSON.parse(readFileSync(join(cliDir, "package.json"), "utf8")).version;
if (got !== want) {
  console.error(`The yof CLI at ${cliDir} is ${got}, but package.json "yofCli" asks for ${want}.`);
  process.exit(1);
}
mkdirSync(join(ROOT, "dist"), { recursive: true });
copyFileSync(join(cliDir, "dist", "bin.cjs"), join(ROOT, "dist", "yof-cli.cjs"));
console.log(`Bundled @yof/cli ${got} as dist/yof-cli.cjs`);

const options = {
  entryPoints: [join(ROOT, "src", "extension.ts")],
  outfile: join(ROOT, "dist", "extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: false,
  minify: !watch,
  logLevel: "info",
};
if (watch) await (await esbuild.context(options)).watch();
else await esbuild.build(options);
