/** Persist a completed answer before closing the response, and always release its lock. */
export function savedChatStream(
  upstream: ReadableStream<Uint8Array>,
  save: (answer: string) => Promise<void>,
  release: () => Promise<void>,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let answer = "";
      let completed = false;
      let failure: unknown;
      const consume = (line: string) => {
        if (!line.trim().startsWith("data:")) return;
        const data = line.trim().slice(5).trim();
        if (data === "[DONE]") { completed = true; return; }
        const event = JSON.parse(data);
        if (event.error) throw new Error("Upstream chat failed");
        const content = event.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) {
          answer += content;
          if (answer.length > 64_000) throw new Error("Answer exceeded storage limit");
          controller.enqueue(encoder.encode(content));
        }
      };
      try {
        while (!cancelled && !completed) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (cancelled || completed) break;
            consume(line);
          }
          if (done) { if (buffer.trim() && !cancelled && !completed) consume(buffer); break; }
        }
        if (!cancelled) {
          if (!completed || !answer) throw new Error("Chat response was interrupted");
          await save(answer);
        }
      } catch (error) { failure = error; }
      finally {
        try { await reader.cancel(); } catch { /* Upstream may already have closed. */ }
        try { await release(); } catch (error) { failure ??= error; }
      }
      if (!cancelled) {
        if (failure) controller.error(failure);
        else controller.close();
      }
    },
    async cancel() { cancelled = true; await reader.cancel(); },
  });
}
