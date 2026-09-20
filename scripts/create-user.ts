import { hashPassword } from "../lib/access";

const USAGE = [
  "Usage: pipe a password from your password manager into one of",
  "",
  '  bun run user:hash <lowercase-id> <display-name>   # a SALEM_USERS_JSON entry',
  '  bun run user:hash --private <id> <display-name>   # ...with private research access',
  "  bun run user:hash --hash-only                     # just the hash, for SALEM_ADMIN_PASSWORD",
].join("\n");

const argv = process.argv.slice(2);
const hashOnly = argv.includes("--hash-only");
const privateSources = argv.includes("--private");
const [id, name] = argv.filter((argument) => !argument.startsWith("--"));

const identified = Boolean(id) && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) && Boolean(name?.trim()) && name.length <= 80;
if (process.stdin.isTTY || (!hashOnly && !identified)) {
  console.error(USAGE);
  process.exit(1);
}

const password = (await Bun.stdin.text()).replace(/\r?\n$/, "");
try {
  const passwordHash = await hashPassword(password);
  // --hash-only exists for the SALEM_ADMIN_PASSWORD migration: that variable
  // now accepts a hash in place of the plaintext it used to hold, so the legacy
  // credential is retired by replacing the env value, with no other change.
  console.log(hashOnly ? passwordHash : JSON.stringify({ id, name, passwordHash, privateSources }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to hash password");
  process.exit(1);
}
