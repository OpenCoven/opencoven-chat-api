import assert from "node:assert/strict";
import {
  BRIEF_READ_SCOPE,
  authenticateBriefRead,
  briefAuthHttpStatus,
} from "../app/api/brief/auth";

const originalActive = process.env.SALEM_BRIEF_READ_TOKEN_SHA256;
const originalRevoked = process.env.SALEM_BRIEF_REVOKED_TOKEN_SHA256S;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function restore() {
  if (originalActive === undefined) delete process.env.SALEM_BRIEF_READ_TOKEN_SHA256;
  else process.env.SALEM_BRIEF_READ_TOKEN_SHA256 = originalActive;

  if (originalRevoked === undefined) delete process.env.SALEM_BRIEF_REVOKED_TOKEN_SHA256S;
  else process.env.SALEM_BRIEF_REVOKED_TOKEN_SHA256S = originalRevoked;
}

const token = "a".repeat(64);
const otherToken = "b".repeat(64);
const revokedToken = "c".repeat(64);

try {
  delete process.env.SALEM_BRIEF_READ_TOKEN_SHA256;
  delete process.env.SALEM_BRIEF_REVOKED_TOKEN_SHA256S;
  assert.deepEqual(await authenticateBriefRead(`Bearer ${token}`), {
    status: "not-configured",
    scope: null,
    fingerprint: null,
  });

  process.env.SALEM_BRIEF_READ_TOKEN_SHA256 = await sha256Hex(token);

  assert.equal((await authenticateBriefRead(null)).status, "missing");
  assert.equal((await authenticateBriefRead(token)).status, "malformed");
  assert.equal((await authenticateBriefRead("Basic abc")).status, "malformed");
  assert.equal((await authenticateBriefRead("Bearer short")).status, "malformed");
  assert.equal((await authenticateBriefRead(`Bearer ${token} `)).status, "malformed");
  assert.equal((await authenticateBriefRead(`Bearer ${otherToken}`)).status, "unauthorized");

  const authorized = await authenticateBriefRead(`Bearer ${token}`);
  assert.equal(authorized.status, "authorized");
  assert.equal(authorized.scope, BRIEF_READ_SCOPE);
  assert.equal(authorized.fingerprint, (await sha256Hex(token)).slice(0, 16));
  assert.equal(authorized.fingerprint?.includes(token.slice(0, 8)), false);

  process.env.SALEM_BRIEF_REVOKED_TOKEN_SHA256S = await sha256Hex(revokedToken);
  const revoked = await authenticateBriefRead(`Bearer ${revokedToken}`);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.scope, null);

  // Revocation wins even if an operator accidentally leaves the same verifier active.
  process.env.SALEM_BRIEF_READ_TOKEN_SHA256 = await sha256Hex(revokedToken);
  assert.equal((await authenticateBriefRead(`Bearer ${revokedToken}`)).status, "revoked");

  process.env.SALEM_BRIEF_READ_TOKEN_SHA256 = "not-a-sha";
  assert.equal((await authenticateBriefRead(`Bearer ${token}`)).status, "not-configured");

  assert.equal(briefAuthHttpStatus("not-configured"), 503);
  assert.equal(briefAuthHttpStatus("missing"), 401);
  assert.equal(briefAuthHttpStatus("malformed"), 401);
  assert.equal(briefAuthHttpStatus("unauthorized"), 401);
  assert.equal(briefAuthHttpStatus("revoked"), 403);
  assert.equal(briefAuthHttpStatus("authorized"), 200);
} finally {
  restore();
}

console.log("brief-auth: ok");
