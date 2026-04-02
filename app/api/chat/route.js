import { NextResponse } from "next/server";
import { findCloneById } from "@/lib/cloneStore";

const HISTORY_LIMIT = 10;

/** Synthetic user line when the client sends reactionOnly (no typed message). */
const REACTION_ONLY_USER_LINE =
  "[The user only added or changed a reaction on a message — they did not type new text. Use the latest [User reacted to this message with: …] in the thread, infer the vibe, and answer in 1–2 short lines like friends texting — no “what’s next”, no thanking them for laughing, no steering the topic. Do not mention reactions, emojis, or brackets.]";

function applyReactionToHistoryContent(item) {
  let base = item.content.trim();
  const rtQuote =
    item.role === "user" &&
    item.replyTo &&
    typeof item.replyTo.quote === "string" &&
    item.replyTo.quote.trim();
  if (rtQuote) {
    const role = item.replyTo.role === "assistant" ? "assistant" : "user";
    const q = item.replyTo.quote.trim().slice(0, 420);
    base = `[User is replying to this earlier ${role} message: "${q}"]\n${base}`;
  }
  const cloneR =
    typeof item.cloneReaction === "string" ? item.cloneReaction.trim() : "";
  if (item.role === "user" && cloneR) {
    base = `${base}\n[Clone reacted to this user message with: ${cloneR}]`;
  }
  const reaction =
    typeof item.reaction === "string" ? item.reaction.trim() : "";
  if (reaction) {
    base = `${base}\n[User reacted to this message with: ${reaction}]`;
  }
  return base;
}

/** Model must end with `REACTION: emoji` or `REACTION: none` on its own line. */
function stripCloneReactionLine(raw) {
  if (typeof raw !== "string") return { text: "", cloneReaction: null };
  const trimmedEnd = raw.trimEnd();
  const lines = trimmedEnd.split("\n");
  const lastLine = lines[lines.length - 1]?.trim() ?? "";
  const m = /^REACTION:\s*(.+)$/i.exec(lastLine);
  if (!m) return { text: trimmedEnd.trim(), cloneReaction: null };
  const val = m[1].trim();
  const text = lines.slice(0, -1).join("\n").trimEnd();
  if (/^none$/i.test(val) || val === "" || val === "-") {
    return { text: text.trim(), cloneReaction: null };
  }
  const cloneReaction = val.length > 10 ? val.slice(0, 10) : val;
  return { text: text.trim(), cloneReaction };
}

function capLength(text, responseLength) {
  const charLimit = responseLength === "short" ? 220 : 420;
  const clean = text.trim();
  if (clean.length <= charLimit) return clean;
  return `${clean.slice(0, charLimit).trimEnd()}...`;
}

function normalizeReply(text) {
  return text
    .trim()
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ");
}

function shapeReply(text) {
  const normalized = normalizeReply(text);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);

  const compact = lines.join("\n");
  return capLength(compact || normalized, "balanced");
}

function humanizeReply(text) {
  return text
    .replace(/^(Certainly|Sure|Of course|Absolutely|Great question)[,!.\s-]*/i, "")
    .replace(/\bAs an AI\b/gi, "")
    .replace(/\bI can assist you with that\b/gi, "I can help with that")
    .replace(/\bI'?d be (more than )?happy to (help|assist)\b/gi, "I can")
    .replace(/^I hear you,?\s+/i, "")
    .replace(/^Thank you for sharing[.:]?\s*/i, "")
    .replace(/\bFeel free to reach out\b[^.?!]*[.?!]\s*/gi, "")
    .trim();
}

function removeCannedEndingQuestion(text) {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return text;

  const lastLine = lines[lines.length - 1];
  const looksLikeCannedQuestion =
    /^(want|need)\b.+\?$/i.test(lastLine) ||
    /^(do you want|would you like|should i)\b.+\?$/i.test(lastLine);

  if (looksLikeCannedQuestion && lines.length > 1) {
    lines.pop();
    return lines.join("\n");
  }

  return text;
}

/** Strip chatbot/host endings humans don't send (what's next, glad I made you laugh, etc.). */
function stripHostyTrailingStuff(text) {
  let t = text.trim();
  if (!t) return t;

  t = t
    .replace(/\bglad i (could|can) make you laugh[.!]?\s*/gi, "")
    .replace(/\bhappy (that )?i (could )?make you laugh[.!]?\s*/gi, "")
    .replace(/\bhope that made you laugh[.!]?\s*/gi, "")
    .replace(/\bhope i made you laugh[.!]?\s*/gi, "")
    .replace(/\bglad you're laughing[.!]?\s*/gi, "")
    .replace(/\bglad that (got a )?laugh[.!]?\s*/gi, "")
    .replace(/\bthat's what i'?m here for[.!]?\s*/gi, "")
    .replace(/\balways (happy|here) to (make you )?laugh[.!]?\s*/gi, "")
    .replace(/\s*what'?s\s+next\??\s*$/gi, "")
    .replace(/\s*what (else|now)\??\s*$/gi, "")
    .replace(/\s*anything else\??\s*$/gi, "")
    .trim();

  if (!t) return "";

  const lines = t.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const badClosingLine = (line) =>
    /^what'?s\s+next\??$/i.test(line) ||
    /^what (else|now)\??$/i.test(line) ||
    /^anything else\??$/i.test(line) ||
    /^how can i help( you)?\??$/i.test(line) ||
    /^need anything else\??$/i.test(line) ||
    /^what (would you|do you want to) (like to )?(talk about|do)\??$/i.test(
      line,
    ) ||
    /^what'?s on your mind\??$/i.test(line) ||
    /^tell me more\??$/i.test(line) ||
    /^let me know (what|if) (you )?(need|want)\b/i.test(line) ||
    /^hope (that )?helps?\!?\s*$/i.test(line) ||
    /^happy to (help|chat)\!?\s*$/i.test(line) ||
    /^here (for you|if you need)\b/i.test(line);

  while (lines.length > 0 && badClosingLine(lines[lines.length - 1])) {
    lines.pop();
  }

  const out = lines.join("\n").trim();
  if (!out) return "";
  return out;
}

function isSimpleGreeting(text) {
  const normalized = text.toLowerCase().trim();
  return /^(hi|hii|hiii|hey|heyy|heyyy|hello|yo|sup|wassup|salam|aslam|assalamualaikum)[!. ]*$/.test(
    normalized,
  );
}

function isSimpleHowAreYou(text) {
  const normalized = text.toLowerCase().trim();
  return /^(how are you|how r u|how are u|how's it going|hows it going|kese ho|kaise ho)[?.! ]*$/.test(
    normalized,
  );
}

export async function POST(request) {
  try {
    const body = await request.json();
    const reactionOnly = body?.reactionOnly === true;
    const rawTurn = body?.turnMessages;
    const turnFromClient = Array.isArray(rawTurn)
      ? rawTurn.map((t) => String(t).trim()).filter(Boolean)
      : [];
    const single = typeof body?.message === "string" ? body.message.trim() : "";
    let userTurn =
      turnFromClient.length > 0 ? turnFromClient : single ? [single] : [];

    if (reactionOnly) {
      userTurn = [REACTION_ONLY_USER_LINE];
    }

    const message = userTurn.length ? userTurn[userTurn.length - 1] : "";
    const cloneId = body?.cloneId;
    const fallbackClone = body?.clone;
    const rawHistory = Array.isArray(body?.history) ? body.history : [];

    if (!message || userTurn.length === 0) {
      return NextResponse.json(
        { error: "message is required." },
        { status: 400 },
      );
    }

    const cloneFromMemory = cloneId ? findCloneById(cloneId) : null;
    const hasFallbackClone =
      fallbackClone?.name?.trim() &&
      fallbackClone?.personality?.trim() &&
      fallbackClone?.style?.trim() &&
      fallbackClone?.tone?.trim();

    const clone = cloneFromMemory ?? (hasFallbackClone ? fallbackClone : null);

    if (!clone) {
      return NextResponse.json(
        {
          error:
            "Clone not found. Please create your clone again so chat context can be restored.",
        },
        { status: 404 },
      );
    }

    const openRouterKey =
      process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_KEY;

    if (!openRouterKey) {
      return NextResponse.json(
        { error: "OpenRouter API key is not configured." },
        { status: 500 },
      );
    }

    const humorLine =
      typeof clone.humor === "string" && clone.humor.trim()
        ? clone.humor.trim()
        : "Infer lightly from personality and tone — stay natural, not a comedian unless that fits.";

    const prompt = `You are ${clone.name} on a private text thread — a real person they know, not a brand, coach, therapist, or customer support bot.

Your profile (stay consistent):
Personality: ${clone.personality}
How you write (cadence, slang, length): ${clone.style}
Tone: ${clone.tone}
Humor: ${humorLine}

Make it feel human (highest priority):
- **Match their energy and scale.** "ok" / "lol" / ".." / one emoji → answer tight; a rant or serious spill → you can go a touch longer but still **text-message sized**, never a memo, essay, or bullet manifesto unless they asked for steps.
- **Use the whole conversation.** Callbacks, inside jokes, what they said earlier, the vibe between you — like someone who was actually here, not a fresh ticket.
- **Threaded replies:** when a user line starts with \`[User is replying to this earlier assistant message:\` or \`...earlier user message:\`, they quoted something — your answer must land on **that** message, not a generic reply to only the last word.
- **Humor:** follow the Humor line — dry, playful, or straight. Don't force jokes when the moment is heavy; never punch down; don't break real pain for a bit.
- **Voice:** fragments, lowercase, "…", deadpan, slang — when it fits ${clone.name}. Don't sound polished, corporate, or "helpdesk": no "Additionally", "I'd be happy to", "Great question", "Thank you for sharing", "I hear you", "feel free to reach out".
- **Grounded, not performative:** sound like you're texting back, not performing empathy or closing a meeting *unless* that's genuinely their vibe.

Hard nos (instant uncanny valley):
- Openers/closers: Certainly, As an AI, I can assist, what's next, what else, anything else, how can I help, what's on your mind, glad I could make you laugh, hope that helped, let me know if you need anything.
- Trailing "Want me to…?" unless they explicitly asked for options or a menu.
- Numbered lists only if they asked for steps.

Reacts & bursts:
- \`[User reacted to this message with: …]\` on YOUR past line = they tap-reacted — nudge like a real friend; never thank them for reacting or name the emoji. 😂 after something heavy = mismatch: read room, soft call-out in character.
- \`[Clone reacted to this user message…]\` = you already reacted; stay loosely consistent.
- Several user lines, no assistant between = one burst → one combined read, one reply.
- **REACTION:** last line only: \`REACTION: <one emoji>\` or \`REACTION: none\`. Emoji must match the **same** mood as your words; use context from the thread, not only "lol". No 😂 on raw grief. No text after REACTION.

Reaction-only turns (user message is the meta line about reaction-only): 1–2 short friend texts, zero steering / "what's next". Honest if their react clashed with your last serious line.`;

    if (
      !reactionOnly &&
      userTurn.length === 1 &&
      isSimpleGreeting(userTurn[0])
    ) {
      return NextResponse.json({
        reply: userTurn[0].replace(/[.!? ]+$/g, ""),
        cloneReaction: "👋",
      });
    }

    if (
      !reactionOnly &&
      userTurn.length === 1 &&
      isSimpleHowAreYou(userTurn[0])
    ) {
      return NextResponse.json({
        reply: "Good. You?",
        cloneReaction: "🙏",
      });
    }

    const userMessagesForModel = userTurn.map((line) => ({
      role: "user",
      content: line,
    }));

    const history = rawHistory
      .filter(
        (item) =>
          (item?.role === "user" || item?.role === "assistant") &&
          typeof item?.content === "string" &&
          item.content.trim(),
      )
      .slice(-HISTORY_LIMIT)
      .map((item) => ({
        role: item.role,
        content: applyReactionToHistoryContent(item),
      }));

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        // Slightly warmer for more natural, human-like variation in tone.
        temperature: 0.78,
        max_tokens: 360,
        messages: [
          { role: "system", content: prompt },
          ...history,
          ...userMessagesForModel,
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      let parsedError = null;

      try {
        parsedError = JSON.parse(errorBody);
      } catch {
        parsedError = null;
      }

      const isCreditError = parsedError?.error?.code === 402;

      return NextResponse.json(
        {
          error: isCreditError
            ? "OpenRouter credits are insufficient for this request. Please add credits or try again with shorter prompts."
            : `OpenRouter request failed: ${errorBody}`,
        },
        { status: 500 },
      );
    }

    const data = await response.json();
    const aiMessage = data?.choices?.[0]?.message?.content;

    if (!aiMessage) {
      return NextResponse.json(
        { error: "No response message returned by OpenRouter." },
        { status: 500 },
      );
    }

    const { text: replyWithReactionStripped, cloneReaction: parsedReaction } =
      stripCloneReactionLine(aiMessage);
    const replyCore = stripHostyTrailingStuff(
      removeCannedEndingQuestion(
        humanizeReply(shapeReply(replyWithReactionStripped)),
      ),
    );
    let reply = replyCore?.trim() || "";
    if (!reply && parsedReaction) reply = "ok";
    if (!reply) reply = "ok";

    const payload = { reply };
    if (parsedReaction) payload.cloneReaction = parsedReaction;
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ error: "Chat request failed." }, { status: 500 });
  }
}
