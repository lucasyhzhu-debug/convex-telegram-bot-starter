#!/usr/bin/env node
// scripts/verify-no-secrets.mjs
// Greps the diff (or full tree with --full) for known secret shapes.
// Exit 1 on any hit; 0 on clean. Wired into pre-commit + CI.
//
// C4 (skip lockfiles + generated + sourcemaps): SHA-256 hashes in
// `package-lock.json` `integrity:` fields are 64-hex and would false-positive
// the webhook-secret pattern. We hard-skip these files entirely. Docs are NOT
// whitelisted — use obvious placeholders (e.g. `<your-bot-token>`) in any doc
// that needs to show a token shape.
//
// I2 (narrow whitelist): only .env.example and the script's own test fixtures
// are whitelisted. Pasting a real token into README.md / SETUP.md will FAIL.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PATTERNS = [
  { kind: "telegram-bot-token", re: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g },
  { kind: "webhook-secret-64hex", re: /\b[a-f0-9]{64}\b/g },
  { kind: "convex-deployment", re: /\b[a-z]+-[a-z]+-\d{2,4}\.convex\.(site|cloud)\b/g },
  { kind: "telegram-chat-id", re: /-100\d{10,13}\b/g },
];

// Files where we DON'T scan — known-noisy and not authored content.
const SKIP_FILES = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)\.convex\//,
  /(^|\/)convex\/_generated\//,
  /(^|\/)node_modules\//,
  /\.map$/,
  /(^|\/)scripts\/__tests__\//, // test files intentionally contain pattern fixtures
];

// Files explicitly allowed to contain placeholders that LOOK like patterns
// (but per I2 we DON'T whitelist docs — they must use obvious `<your-X>` placeholders).
const ALLOWED_PATHS = [
  /(^|\/)\.env\.example$/,
];

export function shouldSkipFile(file) {
  return SKIP_FILES.some((re) => re.test(file));
}

export function findSecrets(text, sourceLabel = "<input>") {
  const hits = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      hits.push({ kind, match: m[0], index: m.index ?? 0, source: sourceLabel });
    }
  }
  return hits;
}

function listFiles({ staged, full }) {
  if (full) {
    return execSync("git ls-files", { encoding: "utf8" })
      .split("\n").filter(Boolean);
  }
  if (staged) {
    return execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" })
      .split("\n").filter(Boolean);
  }
  return execSync("git diff --name-only HEAD --diff-filter=ACMR", { encoding: "utf8" })
    .split("\n").filter(Boolean);
}

function isAllowed(file) {
  return ALLOWED_PATHS.some((re) => re.test(file));
}

function main() {
  const argv = process.argv.slice(2);
  const full = argv.includes("--full");
  const staged = argv.includes("--staged");
  const files = listFiles({ staged, full });
  const allHits = [];

  for (const file of files) {
    if (shouldSkipFile(file)) continue;
    let content;
    try { content = readFileSync(file, "utf8"); }
    catch { continue; }
    const hits = findSecrets(content, file);
    for (const h of hits) {
      if (isAllowed(file)) continue;
      allHits.push(h);
    }
  }

  if (allHits.length === 0) {
    console.log("✅ verify-no-secrets: clean");
    process.exit(0);
  }
  console.error("❌ verify-no-secrets: found potential secrets:");
  for (const h of allHits) {
    console.error(`  [${h.kind}] ${h.source}: ${h.match.slice(0, 32)}...`);
  }
  process.exit(1);
}

// Only run main() when invoked as a script, not when imported by tests.
// Use pathToFileURL for correct cross-platform file:// URL construction (Windows needs file:///D:/...).
if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main();
}
