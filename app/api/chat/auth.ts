export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 2000;

export function normalizeChatHistory(input: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(input)) return [];

  const messages: ChatHistoryMessage[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;

    const role = "role" in item ? item.role : null;
    const content = "content" in item ? item.content : null;

    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;

    const trimmed = content.trim();
    if (!trimmed) continue;

    messages.push({
      role,
      content: trimmed.slice(0, MAX_HISTORY_MESSAGE_LENGTH),
    });
  }

  return messages.slice(-MAX_HISTORY_MESSAGES);
}

export function isPrivateSourceUrl(url: string): boolean {
  return url.startsWith("private://");
}

export function filterPrivateSourceResults<T extends { url: string }>(
  results: T[],
  canAccessPrivate: boolean,
): T[] {
  if (canAccessPrivate) return results;
  return results.filter((result) => !isPrivateSourceUrl(result.url));
}

/**
 * Assembles the request messages.
 *
 * `contextMessage` carries retrieved documentation and is sent with the `user`
 * role, immediately before the question. That placement is the trust boundary:
 * the system message holds first-party instructions only, so a document can
 * never speak at instruction level. See lib/prompt-context.ts.
 */
export function buildChatMessages({
  systemPrompt,
  history,
  contextMessage,
  currentMessage,
}: {
  systemPrompt: string;
  history: ChatHistoryMessage[];
  contextMessage?: string | null;
  currentMessage: string;
}): ChatCompletionMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...history,
    ...(contextMessage ? [{ role: "user" as const, content: contextMessage }] : []),
    { role: "user", content: currentMessage },
  ];
}
