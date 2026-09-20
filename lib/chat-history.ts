import type { ChatHistoryMessage } from "@/app/api/chat/auth";
import type { KeyValueStore } from "./storage";

export const HISTORY_SECONDS = 30 * 24 * 60 * 60;
export type SavedChat = { id: string; title: string; updatedAt: string; messages: ChatHistoryMessage[] };
export type ChatSummary = Omit<SavedChat, "messages">;
const CHAT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export class ChatHistoryStore {
  constructor(private store: KeyValueStore) {}
  private key(userId: string, suffix: string) {
    return `salem:chats:${encodeURIComponent(userId)}:${suffix}`;
  }
  async list(userId: string): Promise<ChatSummary[]> {
    const summaries = await this.store.get<ChatSummary[]>(this.key(userId, "recent")) ?? [];
    return summaries.filter((chat) => Date.parse(chat.updatedAt) > Date.now() - HISTORY_SECONDS * 1000);
  }
  async get(userId: string, chatId: string): Promise<SavedChat | null> {
    if (!CHAT_ID.test(chatId)) return null;
    return this.store.get<SavedChat>(this.key(userId, chatId));
  }
  // Callers hold the per-user lock while reading and writing a conversation.
  // This also serializes updates to the recent-chat list across tabs/devices.
  async save(userId: string, previous: SavedChat | null, messages: ChatHistoryMessage[]): Promise<SavedChat> {
    const chat: SavedChat = {
      id: previous?.id ?? crypto.randomUUID(),
      title: previous?.title ?? messages.find((message) => message.role === "user")?.content.slice(0, 80) ?? "New chat",
      updatedAt: new Date().toISOString(),
      messages: messages.slice(-40),
    };
    await this.store.set(this.key(userId, chat.id), chat, HISTORY_SECONDS);
    const recent = (await this.list(userId)).filter((item) => item.id !== chat.id);
    const { messages: _messages, ...summary } = chat;
    await this.store.set(this.key(userId, "recent"), [summary, ...recent].slice(0, 20), HISTORY_SECONDS);
    for (const expired of recent.slice(19)) await this.store.del(this.key(userId, expired.id));
    return chat;
  }
  async lock(userId: string): Promise<string | null> {
    const token = crypto.randomUUID();
    return await this.store.set(this.key(userId, "lock"), token, 180, true) ? token : null;
  }
  async unlock(userId: string, token: string) { await this.store.release(this.key(userId, "lock"), token); }
}
