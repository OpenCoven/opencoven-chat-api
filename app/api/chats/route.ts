import { NextRequest } from "next/server";
import { ChatHistoryStore } from "@/lib/chat-history";
import { privateJson, requestUser } from "@/lib/session-http";
import { RedisStorage } from "@/lib/storage";

export async function GET(request: NextRequest) {
  try {
    const user = await requestUser(request);
    if (!user) return privateJson({ error: "Sign in required" }, 401);
    return privateJson({ chats: await new ChatHistoryStore(new RedisStorage()).list(user.id) });
  } catch { return privateJson({ error: "Unable to load recent chats" }, 503); }
}
