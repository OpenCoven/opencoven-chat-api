import assert from "node:assert/strict";
import {
  reindexDocsIfChanged,
  type IndexResult,
  type ReindexState,
  type ReindexStateStore,
} from "../rag/reindex-freshness";

class MemoryStateStore implements ReindexStateStore {
  state: ReindexState | null = null;

  async get(): Promise<ReindexState | null> {
    return this.state;
  }

  async set(state: ReindexState): Promise<void> {
    this.state = state;
  }
}

function successfulIndexResult(): IndexResult {
  return {
    success: true,
    pagesProcessed: 2,
    chunksCreated: 7,
    uniqueTerms: 42,
    errors: [],
    duration: 123,
  };
}

{
  const store = new MemoryStateStore();
  let indexCalls = 0;

  const first = await reindexDocsIfChanged({
    trigger: "test",
    store,
    fetchDocsText: async () => "# Home\nSource: https://docs.opencoven.ai/\n\nFresh docs.",
    indexDocs: async () => {
      indexCalls += 1;
      return successfulIndexResult();
    },
  });

  assert.equal(first.status, "indexed");
  assert.equal(indexCalls, 1);
  assert.ok(store.state?.docsHash);
  assert.equal(store.state?.trigger, "test");

  const second = await reindexDocsIfChanged({
    trigger: "test",
    store,
    fetchDocsText: async () => "# Home\nSource: https://docs.opencoven.ai/\n\nFresh docs.",
    indexDocs: async () => {
      indexCalls += 1;
      return successfulIndexResult();
    },
  });

  assert.equal(second.status, "skipped");
  assert.equal(second.reason, "unchanged");
  assert.equal(indexCalls, 1);

  const forced = await reindexDocsIfChanged({
    trigger: "test",
    force: true,
    store,
    fetchDocsText: async () => "# Home\nSource: https://docs.opencoven.ai/\n\nFresh docs.",
    indexDocs: async () => {
      indexCalls += 1;
      return successfulIndexResult();
    },
  });

  assert.equal(forced.status, "indexed");
  assert.equal(indexCalls, 2);
}

{
  const store = new MemoryStateStore();
  await reindexDocsIfChanged({
    trigger: "test",
    store,
    fetchDocsText: async () => "first version",
    indexDocs: async () => successfulIndexResult(),
  });

  let indexCalls = 0;
  const changed = await reindexDocsIfChanged({
    trigger: "test",
    store,
    fetchDocsText: async () => "second version",
    indexDocs: async () => {
      indexCalls += 1;
      return successfulIndexResult();
    },
  });

  assert.equal(changed.status, "indexed");
  assert.equal(changed.reason, "changed");
  assert.equal(indexCalls, 1);
}

{
  const store = new MemoryStateStore();
  await reindexDocsIfChanged({
    trigger: "test",
    store,
    fetchDocsText: async () => "stable version",
    indexDocs: async () => successfulIndexResult(),
  });
  const originalHash = store.state?.docsHash;

  const failed = await reindexDocsIfChanged({
    trigger: "test",
    store,
    fetchDocsText: async () => "broken version",
    indexDocs: async () => ({
      success: false,
      pagesProcessed: 0,
      chunksCreated: 0,
      uniqueTerms: 0,
      errors: ["embedding service unavailable"],
      duration: 10,
    }),
  });

  assert.equal(failed.status, "error");
  assert.equal(failed.reason, "index-failed");
  assert.equal(store.state?.docsHash, originalHash);
}

console.log("reindex-freshness: ok");
