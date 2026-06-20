export type ChatHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type FollowupAuthStatus =
  | "not-required"
  | "not-configured"
  | "unauthorized"
  | "authorized";

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

export function getFollowupAuthStatus(
  history: ChatHistoryMessage[],
  submittedPassword: string | null,
): FollowupAuthStatus {
  if (history.length === 0) return "not-required";

  const configuredPassword = process.env.SALEM_ADMIN_PASSWORD;
  if (!configuredPassword) return "not-configured";

  return submittedPassword === configuredPassword ? "authorized" : "unauthorized";
}

export function canAccessPrivateSources(submittedPassword: string | null): boolean {
  const configuredPassword = process.env.SALEM_ADMIN_PASSWORD;
  return Boolean(configuredPassword && submittedPassword === configuredPassword);
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

export function buildChatMessages({
  systemPrompt,
  history,
  currentMessage,
}: {
  systemPrompt: string;
  history: ChatHistoryMessage[];
  currentMessage: string;
}): ChatCompletionMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: currentMessage },
  ];
}
