"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function ChatPage() {
  const router = useRouter();
  const bottomRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const inputRef = useRef(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [cloneProfile, setCloneProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typingVisible, setTypingVisible] = useState(false);
  const [typingText, setTypingText] = useState("typing...");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiOptions = [
    "😀",
    "😂",
    "😍",
    "😎",
    "🥹",
    "🤔",
    "🔥",
    "❤️",
    "💯",
    "🙌",
    "👏",
    "🤝",
    "👍",
    "👀",
    "😅",
    "🙏",
    "🎉",
    "✨",
    "🥲",
    "💀",
  ];

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getMoodConfig = () => {
    const tone = `${cloneProfile?.tone || ""} ${cloneProfile?.personality || ""} ${cloneProfile?.style || ""}`.toLowerCase();

    if (tone.includes("calm") || tone.includes("soft") || tone.includes("mature")) {
      return { preDelayMs: 700, speedFactor: 1.2, typingLabel: "typing..." };
    }
    if (tone.includes("fun") || tone.includes("playful") || tone.includes("energetic")) {
      return { preDelayMs: 300, speedFactor: 0.85, typingLabel: "typing fast..." };
    }
    if (tone.includes("direct") || tone.includes("sharp") || tone.includes("bold")) {
      return { preDelayMs: 220, speedFactor: 0.75, typingLabel: "typing..." };
    }

    return { preDelayMs: 450, speedFactor: 1, typingLabel: "typing..." };
  };

  const getHumanTypingDelay = (text) => {
    const base = 900;
    const variableByLength = Math.min(1600, Math.floor((text?.length || 0) * 18));
    const jitter = Math.floor(Math.random() * 500);
    return base + variableByLength + jitter;
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!emojiPickerRef.current?.contains(event.target)) {
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || loading || trimmed.length > 400) return;

    const cloneId = localStorage.getItem("cloneId");
    if (!cloneId) {
      router.push("/");
      return;
    }

    const nextUserMessage = {
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, nextUserMessage]);
    setMessage("");
    setError("");
    setLoading(true);
    setTypingVisible(false);
    const requestStartedAt = Date.now();
    const moodConfig = getMoodConfig();

    try {
      const history = messages
        .filter(
          (item) =>
            (item.role === "user" || item.role === "assistant") &&
            item.content?.trim(),
        )
        .slice(-10)
        .map((item) => ({ role: item.role, content: item.content }));

      const responsePromise = fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          cloneId,
          clone: cloneProfile,
          history,
        }),
      });

      await wait(moodConfig.preDelayMs);
      setTypingText(moodConfig.typingLabel);
      setTypingVisible(true);

      const response = await responsePromise;

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to get AI response.");
      }

      const replyText =
        typeof data?.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : "ok";

      const desiredTypingMs = Math.floor(getHumanTypingDelay(replyText) * moodConfig.speedFactor);
      const elapsedMs = Date.now() - requestStartedAt;
      const remainingTypingMs = Math.max(0, desiredTypingMs - elapsedMs);
      if (remainingTypingMs > 0) {
        await wait(remainingTypingMs);
      }

      setTypingVisible(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: replyText,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (sendError) {
      setTypingVisible(false);
      const nextError = sendError.message || "Something went wrong.";
      setError(nextError);

      if (nextError.toLowerCase().includes("clone not found")) {
        localStorage.removeItem("cloneId");
        localStorage.removeItem("cloneProfile");
        router.push("/");
      }
    } finally {
      setTypingVisible(false);
      setLoading(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const addEmoji = (emoji) => {
    setMessage((prev) => `${prev}${emoji}`.slice(0, 400));
    inputRef.current?.focus();
  };

  const clearChat = () => {
    setMessages([]);
    setError("");
    inputRef.current?.focus();
  };

  const formatTime = (isoTime) => {
    if (!isoTime) return "";
    const parsed = new Date(isoTime);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <main className="min-h-screen bg-stone-900 px-4 py-8 text-stone-100">
      <div className="mx-auto flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-stone-700/80 bg-stone-800/95 shadow-2xl shadow-stone-950/50">
        <div className="border-b border-stone-700/80 bg-stone-800/70 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/90">
            Live
          </p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <h1 className="text-lg font-semibold text-stone-50">Clone Chat</h1>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 rounded-full border border-emerald-600/40 bg-emerald-900/20 px-2.5 py-1 text-xs text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Online
              </div>
              <button
                type="button"
                onClick={clearChat}
                className="rounded-full border border-stone-600 bg-stone-900/70 px-3 py-1 text-xs text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
              >
                Clear chat
              </button>
            </div>
          </div>
          {cloneProfile?.name ? (
            <p className="mt-1 text-xs text-stone-400">Talking as {cloneProfile.name}</p>
          ) : null}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto bg-stone-900/50 px-5 py-5">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-md rounded-2xl border border-stone-700/80 bg-stone-800/70 px-4 py-5 text-center">
              <p className="text-sm text-stone-200">
                Start naturally, like texting a friend.
              </p>
              <p className="mt-1 text-xs text-stone-400">
                Try: `hi`, `how are you`, or ask anything directly.
              </p>
            </div>
          ) : null}

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
                {item.createdAt ? (
                  <p
                    className={`mt-1 text-[10px] ${
                      item.role === "user" ? "text-amber-100/70" : "text-stone-400"
                    }`}
                  >
                    {formatTime(item.createdAt)}
                  </p>
                ) : null}
              </div>
            </div>
          ))}

          {loading && typingVisible ? (
            <div className="message-enter flex w-full justify-start">
              <div className="w-fit max-w-[82%] min-w-0 rounded-2xl rounded-bl-sm border border-stone-600 bg-stone-800 px-4 py-2.5 text-sm text-stone-400">
                {typingText}
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-stone-700/80 bg-stone-800/90 p-4">
          {error ? <p className="mb-2 text-sm text-rose-400">{error}</p> : null}

          <div className="relative flex items-center gap-2" ref={emojiPickerRef}>
            <button
              type="button"
              onClick={() => setShowEmojiPicker((prev) => !prev)}
              className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-lg leading-none transition hover:border-amber-600/60 hover:bg-stone-900"
              aria-label="Open emoji picker"
            >
              😊
            </button>

            {showEmojiPicker ? (
              <div className="absolute bottom-14 left-0 z-20 w-72 rounded-2xl border border-stone-600 bg-stone-900 p-3 shadow-2xl shadow-stone-950/50">
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-stone-400">
                  Emojis
                </p>
                <div className="grid grid-cols-8 gap-1.5">
                  {emojiOptions.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => addEmoji(emoji)}
                      className="rounded-lg px-1 py-1.5 text-lg transition hover:bg-stone-800"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 400))}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={loading || !message.trim() || message.trim().length > 400}
              className="rounded-xl bg-amber-800 px-4 py-2.5 font-medium text-stone-50 transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "Sending..." : "Send"}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-stone-500">
            <span>Press Enter to send</span>
            <span>{message.length}/400</span>
          </div>
        </div>
      </div>
    </main>
  );
}
