export const BRIEF_READ_SCOPE = "salem.brief.read" as const;

export type BriefAuthStatus =
  | "not-configured"
  | "missing"
  | "malformed"
  | "revoked"
  | "unauthorized"
  | "authorized";

export interface BriefAuthResult {
  status: BriefAuthStatus;
  scope: typeof BRIEF_READ_SCOPE | null;
  fingerprint: string | null;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 256;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function configuredVerifier(): string | null {
  const verifier = process.env.SALEM_BRIEF_READ_TOKEN_SHA256?.trim().toLowerCase();
  return verifier && SHA256_HEX.test(verifier) ? verifier : null;
}

function revokedVerifiers(): Set<string> {
  const configured = process.env.SALEM_BRIEF_REVOKED_TOKEN_SHA256S;
  if (!configured) return new Set();

  const values = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SHA256_HEX.test(value));
  return new Set(values);
}

function extractBearer(authorization: string | null):
  | { status: "missing" | "malformed"; token: null }
  | { status: "present"; token: string } {
  if (authorization === null) return { status: "missing", token: null };
  if (!authorization.startsWith("Bearer ")) {
    return { status: "malformed", token: null };
  }

  const token = authorization.slice("Bearer ".length);
  if (
    token !== token.trim() ||
    token.length < MIN_TOKEN_LENGTH ||
    token.length > MAX_TOKEN_LENGTH ||
    /\s/.test(token)
  ) {
    return { status: "malformed", token: null };
  }

  return { status: "present", token };
}

/**
 * Authenticate the dedicated Quick Answer read credential.
 *
 * The server stores only SHA-256 verifier material. The raw bearer is held by
 * the native client and must be stored in Keychain there. This credential is
 * endpoint-scoped by construction: callers receive no generic Salem/admin
 * principal and this function is used only by `/api/brief`.
 */
export async function authenticateBriefRead(
  authorization: string | null,
): Promise<BriefAuthResult> {
  const activeVerifier = configuredVerifier();
  if (!activeVerifier) {
    return { status: "not-configured", scope: null, fingerprint: null };
  }

  const bearer = extractBearer(authorization);
  if (bearer.status !== "present") {
    return { status: bearer.status, scope: null, fingerprint: null };
  }

  const digest = await sha256Hex(bearer.token);
  const fingerprint = digest.slice(0, 16);

  if (revokedVerifiers().has(digest)) {
    return { status: "revoked", scope: null, fingerprint };
  }

  if (digest !== activeVerifier) {
    return { status: "unauthorized", scope: null, fingerprint };
  }

  return {
    status: "authorized",
    scope: BRIEF_READ_SCOPE,
    fingerprint,
  };
}

export function briefAuthHttpStatus(status: BriefAuthStatus): number {
  switch (status) {
    case "not-configured":
      return 503;
    case "revoked":
      return 403;
    case "missing":
    case "malformed":
    case "unauthorized":
      return 401;
    case "authorized":
      return 200;
  }
}
