"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BlockRenderer, useMarkdown } from "@create-markdown/react";

const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_MODEL = "gpt-5.2" as const;

export default function ChatForm() {
  const [message, setMessage] = useState("");
  const [rawResponse, setRawResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const { blocks, setMarkdown } = useMarkdown("");
  const responseRef = useRef<HTMLDivElement>(null);

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

  const handleCopyResponse = useCallback(async () => {
    if (!rawResponse || copied) return;
    await copyText(rawResponse);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copied, copyText, rawResponse]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedMessage = message.trim();
    if (!trimmedMessage || isLoading) return;

    setIsLoading(true);
    setIsVisible(true);
    setMarkdown("");
    setRawResponse("");
    setCopied(false);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedMessage,
          model: DEFAULT_MODEL,
          retrieval: "auto",
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMarkdown(`Error: ${body.error || "Unable to ask Salem right now."}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setMarkdown("Error: No response body");
        return;
      }

      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        text += decoder.decode(value, { stream: true });
        setMarkdown(text);
        setRawResponse(text);
        if (responseRef.current) {
          responseRef.current.scrollTop = responseRef.current.scrollHeight;
        }
      }
    } catch (error) {
      setMarkdown(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const container = responseRef.current;
    if (!container || isLoading) return;

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
  }, [blocks, copyText, isLoading]);

  return (
    <>
      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          placeholder="How do I get started with OpenCoven?"
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
              Ask Salem
              <img src="/logo.svg" alt="" width={20} height={20} className="btn-logo" />
            </>
          )}
        </button>
      </form>

      {isVisible && (
        <div className={`response-wrapper ${isLoading ? "loading" : ""}`}>
          <div
            ref={responseRef}
            className={`response-area visible ${isLoading ? "loading" : ""}`}
          >
            {rawResponse && !isLoading && (
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
            <div className="markdown-body">
              <BlockRenderer blocks={blocks} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
