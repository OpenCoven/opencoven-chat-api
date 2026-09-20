import { NextRequest } from "next/server";
import { ChatHistoryStore } from "@/lib/chat-history";
import { privateJson, requestUser, sameOrigin } from "@/lib/session-http";
import { RedisStorage } from "@/lib/storage";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return privateJson({ error: "Request origin is not allowed" }, 403);
  try {
    const user = await requestUser(request);
    if (!user) return privateJson({ error: "Sign in required" }, 401);
    const { id } = await params;
    const chat = await new ChatHistoryStore(new RedisStorage()).get(user.id, id);
    return chat ? privateJson({ chat }) : privateJson({ error: "Chat not found" }, 404);
  } catch { return privateJson({ error: "Unable to load this chat" }, 503); }
}
