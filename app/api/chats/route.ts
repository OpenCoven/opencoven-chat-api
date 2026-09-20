import { NextRequest } from "next/server";
import { ChatHistoryStore } from "@/lib/chat-history";
import { privateJson, requestUser, sameOrigin } from "@/lib/session-http";
import { RedisStorage } from "@/lib/storage";

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: "Request origin is not allowed" }, 403);
  try {
    const user = await requestUser(request);
    if (!user) return privateJson({ error: "Sign in required" }, 401);
    return privateJson({ chats: await new ChatHistoryStore(new RedisStorage()).list(user.id) });
  } catch { return privateJson({ error: "Unable to load recent chats" }, 503); }
}
