"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BlockRenderer, useMarkdown } from "@create-markdown/react";

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

export default function ChatForm() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);

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
    const trimmedPassword = password.trim();
    const isFollowup = messages.length > 0;

    if (!trimmedMessage || isLoading) return;
    if (isFollowup && !trimmedPassword) {
      setFormError("Follow-up password required.");
      return;
    }

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

      if (isFollowup) {
        headers["X-Salem-Admin-Password"] = trimmedPassword;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: trimmedMessage,
          history: history,
          model: DEFAULT_MODEL,
          retrieval: "auto",
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMessages(history);
        setMessage(trimmedMessage);
        setFormError(body.error || "Unable to ask Salem right now.");
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        updateStreamingAnswer("Error: No response body");
        return;
      }

      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        text += decoder.decode(value, { stream: true });
        updateStreamingAnswer(text);
      }
    } catch (error) {
      updateStreamingAnswer(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [messages]);

  const hasConversation = messages.length > 0;
  const needsPassword = hasConversation;

  return (
    <>
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
        {needsPassword && (
          <label className="password-field">
            <span>Follow-up password</span>
            <input
              type="password"
              className="chat-input password-input"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
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
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button type="submit" className="chat-btn" disabled={isLoading}>
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
        {formError && <p className="form-error">{formError}</p>}
      </form>
    </>
  );
}
