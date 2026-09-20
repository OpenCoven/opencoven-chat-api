import { NextRequest, NextResponse } from "next/server";
import { AccessService, SESSION_COOKIE, SESSION_SECONDS, type SalemUser } from "./access";
import { RedisStorage } from "./storage";

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin === new URL(request.url).origin);
}
export async function userFromToken(token: string | undefined): Promise<SalemUser | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return new AccessService(new RedisStorage()).authenticate(token);
}
export function requestUser(request: NextRequest) {
  return userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
}
export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: token ? SESSION_SECONDS : 0,
  });
}
