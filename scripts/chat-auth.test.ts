import assert from "node:assert/strict";
import {
  buildChatMessages,
  canAccessPrivateSources,
  filterPrivateSourceResults,
  getFollowupAuthStatus,
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

  delete process.env.SALEM_ADMIN_PASSWORD;
  assert.equal(getFollowupAuthStatus([], null), "not-required");
  assert.equal(getFollowupAuthStatus(normalized, "anything"), "not-configured");

  process.env.SALEM_ADMIN_PASSWORD = "secret-salem";
  assert.equal(getFollowupAuthStatus(normalized, null), "unauthorized");
  assert.equal(getFollowupAuthStatus(normalized, "wrong"), "unauthorized");
  assert.equal(getFollowupAuthStatus(normalized, "secret-salem"), "authorized");
  assert.equal(canAccessPrivateSources(null), false);
  assert.equal(canAccessPrivateSources("wrong"), false);
  assert.equal(canAccessPrivateSources("secret-salem"), true);

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
} finally {
  restorePassword();
}

console.log("chat-auth: ok");
