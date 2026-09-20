/**
 * Enforces that .env.example and the code agree about configuration.
 *
 * Every `process.env.X` the runtime reads must be documented, and every
 * variable documented must still be read by something. Without this, the two
 * drift in both directions and each direction has already bitten:
 *
 *   - CRON_SECRET went undocumented while being the only name Vercel Cron
 *     sends, so the documented REINDEX_SECRET alone produced a scheduled
 *     reindex that authenticated nobody and reported success anyway.
 *   - SALEM_USERS_JSON went undocumented while being the recommended way to
 *     configure sign-in, leaving SALEM_ADMIN_PASSWORD as the only visible
 *     option -- the weaker, legacy one.
 *   - ALLOWED_ORIGINS stayed documented after the CORS surface was removed.
 *
 * scripts/validate-opencoven-port.mjs also asserts .env.example content, but
 * from a hardcoded allowlist of six names: it cannot notice a variable nobody
 * thought to add to that list, which is the failure this file covers.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const SOURCE_DIRS = ["app", "lib", "rag", "scripts"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

/**
 * Variables the deployment platform or toolchain provides. A developer never
 * sets these in .env, so documenting them as configuration would be misleading.
 * Anything added here is a deliberate exemption, not an oversight.
 */
const PLATFORM_PROVIDED = new Set(["NODE_ENV"]);

function sourceFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(join(root, dir));
  } catch {
    return files;
  }
  for (const entry of entries) {
    const relative = join(dir, entry);
    const absolute = join(root, relative);
    if (statSync(absolute).isDirectory()) {
      files.push(...sourceFiles(relative));
      continue;
    }
    // Tests deliberately set and clear variables to build fixtures; they are
    // not a statement about what the runtime requires.
    if (/\.test\.[a-z]+$/.test(entry)) continue;
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) {
      files.push(relative);
    }
  }
  return files;
}

// Matches process.env.NAME and process.env["NAME"].
const ENV_READ = /process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*["'`]([A-Z_][A-Z0-9_]*)["'`]\s*\])/g;

const usedBy = new Map();
for (const file of SOURCE_DIRS.flatMap(sourceFiles)) {
  const contents = readFileSync(join(root, file), "utf8");
  for (const match of contents.matchAll(ENV_READ)) {
    const name = match[1] ?? match[2];
    if (PLATFORM_PROVIDED.has(name)) continue;
    if (!usedBy.has(name)) usedBy.set(name, new Set());
    usedBy.get(name).add(file);
  }
}

const envExample = readFileSync(join(root, ".env.example"), "utf8");
// A commented-out assignment counts as documented. Optional variables whose
// value is awkward to leave blank -- SALEM_USERS_JSON holds a JSON array -- are
// better shown as a worked example than as an empty key.
const documented = new Set(
  [...envExample.matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)].map((match) => match[1]),
);

assert.ok(usedBy.size > 0, "found no process.env reads; the scan is broken, not the config");

const undocumented = [...usedBy.keys()].filter((name) => !documented.has(name)).sort();
assert.deepEqual(
  undocumented,
  [],
  `.env.example does not document ${undocumented.length} variable(s) the code reads:\n` +
    undocumented
      .map((name) => `  ${name} -- read in ${[...usedBy.get(name)].sort().join(", ")}`)
      .join("\n") +
    "\nAdd each to .env.example, or add it to PLATFORM_PROVIDED if the platform supplies it.",
);

const unused = [...documented].filter((name) => !usedBy.has(name)).sort();
assert.deepEqual(
  unused,
  [],
  `.env.example documents ${unused.length} variable(s) nothing reads: ${unused.join(", ")}.\n` +
    "Remove them, or the file becomes a list of settings that silently do nothing.",
);

console.log(`env-documentation: ok (${usedBy.size} variables, both directions)`);
