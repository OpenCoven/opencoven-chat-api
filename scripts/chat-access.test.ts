import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST } from "../app/api/chat/route";

const original = { ...process.env };
try {
  // No network or model calls should happen before authentication.
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.OPENAI_API_KEY;
  process.env.SALEM_ADMIN_PASSWORD = "test-access-password";
  for (const body of [
    { message: "First question" },
    { message: "Follow up", history: [] },
    { message: "Follow up", userId: "admin", history: [{ role: "user", content: "Previous" }] },
  ]) {
    const response = await POST(new NextRequest("https://salem.opencoven.ai/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Salem-Admin-Password": "test-access-password" },
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 401, "Every request requires an authenticated user session");
  }
} finally {
  process.env = original;
}
console.log("chat-access: ok");
