export type BriefAuthStatus =
  | "authorized"
  | "missing"
  | "malformed"
  | "unauthorized"
  | "revoked"
  | "not-configured";

const BEARER_PREFIX = "Bearer ";

function parseDigestSet(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[a-f0-9]{64}$/.test(entry)),
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) return null;
  const token = authorizationHeader.slice(BEARER_PREFIX.length);
  if (!token || token.length < 24 || token.length > 512 || /\s/.test(token)) {
    return null;
  }
  return token;
}

export async function getBriefCredentialFingerprint(
  authorizationHeader: string | null,
): Promise<string | null> {
  const token = bearerToken(authorizationHeader);
  return token ? sha256(token) : null;
}

export async function getBriefAuthStatus(
  authorizationHeader: string | null,
): Promise<BriefAuthStatus> {
  const allowed = parseDigestSet(process.env.SALEM_BRIEF_CLIENT_TOKEN_SHA256);
  const revoked = parseDigestSet(process.env.SALEM_BRIEF_CLIENT_REVOKED_SHA256);

  if (allowed.size === 0) return "not-configured";
  if (!authorizationHeader) return "missing";
  if (!authorizationHeader.startsWith(BEARER_PREFIX)) return "malformed";

  const digest = await getBriefCredentialFingerprint(authorizationHeader);
  if (!digest) return "malformed";
  if (revoked.has(digest)) return "revoked";
  return allowed.has(digest) ? "authorized" : "unauthorized";
}

export function briefAuthError(status: Exclude<BriefAuthStatus, "authorized">) {
  switch (status) {
    case "not-configured":
      return { httpStatus: 503, code: "BRIEF_AUTH_NOT_CONFIGURED", message: "Quick Answer access is not configured" } as const;
    case "missing":
      return { httpStatus: 401, code: "BRIEF_AUTH_REQUIRED", message: "Quick Answer credential required" } as const;
    case "malformed":
      return { httpStatus: 401, code: "BRIEF_AUTH_MALFORMED", message: "Malformed Quick Answer credential" } as const;
    case "revoked":
      return { httpStatus: 401, code: "BRIEF_AUTH_REVOKED", message: "Quick Answer credential revoked" } as const;
    case "unauthorized":
      return { httpStatus: 401, code: "BRIEF_AUTH_INVALID", message: "Invalid Quick Answer credential" } as const;
  }
}
