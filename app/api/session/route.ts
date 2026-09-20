import { NextRequest } from "next/server";
import { AccessService, accessConfigured, digest, SESSION_COOKIE } from "@/lib/access";
import { RedisStorage } from "@/lib/storage";
import { privateJson, requestUser, sameOrigin, setSessionCookie } from "@/lib/session-http";
import { getClientIp } from "@/rag/ratelimit";

export async function GET(request: NextRequest) {
  try {
    const user = await requestUser(request);
    return user ? privateJson({ user }) : privateJson({ error: "Sign in required" }, 401);
  } catch { return privateJson({ error: "Sign-in is temporarily unavailable" }, 503); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request origin is not allowed" }, 403);
  try {
    if (!accessConfigured()) return privateJson({ error: "Access has not been configured. Contact the administrator." }, 503);
    const store = new RedisStorage();
    const ip = getClientIp(Object.fromEntries(request.headers));
    const attempts = await store.increment(`salem:login:${await digest(ip)}`, 15 * 60);
    if (attempts > 10) return privateJson({ error: "Too many sign-in attempts. Try again in 15 minutes." }, 429);
    const raw = await request.text();
    if (raw.length > 4096) return privateJson({ error: "Invalid sign-in request" }, 400);
    let body;
    try { body = JSON.parse(raw); } catch { return privateJson({ error: "Invalid sign-in request" }, 400); }
    if (typeof body?.username !== "string" || typeof body?.password !== "string") return privateJson({ error: "Username and password are required" }, 400);
    const access = new AccessService(store);
    const session = await access.login(body.username, body.password);
    if (!session) return privateJson({ error: "Username or password is incorrect" }, 401);
    // Revoke the previous browser session when switching accounts.
    await access.logout(request.cookies.get(SESSION_COOKIE)?.value);
    const response = privateJson({ user: session.user });
    setSessionCookie(response, session.token);
    return response;
  } catch { return privateJson({ error: "Sign-in is temporarily unavailable" }, 503); }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request origin is not allowed" }, 403);
  try {
    await new AccessService(new RedisStorage()).logout(request.cookies.get(SESSION_COOKIE)?.value);
    const response = privateJson({ ok: true });
    setSessionCookie(response, "");
    return response;
  } catch { return privateJson({ error: "Unable to sign out. Please try again." }, 503); }
}
