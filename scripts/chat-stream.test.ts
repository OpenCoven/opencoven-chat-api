import assert from "node:assert/strict";
import { savedChatStream } from "../lib/chat-stream";
const encoder = new TextEncoder();
function upstream(parts: string[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } });
}
let saved = "";
let released = 0;
const stream = savedChatStream(upstream(['data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]']), async (text) => { saved = text; }, async () => { released++; });
assert.equal(await new Response(stream).text(), "Hello world");
assert.equal(saved, "Hello world");
assert.equal(released, 1);
saved = "";
await assert.rejects(new Response(savedChatStream(upstream(['data: {"choices":[{"delta":{"content":"partial"}}]}\n']), async (text) => { saved = text; }, async () => { released++; })).text());
assert.equal(saved, "");
assert.equal(released, 2);
await assert.rejects(new Response(savedChatStream(upstream(['data: {"choices":[{"delta":{"content":"answer"}}]}\ndata: [DONE]\n']), async () => { throw new Error("storage unavailable"); }, async () => { released++; })).text());
assert.equal(released, 3);
console.log("chat-stream: ok");
