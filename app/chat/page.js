"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postCloneChat } from "@/lib/api";
import { CHAT_HISTORY_LIMIT, POST_FETCH_REVEAL_MS } from "@/lib/chatConstants";

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

function newMessageId() {
  return crypto.randomUUID();
}

/** Match server/history: prefix so the model sees threaded reply context for this burst line. */
function formatTurnLineForApi(msg) {
  const line = String(msg?.content ?? "").trim();
  const rt = msg?.replyTo;
  if (rt && typeof rt.quote === "string" && rt.quote.trim()) {
    const role = rt.role === "assistant" ? "assistant" : "user";
    const q = rt.quote.trim().slice(0, 420);
    return `[User is replying to this earlier ${role} message: "${q}"]\n${line}`;
  }
  return line;
}

function truncateReplyPreview(text, max = 100) {
  const t = String(text ?? "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
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
  /** True while waiting on the model or simulated typing — shows Typing… */
  const [typingIndicator, setTypingIndicator] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  /** Which message index has the reaction picker open (null = closed). */
  const [reactionPickerForIndex, setReactionPickerForIndex] = useState(null);
  /** Reply-to target for the next sent message (WhatsApp-style thread). */
  const [replyTarget, setReplyTarget] = useState(null);

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
  }, [messages, loading, typingIndicator]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const getMoodConfig = () => {
    const profile = cloneProfileRef.current;
    const tone = `${profile?.tone || ""} ${profile?.personality || ""} ${profile?.style || ""} ${profile?.humor || ""}`.toLowerCase();

    if (tone.includes("calm") || tone.includes("soft") || tone.includes("mature")) {
      return { speedFactor: 1.2 };
    }
    if (tone.includes("fun") || tone.includes("playful") || tone.includes("energetic")) {
      return { speedFactor: 0.85 };
    }
    if (tone.includes("direct") || tone.includes("sharp") || tone.includes("bold")) {
      return { speedFactor: 0.75 };
    }

    return { speedFactor: 1 };
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
      .slice(-CHAT_HISTORY_LIMIT)
      .map((item) => {
        const entry = { role: item.role, content: item.content };
        if (typeof item.reaction === "string" && item.reaction.trim()) {
          entry.reaction = item.reaction.trim();
        }
        const rq = item.replyTo?.quote;
        if (typeof rq === "string" && rq.trim() && item.role === "user") {
          entry.replyTo = {
            role: item.replyTo.role === "assistant" ? "assistant" : "user",
            quote: rq.trim().slice(0, 500),
          };
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
    setTypingIndicator(true);
    const moodConfig = getMoodConfig();

    try {
      const { response, data } = await postCloneChat(
        {
          reactionOnly: true,
          message: "",
          turnMessages: [],
          cloneId,
          clone: cloneProfileRef.current,
          history,
        },
        { signal: controller.signal },
      );

      if (requestSeq !== chatRequestSeqRef.current) return;

      if (!response.ok) {
        throw new Error(data?.error || "Failed to get AI response.");
      }

      const replyText =
        typeof data?.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : "ok";

      await wait(POST_FETCH_REVEAL_MS);
      if (requestSeq !== chatRequestSeqRef.current) return;

      const typingMs = Math.floor(
        getHumanTypingDelay(replyText) * moodConfig.speedFactor,
      );
      await wait(typingMs);

      if (requestSeq !== chatRequestSeqRef.current) return;

      setTypingIndicator(false);
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: "assistant",
          content: replyText,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (sendError) {
      if (sendError?.name === "AbortError") {
        return;
      }
      setTypingIndicator(false);
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
        setTypingIndicator(false);
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
    const turnMessages = turn.map((t) => formatTurnLineForApi(t));

    requestInFlightRef.current = true;
    setLoading(true);
    setTypingIndicator(true);
    const moodConfig = getMoodConfig();

    try {
      const { response, data } = await postCloneChat(
        {
          message: turnMessages[turnMessages.length - 1],
          turnMessages,
          cloneId,
          clone: cloneProfileRef.current,
          history,
        },
        { signal: controller.signal },
      );

      if (requestSeq !== chatRequestSeqRef.current) return;

      if (!response.ok) {
        throw new Error(data?.error || "Failed to get AI response.");
      }

      const replyText =
        typeof data?.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : "ok";

      await wait(POST_FETCH_REVEAL_MS);
      if (requestSeq !== chatRequestSeqRef.current) return;

      const typingMs = Math.floor(
        getHumanTypingDelay(replyText) * moodConfig.speedFactor,
      );
      await wait(typingMs);

      if (requestSeq !== chatRequestSeqRef.current) return;

      setTypingIndicator(false);
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId(),
          role: "assistant",
          content: replyText,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch (sendError) {
      if (sendError?.name === "AbortError") {
        return;
      }
      setTypingIndicator(false);
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
        setTypingIndicator(false);
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
      setTypingIndicator(false);
    }

    pendingReactionFollowUpRef.current = false;
    if (reactionFollowUpDebounceRef.current) {
      clearTimeout(reactionFollowUpDebounceRef.current);
      reactionFollowUpDebounceRef.current = null;
    }

    const pendingReply = replyTarget;
    setReplyTarget(null);

    const nextUserMessage = {
      id: newMessageId(),
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    if (pendingReply?.quote?.trim()) {
      nextUserMessage.replyTo = {
        role: pendingReply.role === "assistant" ? "assistant" : "user",
        quote: pendingReply.quote.trim().slice(0, 500),
      };
    }
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
    setTypingIndicator(false);
    setMessages([]);
    setReactionPickerForIndex(null);
    setReplyTarget(null);
    setError("");
    inputRef.current?.focus();
  };

  const formatTime = (isoTime) => {
    if (!isoTime) return "";
    const parsed = new Date(isoTime);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const startReplyTo = (item) => {
    const q = String(item.content ?? "").trim();
    if (!q) return;
    setReactionPickerForIndex(null);
    setShowEmojiPicker(false);
    setReplyTarget({
      role: item.role === "assistant" ? "assistant" : "user",
      quote: q.slice(0, 500),
    });
    inputRef.current?.focus();
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
            const stackGap = packWithPrevUser ? "mt-1.5" : index === 0 ? "" : "mt-4";

            return (
              <div
                key={item.id ?? `${item.role}-${index}-${item.createdAt ?? index}`}
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
                        ? `rounded-br-sm bg-blue-600 text-white ${packWithPrevUser ? "" : "rounded-tr-2xl"}`
                        : "rounded-bl-sm border border-stone-600/90 bg-stone-700/95 text-stone-100"
                    }`}
                  >
                    {item.role === "user" && item.replyTo?.quote ? (
                      <div className="mb-2 max-w-[min(100%,18rem)] border-l-2 border-blue-200/80 pl-2 text-[11px] leading-snug text-blue-50/95">
                        <span className="text-blue-100/80">
                          {item.replyTo.role === "assistant"
                            ? cloneProfile?.name || "Clone"
                            : "You"}
                        </span>
                        <p className="mt-0.5 whitespace-pre-wrap">
                          {truncateReplyPreview(item.replyTo.quote, 160)}
                        </p>
                      </div>
                    ) : null}
                    {item.content}
                    {item.createdAt ? (
                      <p
                        className={`mt-1 text-[10px] ${
                          item.role === "user" ? "text-blue-100/75" : "text-stone-400"
                        }`}
                      >
                        {formatTime(item.createdAt)}
                      </p>
                    ) : null}
                  </div>
                  <div
                    className={`mt-1.5 flex max-w-full flex-wrap items-center gap-1.5 ${item.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {item.reaction ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-base leading-none ${
                          item.role === "user"
                            ? "bg-blue-800/70 text-white"
                            : "bg-stone-600/90 text-stone-100"
                        }`}
                        title="Your reaction"
                      >
                        {item.reaction}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startReplyTo(item)}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                        item.role === "user"
                          ? "border-blue-500/50 bg-blue-950/35 text-blue-100/90 hover:border-blue-400/60 hover:bg-blue-950/50"
                          : "border-stone-600 bg-stone-900/60 text-stone-400 hover:border-stone-500 hover:text-stone-200"
                      }`}
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      data-reaction-trigger
                      onClick={() => {
                        setShowEmojiPicker(false);
                        setReactionPickerForIndex((open) => (open === index ? null : index));
                      }}
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                        item.role === "user"
                          ? "border-blue-500/50 bg-blue-950/45 text-blue-100/95 hover:border-blue-400/60 hover:bg-blue-950/55"
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
                                    ? "bg-blue-700/90 shadow-inner ring-2 ring-blue-400/60"
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

          {typingIndicator ? (
            <div className="message-enter mt-4 flex w-full justify-start">
              <div className="w-fit max-w-[82%] min-w-0 rounded-2xl rounded-bl-sm border border-stone-600/80 bg-stone-700/90 px-4 py-2.5 text-sm text-stone-400">
                Typing…
              </div>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-stone-700/80 bg-stone-800/90 p-4">
          {error ? <p className="mb-2 text-sm text-rose-400">{error}</p> : null}

          {replyTarget?.quote ? (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-blue-700/40 bg-blue-950/30 px-3 py-2 text-xs text-blue-100/90">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-blue-200/80">
                  Replying to {replyTarget.role === "assistant" ? cloneProfile?.name || "Clone" : "your message"}
                </p>
                <p className="mt-0.5 text-stone-200/90">
                  {truncateReplyPreview(replyTarget.quote, 160)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="shrink-0 rounded-lg px-2 py-0.5 text-stone-400 transition hover:bg-stone-800 hover:text-stone-100"
                aria-label="Cancel reply"
              >
                ✕
              </button>
            </div>
          ) : null}

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
              disabled={
                !message.trim() ||
                message.trim().length > 400 ||
                loading
              }
              className="rounded-xl bg-blue-600 px-4 py-2.5 font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Send
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] text-stone-500">
            <span>
              Any message you send gets an AI reply — Reply is optional (use it to point at a specific older bubble) · React on any bubble · react-only needs no typing · bursts batch into one reply
            </span>
            <span>{message.length}/400</span>
          </div>
        </div>
      </div>
    </main>
  );
}
