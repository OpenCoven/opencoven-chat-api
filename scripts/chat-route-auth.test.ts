import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../app/api/chat/route";

const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalPassword = process.env.SALEM_ADMIN_PASSWORD;

function restoreEnv() {
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }

  if (originalPassword === undefined) {
    delete process.env.SALEM_ADMIN_PASSWORD;
  } else {
    process.env.SALEM_ADMIN_PASSWORD = originalPassword;
  }
}

function chatRequest(headers: Record<string, string> = {}) {
  return new NextRequest(
    new Request("https://salem.opencoven.ai/api/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        message: "What does Coven do?",
        history: [{ role: "user", content: "What is OpenCoven?" }],
      }),
    }),
  );
}

try {
  delete process.env.OPENAI_API_KEY;

  delete process.env.SALEM_ADMIN_PASSWORD;
  const unconfigured = await POST(chatRequest());
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(await unconfigured.json(), {
    error: "Follow-up access is not configured",
    status: 503,
  });

  process.env.SALEM_ADMIN_PASSWORD = "secret-salem";
  const unauthorized = await POST(chatRequest());
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), {
    error: "Password required for follow-up conversations",
    status: 401,
  });

  const wrongPassword = await POST(
    chatRequest({ "X-Salem-Admin-Password": "wrong" }),
  );
  assert.equal(wrongPassword.status, 401);
} finally {
  restoreEnv();
}

console.log("chat-route-auth: ok");
