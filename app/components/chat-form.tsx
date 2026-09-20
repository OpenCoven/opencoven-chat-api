"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BlockRenderer, useMarkdown } from "@create-markdown/react";
import type { SalemUser } from "@/lib/access";
import type { ChatSummary, SavedChat } from "@/lib/chat-history";

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MODEL = "gpt-5.2" as const;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AssistantMessageProps = {
  content: string;
  copyText: (text: string) => Promise<void>;
  isStreaming: boolean;
};


const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * Allowlists the schemes a rendered markdown link may use. Relative and
 * fragment hrefs resolve against the page origin and stay allowed; anything
 * that parses to another scheme (javascript:, data:, vbscript:, blob:) does not.
 */
function isSafeHref(href: string | null): boolean {
  if (!href) return false;
  const trimmed = href.trim();
  if (!trimmed) return false;
  try {
    return SAFE_LINK_SCHEMES.has(new URL(trimmed, window.location.origin).protocol);
  } catch {
    return false;
  }
}

function AssistantMessage({
  content,
  copyText,
  isStreaming,
}: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
  const { blocks, setMarkdown } = useMarkdown(content);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleCopyResponse = useCallback(async () => {
    if (!content || copied) return;
    await copyText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content, copied, copyText]);

  useEffect(() => {
    setMarkdown(content);
  }, [content, setMarkdown]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container || isStreaming) return;

    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    container.querySelectorAll<HTMLPreElement>("pre").forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy-btn";
      button.title = "Copy code";
      button.setAttribute("aria-label", "Copy code");
      button.innerHTML = copyIcon;

      button.addEventListener("click", async () => {
        const code = pre.querySelector("code");
        await copyText((code ?? pre).textContent ?? "");
        button.innerHTML = checkIcon;
        button.classList.add("copied");
        setTimeout(() => {
          button.innerHTML = copyIcon;
          button.classList.remove("copied");
        }, 2000);
      });

      pre.appendChild(button);
    });

    container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      // The markdown renderer passes link URLs through verbatim, so the scheme is
      // whatever the model emitted. Retrieved doc content reaches the model from
      // third-party sources, which makes a javascript:/data: href an injection
      // path rather than merely self-XSS. Neutralise anything that is not a
      // plain navigable link before the anchor becomes clickable.
      if (!isSafeHref(anchor.getAttribute("href"))) {
        anchor.removeAttribute("href");
        anchor.removeAttribute("target");
        anchor.dataset.blockedLink = "true";
        return;
      }
      if (anchor.target) return;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    });
  }, [blocks, copyText, isStreaming]);

  return (
    <article className={`salem-message assistant ${isStreaming ? "loading" : ""}`}>
      {content && !isStreaming && (
        <button
          type="button"
          className={`copy-btn ${copied ? "copied" : ""}`}
          onClick={handleCopyResponse}
          aria-label={copied ? "Copied" : "Copy response"}
          title={copied ? "Copied" : "Copy"}
        >
          {copied ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      )}
      <div ref={contentRef} className="markdown-body">
        <BlockRenderer blocks={blocks} />
      </div>
    </article>
  );
}

export default function ChatForm({ user }: { user: SalemUser }) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [recentChats, setRecentChats] = useState<ChatSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [formError, setFormError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);

  const lockInterface = useCallback(() => {
    setMessages([]);
    setMessage("");
    setRecentChats([]);
    setIsLoading(true);
    window.location.replace("/");
  }, []);

  const loadRecentChats = useCallback(async () => {
    const response = await fetch("/api/chats", { cache: "no-store" });
    if (response.status === 401) { lockInterface(); return; }
    if (!response.ok) throw new Error("Unable to load recent chats. Please refresh to retry.");
    const body = await response.json();
    setRecentChats(body.chats);
  }, [lockInterface]);

  useEffect(() => {
    loadRecentChats().catch((error) => setFormError(error.message)).finally(() => setHistoryLoading(false));
    const checkSession = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (response.status === 401) lockInterface();
      } catch { /* Requests still enforce authentication when the connection returns. */ }
    };
    const timer = setInterval(checkSession, 60_000);
    window.addEventListener("focus", checkSession);
    window.addEventListener("pageshow", checkSession);
    document.addEventListener("visibilitychange", checkSession);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("pageshow", checkSession);
      document.removeEventListener("visibilitychange", checkSession);
    };
  }, [loadRecentChats, lockInterface]);

  const openChat = async (id: string) => {
    if (isLoading || historyLoading) return;
    setHistoryLoading(true);
    setFormError("");
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (response.status === 401) { lockInterface(); return; }
      if (!response.ok) throw new Error("Unable to open this chat. It may have expired.");
      const { chat }: { chat: SavedChat } = await response.json();
      setChatId(chat.id);
      setMessages(chat.messages);
      setMessage("");
    } catch (error) { setFormError(error instanceof Error ? error.message : "Unable to open chat"); }
    finally { setHistoryLoading(false); }
  };

  const signOut = async () => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to sign out. Please try again.");
      lockInterface();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to sign out");
      setIsLoading(false);
    }
  };

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
  }, []);

  const updateStreamingAnswer = useCallback((content: string) => {
    setMessages((current) => {
      const next = [...current];
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = { ...last, content };
      }
      return next;
    });
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage || isLoading || historyLoading) return;

    const history = messages;
    const pendingMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmedMessage },
      { role: "assistant", content: "" },
    ];

    setMessage("");
    setFormError("");
    setIsLoading(true);
    setMessages(pendingMessages);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: trimmedMessage,
          chatId,
          model: DEFAULT_MODEL,
          retrieval: "auto",
        }),
      });

      if (response.status === 401) { lockInterface(); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessages(history);
        setMessage(trimmedMessage);
        setFormError(body.error || "Unable to ask Salem right now.");
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        text += decoder.decode(value, { stream: true });
        updateStreamingAnswer(text);
      }
      text += decoder.decode();
      updateStreamingAnswer(text);
      setChatId(response.headers.get("X-Chat-Id"));
      await loadRecentChats().catch(() => setFormError("Your reply was saved, but recent chats could not be refreshed. Reload to see them."));
    } catch {
      setFormError("The reply was interrupted or could not be saved. Reopen the chat to check saved messages before retrying.");
      setMessages(history);
      setMessage(trimmedMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [messages]);

  const hasConversation = messages.length > 0;
  const busy = isLoading || historyLoading;

  return (
    <>
      <div className="account-toolbar">
        <span>Signed in as <strong>{user.name}</strong> <span className="account-id">({user.id})</span></span>
        <button type="button" className="secondary-btn" disabled={isLoading} onClick={signOut}>Sign out</button>
      </div>
      <section className="recent-chats" aria-labelledby="recent-chats-title" aria-busy={historyLoading}>
        <div className="recent-chats-header">
          <h3 id="recent-chats-title">Recent chats</h3>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => { setChatId(null); setMessages([]); setMessage(""); setFormError(""); }}>New chat</button>
        </div>
        {historyLoading && <p className="history-note" role="status">Loading chats…</p>}
        {!historyLoading && recentChats.length === 0 && <p className="history-note">Your saved conversations will appear here.</p>}
        {recentChats.length > 0 && <ul className="recent-chat-list">
          {recentChats.map((chat) => <li key={chat.id}>
            <button type="button" className="recent-chat" aria-current={chatId === chat.id ? "true" : undefined} disabled={busy} onClick={() => openChat(chat.id)}>
              <span>{chat.title}</span><time dateTime={chat.updatedAt}>{new Date(chat.updatedAt).toLocaleDateString()}</time>
            </button>
          </li>)}
        </ul>}
        <p className="history-note">Keeps your latest 20 chats for 30 days, with up to 40 messages per chat.</p>
      </section>
      {hasConversation && (
        <div
          ref={conversationRef}
          className={`conversation-log ${isLoading ? "loading" : ""}`}
        >
          {messages.map((chatMessage, index) =>
            chatMessage.role === "assistant" ? (
              <AssistantMessage
                key={`${chatMessage.role}-${index}`}
                content={chatMessage.content}
                copyText={copyText}
                isStreaming={isLoading && index === messages.length - 1}
              />
            ) : (
              <article
                key={`${chatMessage.role}-${index}`}
                className="salem-message user"
              >
                {chatMessage.content}
              </article>
            ),
          )}
        </div>
      )}

      <form className="chat-form" onSubmit={handleSubmit}>
        <div className="question-row">
          <input
            type="text"
            className="chat-input"
            placeholder={
              hasConversation
                ? "Ask Salem a follow-up..."
                : "How do I get started with OpenCoven?"
            }
            maxLength={MAX_MESSAGE_LENGTH}
            autoComplete="off"
            required
            aria-label="Message to Salem"
            disabled={busy}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button type="submit" className="chat-btn" disabled={busy}>
            {isLoading ? (
              "Asking Salem..."
            ) : (
              <>
                {hasConversation ? "Follow up" : "Ask Salem"}
                <img src="/logo.svg" alt="" width={20} height={20} className="btn-logo" />
              </>
            )}
          </button>
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
      </form>
    </>
  );
}
