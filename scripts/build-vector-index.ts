/**
 * Build script to index OpenCoven documentation into Upstash Vector.
 * Run with: bun run build:index
 */
import { indexDocs } from "../rag/indexer";

console.log("Starting OpenCoven documentation indexing...\n");

const result = await indexDocs();

if (result.success) {
  console.log("\n✅ Indexing completed successfully!");
  console.log(`   Pages processed: ${result.pagesProcessed}`);
  console.log(`   Chunks created: ${result.chunksCreated}`);
  console.log(`   Unique terms (BM25): ${result.uniqueTerms}`);
  console.log(`   Duration: ${result.duration}ms`);
} else {
  console.error("\n❌ Indexing failed!");
  console.error(`   Errors: ${result.errors.join(", ")}`);
  process.exit(1);
}
