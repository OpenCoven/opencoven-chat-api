import type { KeyValueStore } from "./storage";

export const SESSION_COOKIE = "salem_session";
export const SESSION_SECONDS = 12 * 60 * 60;
const ITERATIONS = 600_000;
const USER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Encoded PBKDF2 credential: `pbkdf2-sha256:<iterations>:<salt>:<hash>`.
 *
 * Accepted both in `SALEM_USERS_JSON` entries and as the value of
 * `SALEM_ADMIN_PASSWORD`. The latter is how the legacy admin account migrates
 * off its plaintext credential without a config-shape change: swap the env
 * value for a hash and the legacy path below stops being used at all.
 */
export const PASSWORD_HASH = new RegExp(
  `^pbkdf2-sha256:${ITERATIONS}:[a-f0-9]{32}:[a-f0-9]{64}$`,
);

/**
 * Salt prefix for a plaintext `SALEM_ADMIN_PASSWORD`.
 *
 * A plaintext env var has nowhere to carry a random per-credential salt, so the
 * salt is derived from the account ID instead. That is weaker than a random
 * salt -- it is not unique across deployments -- but it is the strongest option
 * available for this credential shape, and it replaces what used to be a bare
 * unsalted single-round SHA-256 comparison.
 */
const LEGACY_SALT_PREFIX = "salem-legacy-admin:";

export type SalemUser = { id: string; name: string; privateSources: boolean };

/**
 * A verifiable credential.
 *
 * `pbkdf2` is the supported form. `legacy` exists only for a plaintext
 * `SALEM_ADMIN_PASSWORD` and is verified through the same PBKDF2 derivation, so
 * both forms reach `login()` through one code path with one comparison.
 */
type Credential =
  | { kind: "pbkdf2"; salt: string; hash: string }
  | { kind: "legacy"; salt: string; password: string };
type Account = SalemUser & { credential: Credential };
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
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 1024) {
    throw new Error(`Use a password between ${MIN_PASSWORD_LENGTH} and 1024 characters`);
  }
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2-sha256:${ITERATIONS}:${salt}:${await derive(password, salt)}`;
}
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[salem/access] ${message}`);
}

/**
 * PBKDF2 of a plaintext admin password, memoised for the life of the process.
 *
 * `authenticate()` needs the derived value on every request to compute the
 * session credential version, and 600,000 iterations per request is not
 * affordable. The plaintext is already in `process.env`, so holding it in a map
 * key adds no exposure.
 */
const legacyHashes = new Map<string, Promise<string>>();
function legacyHash(credential: Extract<Credential, { kind: "legacy" }>): Promise<string> {
  const key = `${credential.salt}\u0000${credential.password}`;
  let derived = legacyHashes.get(key);
  if (!derived) {
    derived = derive(credential.password, credential.salt);
    legacyHashes.set(key, derived);
  }
  return derived;
}
function expectedHash(credential: Credential): Promise<string> {
  return credential.kind === "pbkdf2" ? Promise.resolve(credential.hash) : legacyHash(credential);
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
        || typeof item.passwordHash !== "string" || !PASSWORD_HASH.test(item.passwordHash)
        || (item.privateSources !== undefined && typeof item.privateSources !== "boolean")) {
        throw new Error("Invalid Salem user configuration");
      }
      const [, , salt, hash] = item.passwordHash.split(":");
      users.push({ id: item.id, name: item.name.trim(), privateSources: item.privateSources === true, credential: { kind: "pbkdf2", salt, hash } });
    }
  }
  const adminCredential = process.env.SALEM_ADMIN_PASSWORD;
  if (adminCredential) {
    const id = process.env.SALEM_ADMIN_USERNAME || "admin";
    if (!USER_ID.test(id)) throw new Error("Invalid SALEM_ADMIN_USERNAME");
    // Private research access is no longer implied by holding the admin
    // credential. It was previously unconditional, which made the account that
    // is easiest to misconfigure also the most privileged one by default.
    const privateSources = process.env.SALEM_ADMIN_PRIVATE_SOURCES === "true";
    let credential: Credential;
    if (PASSWORD_HASH.test(adminCredential)) {
      const [, , salt, hash] = adminCredential.split(":");
      credential = { kind: "pbkdf2", salt, hash };
    } else {
      credential = { kind: "legacy", salt: `${LEGACY_SALT_PREFIX}${id}`, password: adminCredential };
      warnOnce(
        "SALEM_ADMIN_PASSWORD holds a plaintext password. Replace its value with the output of " +
          '`bun run user:hash --hash-only <id> "<name>"`, or move the account into SALEM_USERS_JSON and unset it.',
      );
      if (adminCredential.length < MIN_PASSWORD_LENGTH) {
        warnOnce(`SALEM_ADMIN_PASSWORD is shorter than the ${MIN_PASSWORD_LENGTH} characters required of every other account.`);
      }
      if (privateSources) {
        warnOnce("SALEM_ADMIN_PRIVATE_SOURCES grants private research access to a plaintext credential. Migrate it to a password hash first.");
      }
    }
    users.push({ id, name: "Administrator", privateSources, credential });
  }
  if (new Set(users.map((user) => user.id)).size !== users.length) throw new Error("Duplicate Salem user IDs");
  return users;
}
export function accessConfigured(): boolean { return accounts().length > 0; }
/**
 * Account a sign-in resolves to when the request carries no username. The
 * sign-in form is password-only: the deployment is expected to have a single
 * account, so asking for a name it cannot vary is noise. The admin account
 * wins when configured; otherwise a lone `SALEM_USERS_JSON` entry. With
 * several named users and no admin there is no sensible default, and the
 * caller must name the account.
 */
export function defaultUsername(): string | null {
  const all = accounts();
  if (process.env.SALEM_ADMIN_PASSWORD) return process.env.SALEM_ADMIN_USERNAME || "admin";
  return all.length === 1 ? all[0].id : null;
}
function publicUser(account: Account): SalemUser {
  return { id: account.id, name: account.name, privateSources: account.privateSources };
}

/**
 * Identity of an account's current credential and privilege. A changed
 * password, a changed private-source grant, or a removed account invalidates
 * every session already issued against it.
 *
 * Derived from the PBKDF2 output, never from a plaintext password. The previous
 * form hashed the plaintext admin password with a single unsalted SHA-256 and
 * stored the result in Redis alongside each session, which made a Redis read
 * sufficient to recover that password offline.
 */
async function version(account: Account): Promise<string> {
  return digest(JSON.stringify([
    account.id,
    account.credential.kind,
    account.credential.salt,
    await expectedHash(account.credential),
    account.privateSources,
  ]));
}

export class AccessService {
  constructor(private store: KeyValueStore, private now = Date.now) {}
  async login(username: string, password: string): Promise<{ user: SalemUser; token: string } | null> {
    if (username.length > 64 || password.length > 1024 || !password) return null;
    const account = accounts().find((candidate) => candidate.id === username.trim().toLowerCase());
    // Derive even for unknown users, so a failed lookup costs about the same as
    // a wrong password and does not become an account-existence oracle.
    const [derived, expected] = await Promise.all([
      derive(password, account?.credential.salt ?? "0".repeat(32)),
      account ? expectedHash(account.credential) : Promise.resolve("0".repeat(64)),
    ]);
    if (!account || !sameSecret(derived, expected)) return null;
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
