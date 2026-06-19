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
const envExample = read(".env.example");

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
assert.ok(layout.includes("Salem | OpenCoven Documentation Assistant"));
assert.ok(page.includes("Salem"));
assert.ok(!chatForm.includes("Benchmark"));
assert.ok(!chatForm.includes("diagnostics"));
assert.ok(chatRoute.includes("You are Salem"));
assert.ok(indexer.includes("https://docs.opencoven.ai"));
assert.ok(!envExample.includes("ENABLE_OBSERVABILITY"));

console.log("validate-opencoven-port: ok");
