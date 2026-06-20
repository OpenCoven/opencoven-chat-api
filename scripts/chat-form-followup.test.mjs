import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("app/components/chat-form.tsx", "utf8");

assert.match(source, /type ChatMessage =/);
assert.match(source, /const \[messages, setMessages\]/);
assert.match(source, /const \[password, setPassword\]/);
assert.match(source, /X-Salem-Admin-Password/);
assert.match(source, /history:/);
assert.match(source, /Follow-up password/);
assert.match(source, /salem-message assistant/);

console.log("chat-form-followup: ok");
