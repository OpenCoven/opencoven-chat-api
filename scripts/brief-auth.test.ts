import assert from "node:assert/strict";
import { briefAuthError, getBriefAuthStatus } from "../rag/brief-auth";

const originalAllowed = process.env.SALEM_BRIEF_CLIENT_TOKEN_SHA256;
const originalRevoked = process.env.SALEM_BRIEF_CLIENT_REVOKED_SHA256;

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function restore() {
  if (originalAllowed === undefined) delete process.env.SALEM_BRIEF_CLIENT_TOKEN_SHA256;
  else process.env.SALEM_BRIEF_CLIENT_TOKEN_SHA256 = originalAllowed;

  if (originalRevoked === undefined) delete process.env.SALEM_BRIEF_CLIENT_REVOKED_SHA256;
  else process.env.SALEM_BRIEF_CLIENT_REVOKED_SHA256 = originalRevoked;
}

try {
  const token = "salem-quick-answer-test-token-0001";
  const other = "salem-quick-answer-test-token-0002";
  const tokenHash = await digest(token);
  const otherHash = await digest(other);

  delete process.env.SALEM_BRIEF_CLIENT_TOKEN_SHA256;
  delete process.env.SALEM_BRIEF_CLIENT_REVOKED_SHA256;
  assert.equal(await getBriefAuthStatus(null), "not-configured");

  process.env.SALEM_BRIEF_CLIENT_TOKEN_SHA256 = tokenHash;
  assert.equal(await getBriefAuthStatus(null), "missing");
  assert.equal(await getBriefAuthStatus("Basic xyz"), "malformed");
  assert.equal(await getBriefAuthStatus("Bearer short"), "malformed");
  assert.equal(await getBriefAuthStatus(`Bearer ${other}`), "unauthorized");
  assert.equal(await getBriefAuthStatus(`Bearer ${token}`), "authorized");

  process.env.SALEM_BRIEF_CLIENT_REVOKED_SHA256 = tokenHash;
  assert.equal(await getBriefAuthStatus(`Bearer ${token}`), "revoked");

  process.env.SALEM_BRIEF_CLIENT_REVOKED_SHA256 = otherHash;
  assert.equal(await getBriefAuthStatus(`Bearer ${token}`), "authorized");

  assert.deepEqual(briefAuthError("missing"), {
    httpStatus: 401,
    code: "BRIEF_AUTH_REQUIRED",
    message: "Quick Answer credential required",
  });
  assert.equal(briefAuthError("not-configured").httpStatus, 503);
  assert.equal(briefAuthError("revoked").code, "BRIEF_AUTH_REVOKED");
} finally {
  restore();
}

console.log("brief-auth: ok");
