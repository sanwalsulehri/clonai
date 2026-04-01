"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ChatPage() {
  const router = useRouter();
  const bottomRef = useRef(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [cloneProfile, setCloneProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const cloneId = localStorage.getItem("cloneId");
    const rawCloneProfile = localStorage.getItem("cloneProfile");

    if (!cloneId) {
      router.push("/");
      return;
    }

    if (rawCloneProfile) {
      try {
        const parsedProfile = JSON.parse(rawCloneProfile);
        setCloneProfile(parsedProfile);
        setMessages([]);
      } catch {
        setCloneProfile(null);
      }
    }
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || loading) return;

    const cloneId = localStorage.getItem("cloneId");
    if (!cloneId) {
      router.push("/");
      return;
    }

    const nextUserMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, nextUserMessage]);
    setMessage("");
    setError("");
    setLoading(true);

    try {
      const history = messages
        .filter(
          (item) =>
            (item.role === "user" || item.role === "assistant") &&
            item.content?.trim(),
        )
        .slice(-10)
        .map((item) => ({ role: item.role, content: item.content }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          cloneId,
          clone: cloneProfile,
          history,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to get AI response.");
      }

      const replyText =
        typeof data?.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : "ok";
      setMessages((prev) => [...prev, { role: "assistant", content: replyText }]);
    } catch (sendError) {
      const nextError = sendError.message || "Something went wrong.";
      setError(nextError);

      if (nextError.toLowerCase().includes("clone not found")) {
        localStorage.removeItem("cloneId");
        localStorage.removeItem("cloneProfile");
        router.push("/");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  return (
    <main className="min-h-screen bg-stone-900 px-4 py-8 text-stone-100">
      <div className="mx-auto flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-stone-700/80 bg-stone-800/95 shadow-2xl shadow-stone-950/50">
        <div className="border-b border-stone-700/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/90">
            Live
          </p>
          <h1 className="text-lg font-semibold text-stone-50">Clone Chat</h1>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-stone-900/50 px-4 py-4">
          {messages.map((item, index) => (
            <div
              key={`${item.role}-${index}`}
              className={`message-enter flex w-full ${item.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[82%] min-w-0 w-fit rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-sm ${
                  item.role === "user"
                    ? "rounded-br-sm bg-amber-800 text-stone-50"
                    : "rounded-bl-sm border border-stone-600 bg-stone-800 text-stone-100"
                }`}
              >
                {item.content}
              </div>
            </div>
          ))}

          {loading ? (
            <div className="message-enter flex w-full justify-start">
              <div className="w-fit max-w-[82%] min-w-0 rounded-2xl rounded-bl-sm border border-stone-600 bg-stone-800 px-4 py-2.5 text-sm text-stone-400">
                Thinking...
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-stone-700/80 bg-stone-800/90 p-4">
          {error ? <p className="mb-2 text-sm text-rose-400">{error}</p> : null}

          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={loading || !message.trim()}
              className="rounded-xl bg-amber-800 px-4 py-2.5 font-medium text-stone-50 transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
