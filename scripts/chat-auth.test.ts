import assert from "node:assert/strict";
import {
  buildChatMessages,
  filterPrivateSourceResults,
  isPrivateSourceUrl,
  normalizeChatHistory,
} from "../app/api/chat/auth";

const originalPassword = process.env.SALEM_ADMIN_PASSWORD;

function restorePassword() {
  if (originalPassword === undefined) {
    delete process.env.SALEM_ADMIN_PASSWORD;
  } else {
    process.env.SALEM_ADMIN_PASSWORD = originalPassword;
  }
}

try {
  const normalized = normalizeChatHistory([
    { role: "user", content: "  First question?  " },
    { role: "assistant", content: " First answer. " },
    { role: "system", content: "drop me" },
    { role: "user", content: "" },
    { role: "assistant", content: "x".repeat(2600) },
  ]);

  assert.deepEqual(normalized.slice(0, 2), [
    { role: "user", content: "First question?" },
    { role: "assistant", content: "First answer." },
  ]);
  assert.equal(normalized.length, 3);
  assert.equal(normalized[2].content.length, 2000);

  assert.equal(isPrivateSourceUrl("private://opencoven/research/inline"), true);
  assert.equal(isPrivateSourceUrl("https://docs.opencoven.ai/docs/reference"), false);

  const publicResult = { title: "Docs", url: "https://docs.opencoven.ai/docs" };
  const privateResult = { title: "Research", url: "private://opencoven/research/inline" };
  assert.deepEqual(
    filterPrivateSourceResults([publicResult, privateResult], false),
    [publicResult],
  );
  assert.deepEqual(
    filterPrivateSourceResults([publicResult, privateResult], true),
    [publicResult, privateResult],
  );

  const messages = buildChatMessages({
    systemPrompt: "system",
    history: normalized,
    currentMessage: "Follow up?",
  });

  assert.deepEqual(messages, [
    { role: "system", content: "system" },
    { role: "user", content: "First question?" },
    { role: "assistant", content: "First answer." },
    { role: "assistant", content: "x".repeat(2000) },
    { role: "user", content: "Follow up?" },
  ]);

  // Retrieved documentation must arrive at user trust level, immediately before
  // the question, and never be folded into the system message.
  const withContext = buildChatMessages({
    systemPrompt: "system",
    history: [],
    contextMessage: "<salem-document nonce=\"abc\">excerpt</salem-document>",
    currentMessage: "Follow up?",
  });

  assert.deepEqual(withContext, [
    { role: "system", content: "system" },
    { role: "user", content: "<salem-document nonce=\"abc\">excerpt</salem-document>" },
    { role: "user", content: "Follow up?" },
  ]);
  assert.equal(
    buildChatMessages({ systemPrompt: "system", history: [], contextMessage: null, currentMessage: "Q" }).length,
    2,
    "no retrieval means no context message",
  );
} finally {
  restorePassword();
}

console.log("chat-auth: ok");
