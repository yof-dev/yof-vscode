#!/usr/bin/env node
/**
 * Checks a packaged .vsix before it is published: only the files the extension needs (no source, no tests, no
 * node_modules, no env files), the licence and README inside, and nothing in any file that looks like a real key.
 *
 *   node scripts/check-vsix.mjs yof.vsix
 *
 * No dependencies: reads the zip's central directory and inflates each entry with node:zlib.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** Every entry of a zip file: name and contents. */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("broken zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export const ALLOWED = [
  /^\[Content_Types\]\.xml$/, /^extension\.vsixmanifest$/,
  /^extension\/package\.json$/, /^extension\/(README|CHANGELOG|SECURITY)\.md$/i, /^extension\/LICENSE(\.txt)?$/, /^extension\/NOTICE(\.txt)?$/,
  /^extension\/dist\/extension\.js$/, /^extension\/dist\/yof-cli\.cjs$/,
];
export const REQUIRED = ["extension/package.json", "extension/dist/extension.js", "extension/dist/yof-cli.cjs"];

/** Real-looking keys (a prefix plus a long run), never the short prefixes the CLI's rules and words mention. */
export const KEY_SHAPES = [
  /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{40,}/, /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-\d{6,}-[A-Za-z0-9-]{10,}/, /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}/, /\bsk-ant-[A-Za-z0-9_-]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s*\n[A-Za-z0-9+/=]{40,}/, /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
];

export function checkVsix(entries) {
  const problems = [];
  const names = entries.map((e) => e.name);
  for (const n of names) if (!ALLOWED.some((re) => re.test(n))) problems.push(`unexpected file: ${n}`);
  for (const r of REQUIRED) if (!names.includes(r)) problems.push(`missing: ${r}`);
  if (!names.some((n) => /^extension\/LICENSE(\.txt)?$/.test(n))) problems.push("missing: LICENSE");
  if (!names.some((n) => /^extension\/readme\.md$/i.test(n))) problems.push("missing: README.md");
  for (const e of entries) {
    const text = e.data.toString("utf8");
    for (const re of KEY_SHAPES) if (re.test(text)) problems.push(`${e.name} has something shaped like a real key (${re.source.slice(0, 24)}...)`);
  }
  const pkg = entries.find((e) => e.name === "extension/package.json");
  if (pkg) {
    const j = JSON.parse(pkg.data.toString("utf8"));
    if (j.license !== "Apache-2.0") problems.push(`licence is ${j.license}, not Apache-2.0`);
    if (j.dependencies && Object.keys(j.dependencies).length) problems.push("runtime dependencies listed (the bundle must be self-contained)");
  }
  return problems;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2];
  if (!file) { console.error("Usage: node scripts/check-vsix.mjs <file.vsix>"); process.exit(2); }
  const entries = readZip(readFileSync(file));
  for (const e of entries) console.log(`${String(e.data.length).padStart(9)}  ${e.name}`);
  const problems = checkVsix(entries);
  if (problems.length) { console.error(`\nNot publishing ${file}:\n  ${problems.join("\n  ")}`); process.exit(1); }
  console.log(`\n${file}: ${entries.length} files, all expected, no key-shaped text.`);
}
