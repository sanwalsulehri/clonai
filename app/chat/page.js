"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** WhatsApp-style quick reactions first; more emojis follow in the same horizontal strip. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

const EMOJI_OPTIONS = [
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

const REACTION_STRIP_EMOJIS = [
  ...QUICK_REACTIONS,
  ...EMOJI_OPTIONS.filter((e) => !QUICK_REACTIONS.includes(e)),
];

/** Consecutive user bubbles at the end (same "typing burst" before the next assistant reply). */
function extractTrailingUserTurn(messages) {
  const turn = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user" || !String(m?.content ?? "").trim()) break;
    turn.unshift(m);
  }
  return turn;
}

/** Quiet period after last send before one API call (human-style burst). */
const REPLY_DEBOUNCE_MS = 950;

/** After clone reaction lands, short pause before "typing" the text (human order: react → then type). */
const CLONE_REACT_BEAT_MS = 600;

function applyCloneReactionToLastUser(prev, cloneReactionFromApi) {
  if (!cloneReactionFromApi) return prev;
  const lastIdx = prev.length - 1;
  if (lastIdx < 0 || prev[lastIdx]?.role !== "user") return prev;
  return prev.map((m, i) =>
    i === lastIdx ? { ...m, cloneReaction: cloneReactionFromApi } : m,
  );
}

export default function ChatPage() {
  const router = useRouter();
  const bottomRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const reactionStripRef = useRef(null);
  const inputRef = useRef(null);
  const chatAbortRef = useRef(null);
  const chatRequestSeqRef = useRef(0);
  const messagesRef = useRef([]);
  const replyDebounceRef = useRef(null);
  const reactionFollowUpDebounceRef = useRef(null);
  const pendingReactionFollowUpRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const sendGuardRef = useRef(false);
  const cloneProfileRef = useRef(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [cloneProfile, setCloneProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typingVisible, setTypingVisible] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  /** Which message index has the reaction picker open (null = closed). */
  const [reactionPickerForIndex, setReactionPickerForIndex] = useState(null);

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
    messagesRef.current = messages;
  }, [messages]);

  useLayoutEffect(() => {
    cloneProfileRef.current = cloneProfile;
  }, [cloneProfile]);

  useEffect(() => {
    return () => {
      if (replyDebounceRef.current) {
        clearTimeout(replyDebounceRef.current);
        replyDebounceRef.current = null;
      }
      if (reactionFollowUpDebounceRef.current) {
        clearTimeout(reactionFollowUpDebounceRef.current);
        reactionFollowUpDebounceRef.current = null;
      }
      chatAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getMoodConfig = () => {
    const profile = cloneProfileRef.current;
    const tone = `${profile?.tone || ""} ${profile?.personality || ""} ${profile?.style || ""} ${profile?.humor || ""}`.toLowerCase();

    if (tone.includes("calm") || tone.includes("soft") || tone.includes("mature")) {
      return { preDelayMs: 700, speedFactor: 1.2 };
    }
    if (tone.includes("fun") || tone.includes("playful") || tone.includes("energetic")) {
      return { preDelayMs: 300, speedFactor: 0.85 };
    }
    if (tone.includes("direct") || tone.includes("sharp") || tone.includes("bold")) {
      return { preDelayMs: 220, speedFactor: 0.75 };
    }

    return { preDelayMs: 450, speedFactor: 1 };
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
      const strip = reactionStripRef.current;
      if (
        strip &&
        !strip.contains(event.target) &&
        !event.target.closest?.("[data-reaction-trigger]")
      ) {
        setReactionPickerForIndex(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const buildHistoryEntries = (historyBase) =>
    historyBase
      .filter(
        (item) =>
          (item.role === "user" || item.role === "assistant") &&
          item.content?.trim(),
      )
      .slice(-10)
      .map((item) => {
        const entry = { role: item.role, content: item.content };
        if (typeof item.reaction === "string" && item.reaction.trim()) {
          entry.reaction = item.reaction.trim();
        }
        if (typeof item.cloneReaction === "string" && item.cloneReaction.trim()) {
          entry.cloneReaction = item.cloneReaction.trim();
        }
        return entry;
      });

  const scheduleReactionFollowUp = () => {
    if (reactionFollowUpDebounceRef.current) {
      clearTimeout(reactionFollowUpDebounceRef.current);
    }
    reactionFollowUpDebounceRef.current = setTimeout(() => {
      reactionFollowUpDebounceRef.current = null;
      void runReactionOnlyReply();
    }, REPLY_DEBOUNCE_MS);
  };

  const runReactionOnlyReply = async () => {
    const all = messagesRef.current;
    if (extractTrailingUserTurn(all).length > 0) return;

    const cloneId = localStorage.getItem("cloneId");
    if (!cloneId) {
      router.push("/");
      return;
    }

    if (requestInFlightRef.current) {
      pendingReactionFollowUpRef.current = true;
      return;
    }

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    chatRequestSeqRef.current += 1;
    const requestSeq = chatRequestSeqRef.current;

    const history = buildHistoryEntries(all);

    requestInFlightRef.current = true;
    setLoading(true);
    setTypingVisible(false);
    const moodConfig = getMoodConfig();

    try {
      const responsePromise = fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reactionOnly: true,
          message: "",
          turnMessages: [],
          cloneId,
          clone: cloneProfileRef.current,
          history,
        }),
        signal: controller.signal,
      });

      await wait(moodConfig.preDelayMs);
      if (requestSeq !== chatRequestSeqRef.current) return;

      const response = await responsePromise;

      if (requestSeq !== chatRequestSeqRef.current) return;

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to get AI response.");
      }

      const replyText =
        typeof data?.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : "ok";

      setTypingVisible(false);

      setTypingVisible(true);
      const typingMs = Math.floor(getHumanTypingDelay(replyText) * moodConfig.speedFactor);
      await wait(typingMs);

      if (requestSeq !== chatRequestSeqRef.current) return;

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
      if (sendError?.name === "AbortError") {
        return;
      }
      setTypingVisible(false);
      const nextError = sendError.message || "Something went wrong.";
      setError(nextError);

      if (nextError.toLowerCase().includes("clone not found")) {
        localStorage.removeItem("cloneId");
        localStorage.removeItem("cloneProfile");
        router.push("/");
      }
    } finally {
      requestInFlightRef.current = false;
      if (requestSeq === chatRequestSeqRef.current) {
        setTypingVisible(false);
        setLoading(false);
        if (pendingReactionFollowUpRef.current) {
          pendingReactionFollowUpRef.current = false;
          queueMicrotask(() => void runReactionOnlyReply());
        }
      }
    }
  };

  const runAiReply = async () => {
    if (reactionFollowUpDebounceRef.current) {
      clearTimeout(reactionFollowUpDebounceRef.current);
      reactionFollowUpDebounceRef.current = null;
    }

    const all = messagesRef.current;
    const turn = extractTrailingUserTurn(all);
    if (turn.length === 0) return;

    const cloneId = localStorage.getItem("cloneId");
    if (!cloneId) {
      router.push("/");
      return;
    }

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    chatRequestSeqRef.current += 1;
    const requestSeq = chatRequestSeqRef.current;

    const historyBase = all.slice(0, all.length - turn.length);
    const history = buildHistoryEntries(historyBase);
    const turnMessages = turn.map((t) => t.content.trim());

    requestInFlightRef.current = true;
    setLoading(true);
    setTypingVisible(false);
    const moodConfig = getMoodConfig();

    try {
      const responsePromise = fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: turnMessages[turnMessages.length - 1],
          turnMessages,
          cloneId,
          clone: cloneProfileRef.current,
          history,
        }),
        signal: controller.signal,
      });

      await wait(moodConfig.preDelayMs);
      if (requestSeq !== chatRequestSeqRef.current) return;

      const response = await responsePromise;

      if (requestSeq !== chatRequestSeqRef.current) return;

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to get AI response.");
      }

      const replyText =
        typeof data?.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : "ok";

      const cloneReactionFromApi =
        typeof data?.cloneReaction === "string" && data.cloneReaction.trim()
          ? data.cloneReaction.trim()
          : null;

      setTypingVisible(false);

      if (cloneReactionFromApi) {
        setMessages((prev) => applyCloneReactionToLastUser(prev, cloneReactionFromApi));
        await wait(CLONE_REACT_BEAT_MS);
        if (requestSeq !== chatRequestSeqRef.current) return;
      }

      setTypingVisible(true);
      const typingMs = Math.floor(getHumanTypingDelay(replyText) * moodConfig.speedFactor);
      await wait(typingMs);

      if (requestSeq !== chatRequestSeqRef.current) return;

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
      if (sendError?.name === "AbortError") {
        return;
      }
      setTypingVisible(false);
      const nextError = sendError.message || "Something went wrong.";
      setError(nextError);

      if (nextError.toLowerCase().includes("clone not found")) {
        localStorage.removeItem("cloneId");
        localStorage.removeItem("cloneProfile");
        router.push("/");
      }
    } finally {
      requestInFlightRef.current = false;
      if (requestSeq === chatRequestSeqRef.current) {
        setTypingVisible(false);
        setLoading(false);
        if (pendingReactionFollowUpRef.current) {
          pendingReactionFollowUpRef.current = false;
          queueMicrotask(() => void runReactionOnlyReply());
        }
      }
    }
  };

  const sendMessage = () => {
    if (sendGuardRef.current) return;
    const trimmed = message.trim();
    if (!trimmed || trimmed.length > 400) return;

    const cloneId = localStorage.getItem("cloneId");
    if (!cloneId) {
      router.push("/");
      return;
    }

    sendGuardRef.current = true;
    queueMicrotask(() => {
      sendGuardRef.current = false;
    });

    if (requestInFlightRef.current) {
      chatAbortRef.current?.abort();
      chatRequestSeqRef.current += 1;
      setLoading(false);
      setTypingVisible(false);
    }

    pendingReactionFollowUpRef.current = false;
    if (reactionFollowUpDebounceRef.current) {
      clearTimeout(reactionFollowUpDebounceRef.current);
      reactionFollowUpDebounceRef.current = null;
    }

    const nextUserMessage = {
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, nextUserMessage]);
    setMessage("");
    setError("");

    if (replyDebounceRef.current) {
      clearTimeout(replyDebounceRef.current);
    }
    replyDebounceRef.current = setTimeout(() => {
      replyDebounceRef.current = null;
      void runAiReply();
    }, REPLY_DEBOUNCE_MS);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      if (event.repeat || event.nativeEvent.isComposing) return;
      event.preventDefault();
      sendMessage();
    }
  };

  const addEmoji = (emoji) => {
    setMessage((prev) => `${prev}${emoji}`.slice(0, 400));
    inputRef.current?.focus();
  };

  const clearChat = () => {
    if (replyDebounceRef.current) {
      clearTimeout(replyDebounceRef.current);
      replyDebounceRef.current = null;
    }
    if (reactionFollowUpDebounceRef.current) {
      clearTimeout(reactionFollowUpDebounceRef.current);
      reactionFollowUpDebounceRef.current = null;
    }
    pendingReactionFollowUpRef.current = false;
    chatAbortRef.current?.abort();
    chatRequestSeqRef.current += 1;
    requestInFlightRef.current = false;
    setLoading(false);
    setTypingVisible(false);
    setMessages([]);
    setReactionPickerForIndex(null);
    setError("");
    inputRef.current?.focus();
  };

  const formatTime = (isoTime) => {
    if (!isoTime) return "";
    const parsed = new Date(isoTime);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const setMessageReaction = (index, emoji) => {
    setMessages((prev) => {
      const next = prev.map((msg, i) => {
        if (i !== index) return msg;
        const toggledOff =
          typeof msg.reaction === "string" && msg.reaction === emoji;
        const updated = { ...msg };
        if (toggledOff) {
          delete updated.reaction;
        } else {
          updated.reaction = emoji;
        }
        return updated;
      });
      const msg = next[index];
      if (
        msg.role === "assistant" &&
        typeof msg.reaction === "string" &&
        msg.reaction.trim()
      ) {
        queueMicrotask(() => scheduleReactionFollowUp());
      }
      return next;
    });
    setReactionPickerForIndex(null);
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

        <div className="flex-1 overflow-y-auto bg-stone-900/50 px-5 py-5">
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

          {messages.map((item, index) => {
            const packWithPrevUser =
              index > 0 &&
              item.role === "user" &&
              messages[index - 1]?.role === "user";
            const stackGap = packWithPrevUser ? "mt-1" : index === 0 ? "" : "mt-3";

            return (
              <div
                key={`${item.role}-${index}-${item.createdAt ?? index}`}
                className={`message-enter flex w-full ${stackGap} ${item.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`relative flex max-w-[82%] min-w-0 flex-col ${item.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`w-fit max-w-full rounded-2xl px-4 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-sm ${
                      packWithPrevUser ? "rounded-tr-sm" : ""
                    } ${
                      item.role === "user"
                        ? `rounded-br-sm bg-amber-800 text-stone-50 ${packWithPrevUser ? "" : "rounded-tr-2xl"}`
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
                  <div
                    className={`mt-1.5 flex max-w-full flex-wrap items-center gap-1.5 ${item.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {item.role === "user" && item.cloneReaction ? (
                      <span
                        className="flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-100/95"
                        title={`${cloneProfile?.name || "Clone"} reacted to your message`}
                      >
                        <span className="opacity-80">{cloneProfile?.name || "Clone"}</span>
                        <span className="text-base leading-none">{item.cloneReaction}</span>
                      </span>
                    ) : null}
                    {item.reaction ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-base leading-none ${
                          item.role === "user"
                            ? "bg-amber-900/60 text-stone-100"
                            : "bg-stone-700/90 text-stone-100"
                        }`}
                        title="Your reaction"
                      >
                        {item.reaction}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      data-reaction-trigger
                      onClick={() => {
                        setShowEmojiPicker(false);
                        setReactionPickerForIndex((open) => (open === index ? null : index));
                      }}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                        item.role === "user"
                          ? "border-amber-700/60 bg-amber-900/40 text-amber-100/90 hover:border-amber-500/70 hover:bg-amber-900/55"
                          : "border-stone-600 bg-stone-900/60 text-stone-400 hover:border-stone-500 hover:text-stone-200"
                      }`}
                    >
                      React
                    </button>
                  </div>
                  {reactionPickerForIndex === index ? (
                    <div
                      ref={reactionStripRef}
                      className={`absolute top-full z-20 mt-1 max-w-[min(100vw-2rem,20rem)] rounded-2xl border border-stone-600 bg-stone-900 p-2 shadow-2xl shadow-stone-950/50 ${
                        item.role === "user" ? "right-0" : "left-0"
                      }`}
                    >
                      <p className="mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-stone-500">
                        Pick a reaction
                      </p>
                      <div
                        role="group"
                        aria-label="Reaction emoji strip"
                        className="flex max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto rounded-xl border border-stone-700/80 bg-stone-950/50 px-1 py-1 [scrollbar-width:thin]"
                      >
                        {REACTION_STRIP_EMOJIS.map((emoji) => {
                          const active = item.reaction === emoji;
                          const isQuick = QUICK_REACTIONS.includes(emoji);
                          return (
                            <button
                              key={`${index}-${emoji}`}
                              type="button"
                              onClick={() => setMessageReaction(index, emoji)}
                              title={active ? "Tap to remove" : "React"}
                              className={`flex shrink-0 items-center justify-center rounded-full transition ${
                                isQuick ? "h-8 px-1.5 text-lg" : "h-7 px-1 text-base"
                              } ${
                                active
                                  ? item.role === "user"
                                    ? "bg-amber-700/90 shadow-inner ring-2 ring-amber-400/60"
                                    : "bg-stone-600 ring-2 ring-stone-400/50"
                                  : "opacity-80 hover:bg-stone-800 hover:opacity-100"
                              }`}
                            >
                              {emoji}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}

          {loading && typingVisible ? (
            <div className="message-enter mt-3 flex w-full justify-start">
              <div className="w-fit max-w-[82%] min-w-0 rounded-2xl rounded-bl-sm border border-stone-600 bg-stone-800 px-4 py-2.5 text-sm text-stone-400">
                typing...
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
                  {EMOJI_OPTIONS.map((emoji) => (
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
              disabled={!message.trim() || message.trim().length > 400}
              className="rounded-xl bg-amber-800 px-4 py-2.5 font-medium text-stone-50 transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Send
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] text-stone-500">
            <span>
              React on the clone&apos;s bubbles to answer without typing · bursts wait a moment, then one reply
            </span>
            <span>{message.length}/400</span>
          </div>
        </div>
      </div>
    </main>
  );
}
