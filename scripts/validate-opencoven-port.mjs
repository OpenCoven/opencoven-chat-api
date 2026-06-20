import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const packageJson = JSON.parse(read("package.json"));
const readme = read("README.md");
const layout = read("app/layout.tsx");
const page = read("app/page.tsx");
const chatForm = read("app/components/chat-form.tsx");
const chatRoute = read("app/api/chat/route.ts");
const indexer = read("rag/indexer.ts");
const reindexFreshness = read("rag/reindex-freshness.ts");
const cronRoute = read("app/api/cron/reindex/route.ts");
const envExample = read(".env.example");
const logo = read("public/logo.svg");

assert.equal(packageJson.name, "opencoven-chat-api");
assert.equal(
  packageJson.description,
  "RAG-based Salem docs assistant API for OpenCoven documentation",
);
assert.ok(
  !packageJson.dependencies?.["@vercel/analytics"],
  "Vercel Analytics dependency must not be present",
);
assert.ok(
  !existsSync(join(root.pathname, "app/api/feedback/route.ts")),
  "feedback endpoint should be removed with query analytics",
);
assert.ok(
  !existsSync(join(root.pathname, "rag/observability.ts")),
  "query observability storage should be removed",
);

for (const [name, content] of Object.entries({
  readme,
  layout,
  page,
  chatForm,
  chatRoute,
  indexer,
  reindexFreshness,
  cronRoute,
  envExample,
})) {
  assert.ok(
    !content.includes("OpenClaw"),
    `${name} should not contain OpenClaw branding`,
  );
  assert.ok(
    !content.includes("docs.openclaw.ai"),
    `${name} should not point at OpenClaw docs`,
  );
}

assert.ok(readme.includes("Salem Docs Assistant API"));
assert.ok(readme.includes("https://docs.opencoven.ai/llms-full.txt"));
assert.ok(readme.includes("https://salem.opencoven.ai/api/cron/reindex"));
assert.ok(!readme.includes("<salem-api-domain>"));
assert.ok(layout.includes("Salem | OpenCoven Documentation Assistant"));
assert.ok(page.includes("Salem"));
assert.ok(!chatForm.includes("Benchmark"));
assert.ok(!chatForm.includes("diagnostics"));
assert.ok(chatRoute.includes("You are Salem"));
assert.ok(indexer.includes("https://docs.opencoven.ai"));
assert.ok(reindexFreshness.includes("salem:docs:index:last"));
assert.ok(reindexFreshness.includes("docsHash"));
assert.ok(cronRoute.includes("REINDEX_SECRET"));
assert.ok(cronRoute.includes("authorization"));
assert.ok(envExample.includes("REINDEX_SECRET"));
assert.ok(indexer.includes("SALEM_PRIVATE_RESEARCH_DOCS_BASE64"));
assert.ok(envExample.includes("SALEM_PRIVATE_RESEARCH_DOCS_BASE64"));
assert.ok(!envExample.includes("ENABLE_OBSERVABILITY"));

// Salem agent must be configured as OpenCoven's empowered local familiar.
assert.ok(
  chatRoute.includes("OpenCoven's local familiar"),
  "chatRoute should frame Salem as OpenCoven's local familiar",
);
assert.ok(
  chatRoute.includes("IDENTITY:"),
  "chatRoute system prompt should include an IDENTITY section to keep Salem in character",
);

// All runtime requirements must be wired in the example env.
for (const requiredEnv of [
  "UPSTASH_VECTOR_REST_URL",
  "UPSTASH_VECTOR_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
]) {
  assert.ok(
    envExample.includes(requiredEnv),
    `.env.example should document the required ${requiredEnv}`,
  );
}

// Logo must be the OpenCoven mark, not the old OpenClaw pixel lobster.
assert.ok(
  !/lobster|claw/i.test(logo),
  "public/logo.svg should not contain the old OpenClaw lobster branding",
);

console.log("validate-opencoven-port: ok");
