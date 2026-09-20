import { hashPassword } from "../lib/access";

const [id, name] = process.argv.slice(2);
if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || !name?.trim() || name.length > 80 || process.stdin.isTTY) {
  console.error("Usage: pipe a password from your password manager into bun run user:hash <lowercase-id> <display-name>");
  process.exit(1);
}
const password = (await Bun.stdin.text()).replace(/\r?\n$/, "");
try {
  console.log(JSON.stringify({ id, name, passwordHash: await hashPassword(password), privateSources: false }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to hash password");
  process.exit(1);
}
