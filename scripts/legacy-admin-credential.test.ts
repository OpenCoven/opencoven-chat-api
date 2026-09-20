import assert from "node:assert/strict";
import { AccessService, PASSWORD_HASH, digest, hashPassword } from "../lib/access";
import { MemoryStore } from "./memory-store";

// SALEM_ADMIN_PASSWORD was the weakest credential in the system and the only
// account granted private research access unconditionally. These tests pin the
// migration: the same variable now accepts a password hash, the plaintext form
// is verified with PBKDF2 rather than a bare SHA-256, private access must be
// granted explicitly, and no session record carries the plaintext.

const original = { ...process.env };
const ADMIN_PASSWORD = "existing-admin-password";

try {
  delete process.env.SALEM_USERS_JSON;
  delete process.env.SALEM_ADMIN_USERNAME;
  delete process.env.SALEM_ADMIN_PRIVATE_SOURCES;

  // ---- The legacy plaintext form keeps working, so production does not lock out.
  const store = new MemoryStore();
  const access = new AccessService(store);
  process.env.SALEM_ADMIN_PASSWORD = ADMIN_PASSWORD;

  const legacy = await access.login("admin", ADMIN_PASSWORD);
  assert.ok(legacy, "a plaintext SALEM_ADMIN_PASSWORD must still sign in");
  assert.equal(legacy.user.id, "admin");
  assert.equal(await access.login("admin", "wrong-password"), null);
  assert.equal((await access.authenticate(legacy.token))!.id, "admin");

  // ---- Private research access is no longer implied by the admin credential.
  assert.equal(
    legacy.user.privateSources,
    false,
    "the legacy admin account must not receive private research access implicitly",
  );
  process.env.SALEM_ADMIN_PRIVATE_SOURCES = "true";
  const granted = await access.login("admin", ADMIN_PASSWORD);
  assert.equal(granted!.user.privateSources, true, "the grant must be available explicitly");
  // Changing the grant is a privilege change, so it must revoke live sessions.
  assert.equal(
    await access.authenticate(legacy.token),
    null,
    "changing the private-source grant must invalidate sessions issued before it",
  );
  delete process.env.SALEM_ADMIN_PRIVATE_SOURCES;

  // ---- No stored session record may contain the plaintext or its SHA-256.
  const session = await access.login("admin", ADMIN_PASSWORD);
  const stored = JSON.stringify([...store.data.entries()]);
  assert.ok(
    !stored.includes(ADMIN_PASSWORD),
    "a session record must never contain the admin plaintext",
  );
  assert.ok(
    !stored.includes(await digest(ADMIN_PASSWORD)),
    "a session record must not contain an unsalted SHA-256 of the admin plaintext, " +
      "which would make a Redis read enough to crack it offline",
  );
  assert.ok(session);

  // ---- The same variable accepts a PBKDF2 hash. This is the migration: swap
  // the env value and the legacy verification path is no longer used at all.
  const adminHash = await hashPassword(ADMIN_PASSWORD);
  assert.ok(PASSWORD_HASH.test(adminHash));
  process.env.SALEM_ADMIN_PASSWORD = adminHash;

  const migrated = await access.login("admin", ADMIN_PASSWORD);
  assert.ok(migrated, "SALEM_ADMIN_PASSWORD must accept a password hash");
  assert.equal(migrated.user.id, "admin");
  assert.equal(migrated.user.privateSources, false);
  assert.equal(await access.login("admin", "wrong-password"), null);
  assert.equal(
    await access.authenticate(session.token),
    null,
    "migrating the credential form must invalidate sessions issued against the plaintext",
  );

  // A hashed admin credential is a first-class account: it can hold the private
  // research grant without the plaintext weakness.
  process.env.SALEM_ADMIN_PRIVATE_SOURCES = "true";
  assert.equal((await access.login("admin", ADMIN_PASSWORD))!.user.privateSources, true);
  delete process.env.SALEM_ADMIN_PRIVATE_SOURCES;

  // ---- A hash-shaped value is never treated as a plaintext password.
  assert.equal(
    await access.login("admin", adminHash),
    null,
    "presenting the hash itself must not authenticate",
  );

  // ---- SALEM_USERS_JSON still rejects anything that is not a 600k PBKDF2 hash.
  process.env.SALEM_USERS_JSON = JSON.stringify([
    { id: "alice", name: "Alice", passwordHash: "plaintext-not-a-hash" },
  ]);
  assert.equal(PASSWORD_HASH.test("plaintext-not-a-hash"), false);
  await assert.rejects(access.login("alice", "whatever"), /Invalid Salem user configuration/);
  process.env.SALEM_USERS_JSON = JSON.stringify([
    { id: "alice", name: "Alice", passwordHash: await hashPassword("alice-password-123"), privateSources: true },
  ]);
  assert.equal((await access.login("alice", "alice-password-123"))!.user.privateSources, true);

  // ---- The admin username override still applies, and the account ID is part
  // of the legacy salt, so the same password under a different ID is distinct.
  delete process.env.SALEM_USERS_JSON;
  process.env.SALEM_ADMIN_PASSWORD = ADMIN_PASSWORD;
  process.env.SALEM_ADMIN_USERNAME = "operator";
  assert.equal(await access.login("admin", ADMIN_PASSWORD), null);
  assert.ok(await access.login("operator", ADMIN_PASSWORD));
} finally {
  process.env = original;
}

console.log("legacy-admin-credential: ok");
