import assert from "node:assert/strict";
import { fetchPrivateResearchDocs } from "../rag/indexer";

const originalFetch = globalThis.fetch;
const originalEnv = {
  docsBase64: process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64,
  token: process.env.SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN,
  repo: process.env.SALEM_PRIVATE_RESEARCH_REPO,
  ref: process.env.SALEM_PRIVATE_RESEARCH_REF,
  paths: process.env.SALEM_PRIVATE_RESEARCH_PATHS,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    const envKey = {
      docsBase64: "SALEM_PRIVATE_RESEARCH_DOCS_BASE64",
      token: "SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN",
      repo: "SALEM_PRIVATE_RESEARCH_REPO",
      ref: "SALEM_PRIVATE_RESEARCH_REF",
      paths: "SALEM_PRIVATE_RESEARCH_PATHS",
    }[key]!;
    if (value === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = value;
    }
  }
}

function clearPrivateResearchEnv() {
  delete process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64;
  delete process.env.SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN;
  delete process.env.SALEM_PRIVATE_RESEARCH_REPO;
  delete process.env.SALEM_PRIVATE_RESEARCH_REF;
  delete process.env.SALEM_PRIVATE_RESEARCH_PATHS;
}

try {
  {
    clearPrivateResearchEnv();
    process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64 = Buffer.from(
      "# Private Paper\n\nInternal research body with enough detail to become an indexed Salem research source.",
      "utf8",
    ).toString("base64");

    const pages = await fetchPrivateResearchDocs();

    assert.equal(pages.length, 1);
    assert.equal(pages[0].title, "Private Paper");
    assert.equal(pages[0].url, "private://opencoven/research/inline");
    assert.equal(pages[0].path, "/private-research/inline");
    assert.match(pages[0].content, /Internal research body/);
  }

  {
    clearPrivateResearchEnv();
    process.env.SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN = "github-test-token";
    process.env.SALEM_PRIVATE_RESEARCH_REPO = "OpenCoven/coven-research";
    process.env.SALEM_PRIVATE_RESEARCH_REF = "main";
    process.env.SALEM_PRIVATE_RESEARCH_PATHS =
      "papers/coven-github-agent-research-brief.md";

    const calls: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: input.toString(), auth: headers.get("Authorization") });
      return new Response(
        JSON.stringify({
          content: Buffer.from(
            "# Coven GitHub Agent\n\nPrivate GitHub source body with enough detail to become an indexed Salem research source.",
            "utf8",
          ).toString("base64"),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const pages = await fetchPrivateResearchDocs();

    assert.equal(pages.length, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].auth, "Bearer github-test-token");
    assert.match(calls[0].url, /repos\/OpenCoven\/coven-research\/contents\/papers%2Fcoven-github-agent-research-brief\.md/);
    assert.equal(pages[0].title, "Coven GitHub Agent");
    assert.equal(
      pages[0].url,
      "private://github/OpenCoven/coven-research/papers/coven-github-agent-research-brief.md",
    );
    assert.match(pages[0].content, /Private GitHub source body/);
  }

  {
    clearPrivateResearchEnv();

    const pages = await fetchPrivateResearchDocs();

    assert.deepEqual(pages, []);
  }
} finally {
  globalThis.fetch = originalFetch;
  restoreEnv();
}

console.log("private-research-sources: ok");
