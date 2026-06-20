/**
 * Documentation Indexer for OpenCoven docs.
 * Fetches documentation from docs.opencoven.ai/llms-full.txt,
 * chunks it, generates embeddings, and stores in Upstash Vector.
 * Also builds BM25 inverted index for keyword search.
 */
import { Embeddings } from "./embeddings";
import { DocsStore, DocsChunk } from "./store-upstash";
import { buildTermIndex, storeTermIndex } from "./bm25-searcher";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// Web Crypto API helpers for Edge Runtime compatibility
async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyBuffer = encoder.encode(key);
  const dataBuffer = encoder.encode(data);
  
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataBuffer);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const DOCS_BASE_URL = "https://docs.opencoven.ai";
export const LLMS_FULL_URL = `${DOCS_BASE_URL}/llms-full.txt`;
const SUPPLEMENTARY_DIR = join(process.cwd(), "docs");

// Coven Code docs (code.opencoven.ai) are a client-rendered SPA with no
// llms-full.txt, so we source the published pages from the markdown that
// generates the site: OpenCoven/coven-code's top-level docs/ directory.
export const COVEN_CODE_BASE_URL = "https://code.opencoven.ai";
const COVEN_CODE_TREE_API =
  "https://api.github.com/repos/OpenCoven/coven-code/git/trees/main?recursive=1";
const COVEN_CODE_RAW_BASE =
  "https://raw.githubusercontent.com/OpenCoven/coven-code/main/";
// Repo docs/ files that exist but are not published as user-facing pages.
const COVEN_CODE_DOC_EXCLUDES = new Set([
  "docs/AUDIT-2026-06.md",
  "docs/SECURITY_PERF_AUDIT.md",
]);

export interface DocPage {
  url: string;
  path: string;
  title: string;
  content: string;
}

export interface IndexResult {
  success: boolean;
  pagesProcessed: number;
  chunksCreated: number;
  uniqueTerms: number;
  errors: string[];
  duration: number;
}

/**
 * Fetches and parses llms-full.txt which contains all documentation.
 * The format is markdown with sections separated by "# title" headers
 * and "Source: URL" lines.
 */
async function fetchLlmsFullText(): Promise<string> {
  const response = await fetch(LLMS_FULL_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch llms-full.txt: ${response.status}`);
  }

  return await response.text();
}

async function fetchDocsFromLlmsTxt(): Promise<DocPage[]> {
  console.log(`Fetching documentation from ${LLMS_FULL_URL}...`);

  const content = await fetchLlmsFullText();
  const pages: DocPage[] = [];

  // Split by top-level headers (# title)
  // The format is:
  // # Title
  // Source: https://docs.opencoven.ai/path
  // 
  // Content...
  const sections = content.split(/\n(?=# [^\n]+\nSource:)/);

  for (const section of sections) {
    if (!section.trim()) continue;

    // Extract title (first line starting with #)
    const titleMatch = section.match(/^# ([^\n]+)/);
    if (!titleMatch) continue;
    const title = titleMatch[1].trim();

    // Extract source URL
    const sourceMatch = section.match(/\nSource: (https?:\/\/[^\n]+)/);
    if (!sourceMatch) continue;
    const url = sourceMatch[1].trim();

    // Extract path from URL
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // Extract content (everything after the Source line)
    const contentStart = section.indexOf("\n", section.indexOf("Source:"));
    if (contentStart === -1) continue;

    let pageContent = section.slice(contentStart).trim();

    // Clean up markdown content
    pageContent = cleanMarkdown(pageContent);

    // Skip empty or very short content
    if (pageContent.length < 50) {
      console.warn(`Skipping ${title}: content too short (${pageContent.length} chars)`);
      continue;
    }

    pages.push({ url, path, title, content: pageContent });
  }

  console.log(`Parsed ${pages.length} documentation pages from llms-full.txt`);
  return pages;
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  return titleMatch ? titleMatch[1].trim() : fallback;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, "");
}

function pageFromMarkdown(args: {
  markdown: string;
  url: string;
  path: string;
  fallbackTitle: string;
}): DocPage | null {
  const withoutFrontmatter = stripFrontmatter(args.markdown);
  const content = cleanMarkdown(withoutFrontmatter);
  if (content.length < 50) return null;

  return {
    url: args.url,
    path: args.path,
    title: titleFromMarkdown(withoutFrontmatter, args.fallbackTitle),
    content,
  };
}

function decodeBase64Content(value: string): string {
  return Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8");
}

export async function fetchPrivateResearchDocs(): Promise<DocPage[]> {
  const pages: DocPage[] = [];
  const inlineBase64 = process.env.SALEM_PRIVATE_RESEARCH_DOCS_BASE64?.trim();

  if (inlineBase64) {
    const page = pageFromMarkdown({
      markdown: decodeBase64Content(inlineBase64),
      url: "private://opencoven/research/inline",
      path: "/private-research/inline",
      fallbackTitle: "OpenCoven Private Research",
    });
    if (page) pages.push(page);
  }

  const repo = process.env.SALEM_PRIVATE_RESEARCH_REPO?.trim();
  const ref = process.env.SALEM_PRIVATE_RESEARCH_REF?.trim() || "main";
  const paths = (process.env.SALEM_PRIVATE_RESEARCH_PATHS ?? "")
    .split(/[,\n]/)
    .map((path) => path.trim())
    .filter(Boolean);

  if (repo || paths.length > 0) {
    const token =
      process.env.SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN?.trim() ||
      process.env.GITHUB_TOKEN?.trim() ||
      process.env.GH_TOKEN?.trim();

    if (!repo || paths.length === 0 || !token) {
      throw new Error(
        "Private research GitHub source requires SALEM_PRIVATE_RESEARCH_REPO, SALEM_PRIVATE_RESEARCH_PATHS, and SALEM_PRIVATE_RESEARCH_GITHUB_TOKEN",
      );
    }

    for (const sourcePath of paths) {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(sourcePath)}?ref=${encodeURIComponent(ref)}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "opencoven-chat-api-indexer",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch private research source ${repo}/${sourcePath}: ${response.status}`);
      }

      const payload = (await response.json()) as { content?: unknown; encoding?: unknown };
      if (typeof payload.content !== "string") {
        throw new Error(`Private research source ${repo}/${sourcePath} did not include file content`);
      }

      const markdown = decodeBase64Content(payload.content);
      const page = pageFromMarkdown({
        markdown,
        url: `private://github/${repo}/${sourcePath}`,
        path: `/private-research/github/${repo}/${sourcePath}`,
        fallbackTitle: sourcePath.replace(/^.*\//, "").replace(/\.(md|mdx)$/, ""),
      });
      if (page) pages.push(page);
    }
  }

  if (pages.length > 0) {
    console.log(`Loaded ${pages.length} private research page(s)`);
  }

  return pages;
}

export async function fetchIndexedSourceText(): Promise<string> {
  const parts = [await fetchLlmsFullText()];
  const privateResearchPages = await fetchPrivateResearchDocs();

  for (const page of privateResearchPages) {
    parts.push(`# ${page.title}\nSource: ${page.url}\n\n${page.content}`);
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Maps a repo docs/ path to its published code.opencoven.ai URL.
 * e.g. "docs/agents.md" -> "https://code.opencoven.ai/agents",
 *      "docs/index.md"  -> "https://code.opencoven.ai".
 */
function covenCodeUrlForDoc(path: string): string {
  const slug = path.replace(/^docs\//, "").replace(/\.md$/, "");
  return slug === "index"
    ? COVEN_CODE_BASE_URL
    : `${COVEN_CODE_BASE_URL}/${slug}`;
}

/**
 * Fetches Coven Code documentation (code.opencoven.ai) from the source
 * markdown in OpenCoven/coven-code. Discovers the published pages from the
 * repo's top-level docs/ directory so new pages are picked up automatically
 * on every reindex.
 */
async function fetchCovenCodeDocs(): Promise<DocPage[]> {
  console.log(`Fetching Coven Code documentation for ${COVEN_CODE_BASE_URL}...`);
  const pages: DocPage[] = [];

  const treeResponse = await fetch(COVEN_CODE_TREE_API, {
    headers: { "User-Agent": "opencoven-chat-api-indexer" },
  });
  if (!treeResponse.ok) {
    throw new Error(`Failed to list coven-code docs: ${treeResponse.status}`);
  }

  const tree = (await treeResponse.json()) as {
    tree?: { path: string; type: string }[];
  };

  // Top-level docs/*.md only — skips nested paths (docs/superpowers/**, etc.)
  // and any explicitly excluded internal files.
  const docPaths = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .filter((path) => /^docs\/[^/]+\.md$/.test(path))
    .filter((path) => !COVEN_CODE_DOC_EXCLUDES.has(path));

  for (const path of docPaths) {
    const rawResponse = await fetch(`${COVEN_CODE_RAW_BASE}${path}`);
    if (!rawResponse.ok) {
      console.warn(`Skipping ${path}: fetch failed (${rawResponse.status})`);
      continue;
    }

    const raw = await rawResponse.text();
    const url = covenCodeUrlForDoc(path);
    const slug = path.replace(/^docs\//, "").replace(/\.md$/, "");

    // Title from the first markdown heading (index.md wraps it in a <div>).
    const titleMatch = raw.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : slug;

    const content = cleanMarkdown(raw);
    if (content.length < 50) {
      console.warn(`Skipping ${path}: content too short (${content.length} chars)`);
      continue;
    }

    pages.push({ url, path: new URL(url).pathname, title, content });
  }

  console.log(`Parsed ${pages.length} Coven Code documentation pages`);
  return pages;
}

/**
 * Loads supplementary knowledge base files from the local docs/ directory.
 * Files use the same format as llms-full.txt (# Title / Source: URL / content).
 */
function loadSupplementaryDocs(): DocPage[] {
  const pages: DocPage[] = [];

  let files: string[];
  try {
    files = readdirSync(SUPPLEMENTARY_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return pages;
  }

  for (const file of files) {
    const content = readFileSync(join(SUPPLEMENTARY_DIR, file), "utf-8");
    const sections = content.split(/\n(?=# [^\n]+\nSource:)/);

    for (const section of sections) {
      if (!section.trim()) continue;

      const titleMatch = section.match(/^# ([^\n]+)/);
      if (!titleMatch) continue;
      const title = titleMatch[1].trim();

      const sourceMatch = section.match(/\nSource: (https?:\/\/[^\n]+)/);
      if (!sourceMatch) continue;
      const url = sourceMatch[1].trim();

      const urlObj = new URL(url);
      const path = urlObj.pathname;

      const contentStart = section.indexOf("\n", section.indexOf("Source:"));
      if (contentStart === -1) continue;

      let pageContent = section.slice(contentStart).trim();
      pageContent = cleanMarkdown(pageContent);

      if (pageContent.length < 50) continue;

      pages.push({ url, path, title, content: pageContent });
    }
  }

  if (pages.length > 0) {
    console.log(`Loaded ${pages.length} supplementary knowledge pages from ${files.length} file(s)`);
  }

  return pages;
}

/**
 * Cleans up markdown content for embedding.
 */
function cleanMarkdown(markdown: string): string {
  return markdown
    // Remove code fence language identifiers
    .replace(/```\w+\s*/g, "```\n")
    // Remove excessive newlines
    .replace(/\n{3,}/g, "\n\n")
    // Normalize whitespace
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Splits content into chunks suitable for embedding.
 * Uses a sliding window approach with overlap for context.
 */
async function chunkContent(
  page: DocPage,
  chunkSize: number = 1000,
  overlap: number = 200
): Promise<DocsChunk[]> {
  const chunks: DocsChunk[] = [];
  const content = page.content;

  if (content.length <= chunkSize) {
    // Single chunk for short content
    chunks.push({
      id: await generateChunkId(page.url, 0),
      path: page.path,
      title: page.title,
      content: content,
      url: page.url,
      vector: [], // Will be filled by embeddings
    });
    return chunks;
  }

  // Split into overlapping chunks
  let start = 0;
  let chunkIndex = 0;

  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length);

    // Try to break at sentence or paragraph boundary
    if (end < content.length) {
      const breakPoints = [". ", ".\n", "\n\n", "\n", " "];
      for (const bp of breakPoints) {
        const lastBreak = content.lastIndexOf(bp, end);
        if (lastBreak > start + chunkSize / 2) {
          end = lastBreak + bp.length;
          break;
        }
      }
    }

    const chunkText = content.slice(start, end).trim();

    if (chunkText.length > 50) {
      chunks.push({
        id: await generateChunkId(page.url, chunkIndex),
        path: page.path,
        title: `${page.title}${chunkIndex > 0 ? ` (Part ${chunkIndex + 1})` : ""}`,
        content: chunkText,
        url: page.url,
        vector: [],
      });
      chunkIndex++;
    }

    start = end - overlap;
    if (start >= content.length - overlap) break;
  }

  return chunks;
}

/**
 * Generates a deterministic chunk ID based on URL and position.
 */
async function generateChunkId(url: string, index: number): Promise<string> {
  const hash = await sha256Hex(`${url}:${index}`);
  return hash.slice(0, 16);
}

/**
 * Main indexing function.
 * Fetches all docs, chunks them, generates embeddings, and stores in vector DB.
 */
export async function indexDocs(): Promise<IndexResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  console.log("Starting documentation indexing...");

  // Validate environment
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return {
      success: false,
      pagesProcessed: 0,
      chunksCreated: 0,
      uniqueTerms: 0,
      errors: ["OPENAI_API_KEY or GEMINI_API_KEY is required"],
      duration: Date.now() - startTime,
    };
  }

  try {
    // Initialize components
    const embeddings = Embeddings.fromEnv();
    const store = new DocsStore();

    // Fetch documentation from llms-full.txt
    const pages = await fetchDocsFromLlmsTxt();

    if (pages.length === 0) {
      return {
        success: false,
        pagesProcessed: 0,
        chunksCreated: 0,
        uniqueTerms: 0,
        errors: ["No documentation pages could be fetched from llms-full.txt"],
        duration: Date.now() - startTime,
      };
    }


    const mainDocsCount = pages.length;

    // Merge Coven Code documentation (code.opencoven.ai). Best-effort: a
    // GitHub outage should not block reindexing the primary docs.
    let covenCodePages: DocPage[] = [];
    try {
      covenCodePages = await fetchCovenCodeDocs();
      pages.push(...covenCodePages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to fetch Coven Code docs: ${message}`);
      errors.push(`coven-code docs: ${message}`);
    }

    // Merge supplementary knowledge base (local docs/ directory)
    const supplementary = loadSupplementaryDocs();
    pages.push(...supplementary);

    // Merge private research sources when explicitly configured. Fail closed
    // if configuration exists but cannot be read, so a reindex does not silently
    // drop proprietary research from Salem.
    const privateResearchPages = await fetchPrivateResearchDocs();
    pages.push(...privateResearchPages);

    console.log(
      `Fetched ${mainDocsCount} primary + ${covenCodePages.length} Coven Code + ${supplementary.length} supplementary + ${privateResearchPages.length} private research pages`
    );

    // Chunk all pages
    console.log("Chunking content...");
    const allChunks: DocsChunk[] = [];
    for (const page of pages) {
      const chunks = await chunkContent(page);
      allChunks.push(...chunks);
    }
    console.log(`Created ${allChunks.length} chunks from ${pages.length} pages`);

    // Generate embeddings in batches
    console.log("Generating embeddings...");
    const texts = allChunks.map((chunk) => chunk.content);
    const vectors = await embeddings.embedBatch(texts);

    // Attach vectors to chunks
    for (let i = 0; i < allChunks.length; i++) {
      allChunks[i].vector = vectors[i];
    }

    // Store in vector database
    console.log("Storing in vector database...");
    await store.replaceAll(allChunks);

    // Build and store BM25 index for keyword search
    console.log("Building BM25 index...");
    const termIndex = buildTermIndex(
      allChunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        title: chunk.title,
      }))
    );
    await storeTermIndex(termIndex);
    console.log(
      `BM25 index built with ${termIndex.totalDocs} documents and ${termIndex.terms.size} unique terms`
    );

    const duration = Date.now() - startTime;
    console.log(`Indexing complete in ${duration}ms`);

    return {
      success: true,
      pagesProcessed: pages.length,
      chunksCreated: allChunks.length,
      uniqueTerms: termIndex.terms.size,
      errors,
      duration,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(errorMessage);
    console.error("Indexing failed:", error);

    return {
      success: false,
      pagesProcessed: 0,
      chunksCreated: 0,
      uniqueTerms: 0,
      errors,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Verifies GitHub webhook signature.
 */
export async function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;

  try {
    const expectedSignature = `sha256=${await hmacSha256Hex(secret, payload)}`;
    // Constant-time comparison to prevent timing attacks
    return timingSafeEqual(signature, expectedSignature);
  } catch {
    return false;
  }
}

/**
 * Parses GitHub push event to determine if it's a main branch update.
 */
export function isMainBranchPush(event: string | null, payload: unknown): boolean {
  if (event !== "push") return false;

  const data = payload as { ref?: string };
  return data.ref === "refs/heads/main" || data.ref === "refs/heads/master";
}
