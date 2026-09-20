import type { KeyValueStore } from "./storage";

export const SESSION_COOKIE = "salem_session";
export const SESSION_SECONDS = 12 * 60 * 60;
const ITERATIONS = 600_000;
const USER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type SalemUser = { id: string; name: string; privateSources: boolean };
type Account = SalemUser & { credential: string; legacyPassword?: string };
type Session = { userId: string; credentialVersion: string; expiresAt: number };

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function derive(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const value = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  return hex(new Uint8Array(value));
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) throw new Error("Use a password between 12 and 1024 characters");
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2-sha256:${ITERATIONS}:${salt}:${await derive(password, salt)}`;
}
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function accounts(): Account[] {
  const users: Account[] = [];
  const configured = process.env.SALEM_USERS_JSON;
  if (configured) {
    const parsed: unknown = JSON.parse(configured);
    if (!Array.isArray(parsed)) throw new Error("SALEM_USERS_JSON must be an array");
    for (const item of parsed) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !USER_ID.test(item.id)
        || typeof item.name !== "string" || !item.name.trim() || item.name.length > 80
        || typeof item.passwordHash !== "string" || !/^pbkdf2-sha256:600000:[a-f0-9]{32}:[a-f0-9]{64}$/.test(item.passwordHash)
        || (item.privateSources !== undefined && typeof item.privateSources !== "boolean")) {
        throw new Error("Invalid Salem user configuration");
      }
      users.push({ id: item.id, name: item.name.trim(), privateSources: item.privateSources === true, credential: item.passwordHash });
    }
  }
  const legacyPassword = process.env.SALEM_ADMIN_PASSWORD;
  if (legacyPassword) {
    const id = process.env.SALEM_ADMIN_USERNAME || "admin";
    if (!USER_ID.test(id)) throw new Error("Invalid SALEM_ADMIN_USERNAME");
    users.push({ id, name: "Administrator", privateSources: true, credential: legacyPassword, legacyPassword });
  }
  if (new Set(users.map((user) => user.id)).size !== users.length) throw new Error("Duplicate Salem user IDs");
  return users;
}
export function accessConfigured(): boolean { return accounts().length > 0; }
function publicUser(account: Account): SalemUser {
  return { id: account.id, name: account.name, privateSources: account.privateSources };
}
async function version(account: Account): Promise<string> {
  return digest(JSON.stringify([account.id, account.credential, account.privateSources]));
}

export class AccessService {
  constructor(private store: KeyValueStore, private now = Date.now) {}
  async login(username: string, password: string): Promise<{ user: SalemUser; token: string } | null> {
    if (username.length > 64 || password.length > 1024 || !password) return null;
    const account = accounts().find((candidate) => candidate.id === username.trim().toLowerCase());
    // Do password derivation even for unknown users to avoid an account lookup oracle.
    const salt = account?.legacyPassword ? "0".repeat(32) : account?.credential.split(":")[2] || "0".repeat(32);
    const derived = await derive(password, salt);
    const expected = account?.legacyPassword
      ? await digest(account.legacyPassword)
      : account?.credential.split(":")[3] || "0".repeat(64);
    const actual = account?.legacyPassword ? await digest(password) : derived;
    if (!account || !sameSecret(actual, expected)) return null;
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const session: Session = { userId: account.id, credentialVersion: await version(account), expiresAt: this.now() + SESSION_SECONDS * 1000 };
    await this.store.set(`salem:session:${await digest(token)}`, session, SESSION_SECONDS);
    return { user: publicUser(account), token };
  }
  async authenticate(token: string | undefined): Promise<SalemUser | null> {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.store.get<Session>(`salem:session:${await digest(token)}`);
    if (!session || session.expiresAt <= this.now()) return null;
    const account = accounts().find((candidate) => candidate.id === session.userId);
    if (!account || !sameSecret(session.credentialVersion, await version(account))) return null;
    return publicUser(account);
  }
  async logout(token: string | undefined) {
    if (token && /^[a-f0-9]{64}$/.test(token)) await this.store.del(`salem:session:${await digest(token)}`);
  }
}
