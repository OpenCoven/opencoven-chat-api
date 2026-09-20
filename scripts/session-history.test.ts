import assert from "node:assert/strict";
import { AccessService, hashPassword } from "../lib/access";
import { ChatHistoryStore } from "../lib/chat-history";

import { MemoryStore } from "./memory-store";
const original = { ...process.env };
try {
  const store = new MemoryStore();
  const aliceHash = await hashPassword("alice-private-password");
  const bobHash = await hashPassword("bob-private-password");
  process.env.SALEM_ADMIN_PASSWORD = "existing-admin-password";
  process.env.SALEM_USERS_JSON = JSON.stringify([
    { id: "alice", name: "Alice", passwordHash: aliceHash },
    { id: "bob", name: "Bob", passwordHash: bobHash },
  ]);
  let now = Date.now();
  const access = new AccessService(store, () => now);
  assert.equal(await access.login("alice", "wrong"), null);
  assert.equal(await access.login("unknown", "existing-admin-password"), null);
  const alice = (await access.login("alice", "alice-private-password"))!;
  const bob = (await access.login("bob", "bob-private-password"))!;
  assert.equal(alice.user.id, "alice");
  assert.equal(alice.user.privateSources, false);
  assert.equal((await access.login("admin", "existing-admin-password"))!.user.privateSources, true);
  assert.equal((await access.authenticate(alice.token))!.id, "alice");
  assert.equal(await access.authenticate(`${alice.token}tampered`), null);
  await access.logout(bob.token);
  assert.equal(await access.authenticate(bob.token), null);

  const history = new ChatHistoryStore(store);
  const first = await history.save("alice", null, [
    { role: "user", content: "My private question" },
    { role: "assistant", content: "My private answer" },
  ]);
  assert.equal((await history.list("alice"))[0].id, first.id);
  assert.equal((await history.get("alice", first.id))!.messages[1].content, "My private answer");
  assert.equal(await history.get("bob", first.id), null);
  assert.deepEqual(await history.list("bob"), []);
  await history.save("bob", null, [{ role: "user", content: "Bob question" }]);
  assert.equal((await history.list("alice")).length, 1);
  assert.equal(await history.get("alice", "../../bob"), null);
  const lock = await history.lock("alice");
  assert.ok(lock);
  assert.equal(await history.lock("alice"), null, "Concurrent requests cannot overwrite a user's conversations");
  await history.unlock("alice", lock!);
  assert.ok(await history.lock("alice"));

  for (let index = 0; index < 21; index++) {
    await history.save("retention-check", null, [{ role: "user", content: `Question ${index}` }]);
  }
  const retained = await history.list("retention-check");
  assert.equal(retained.length, 20);
  assert.equal(retained[0].title, "Question 20");
  const longChat = await history.save("retention-check", null, Array.from({ length: 42 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `Message ${index}` })));
  assert.equal(longChat.messages.length, 40);
  assert.equal(longChat.messages[0].content, "Message 2");

  // Revocation must affect already issued sessions, not only future logins.
  process.env.SALEM_USERS_JSON = JSON.stringify([{ id: "bob", name: "Bob", passwordHash: bobHash }]);
  assert.equal(await access.authenticate(alice.token), null);
  process.env.SALEM_USERS_JSON = JSON.stringify([{ id: "alice", name: "Alice", passwordHash: bobHash }]);
  assert.equal(await access.authenticate(alice.token), null);
  const admin = (await access.login("admin", "existing-admin-password"))!;
  now += 13 * 60 * 60 * 1000;
  assert.equal(await access.authenticate(admin.token), null);
  delete process.env.SALEM_ADMIN_PASSWORD;
  delete process.env.SALEM_USERS_JSON;
  assert.equal(await access.login("admin", "existing-admin-password"), null);
} finally { process.env = original; }
console.log("session-history: ok");
