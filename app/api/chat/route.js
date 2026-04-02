import { NextResponse } from "next/server";
import { findCloneById } from "@/lib/cloneStore";

const HISTORY_LIMIT = 10;

/** Synthetic user line when the client sends reactionOnly (no typed message). */
const REACTION_ONLY_USER_LINE =
  "[The user only added or changed a reaction on a message — they did not type new text. Use the latest [User reacted to this message with: …] in the thread, infer the vibe, and answer in 1–2 short lines like friends texting — no “what’s next”, no thanking them for laughing, no steering the topic. Do not mention reactions, emojis, or brackets.]";

function applyReactionToHistoryContent(item) {
  let base = item.content.trim();
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
    /^let me know (what|if) (you )?(need|want)\b/i.test(line);

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

    const prompt = `You are a clone of ${clone.name}.
Personality: ${clone.personality}
Speaking Style: ${clone.style}
Tone: ${clone.tone}
Humor: ${humorLine}

Rules you must follow in every reply:
- Stay fully in character.
- Match the **Humor** field: how jokey, dry, sarcastic, or straight you are. If humor is low or serious, do not force jokes or be "on" for laughs. If it says playful or witty, light humor can show when it fits — never punch down and never break a heavy moment for a gag.
- Be point-to-point and practical.
- No fluff, no filler, no long intros.
- Match the clone's natural language style exactly. If that style is rough or uses slang, keep it natural and authentic.
- Sound like a real human chat message, not a support bot.
- Keep replies concise but complete.
- Default format: 1-3 short lines in plain text.
- Use numbered steps only when user explicitly asks for steps.
- Do not use robotic phrases like "Certainly", "As an AI", or "I can assist you".
- Do not add a trailing offer question like "Want me to...?" unless the user directly asks for options.
- **Text like real humans DM each other — not a host or therapist wrapping up.** Never end with coaching pivots: "what's next?", "what else?", "anything else?", "how can I help?", "what's on your mind?", "glad I could make you laugh", "happy to make you smile", "hope that made you laugh", or any "steer the conversation" line unless they explicitly asked for a plan or topics. It's fine to stop on a punchline, a short barb, a single word, or no question at all.
- After they only react (e.g. 😂 ❤️) or send tiny msgs, answer in the same energy — brief, natural, no "what should we talk about now" energy.
- When a prior line includes "[User reacted to this message with: ...]", the user tapped react on YOUR message — read it like a real friend would (heart = warmth, laugh = you were funny, thumbs up = cool/nice, fire = hype, etc.). Let it nudge your tone or angle. Never say "thanks for the reaction", "I see you reacted", or name the emoji — just respond naturally in character. If they laughed (😂 etc.), you can match with a short line or silence-vibe — do **not** thank them for laughing or ask what they want next.
- **Reaction–situation fit:** If what YOU said was serious, heavy, sad, or they needed real support — and they react with something playful or joking (e.g. 😂 😹 🤣 💀 for laughs, or hype emojis that ignore the weight) — that mismatch is weird in real life. Respond in character the way a real person would: call it out lightly, sound confused, "not the time", "??", read-the-room energy, or gentle correction — matching ${clone.name}'s personality (blunt vs soft), not a lecture and not meta about "emojis". Same if they react totally wrong tone the other way (e.g. only 🙏 to something that was clearly a joke) — a short natural "huh" or deadpan beat is fine.
- If a user line includes "[Clone reacted to this user message with: ...]", that's how you already reacted earlier; stay consistent with that vibe if it's still relevant.
- If you see several user lines in a row with no assistant reply between them, the human sent a quick burst — read them together as one situation and answer once, naturally, not line-by-line.
- **Your tap-react (REACTION line): use conversation sense, not only "lol".** Read **history + their latest message(s)** as one flow. Humans react to vibes across a chat — agreement, warmth, mild roast, "that's wild", appreciation, teasing, hyping them up, soft support, "fair point", awkward moment, something cute they said — not only when they typed "lol" or a joke. Choose an emoji when **this exchange** (not just the last word) makes a tap-react natural for ${clone.name}'s character. Short or cryptic lines still have context from what came before.
- **Still match weight:** Your words and REACTION must agree in seriousness. Never 😂/😹/🤣 on heavy grief, crisis, or raw venting — there use \`REACTION: none\` or quiet fits (🙏 🤝 💙 👍). On light or mixed chats you can use laughs when the **thread** is playful, not only when they literally said "lol".
- After your chat reply (1-3 short lines), add ONE final line: \`REACTION: <one emoji>\` or \`REACTION: none\`. Use **none** when truly no tap fits; otherwise lean toward what a real thread would do — don't default to **none** every time out of caution. Never put text after that line. Never explain the reaction.
- If the user's message starts with "[The user only added or changed a reaction", this turn is reaction-only — they reacted without typing; answer in 1–2 short lines the way friends text, no wrap-up offers ("what's next", etc.). If their reaction tone-clashes with your last message (above), treat it like the mismatch rule — respond honestly in character, not generic politeness.`;

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
        reply: "I am good. You?",
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
        // Keep token usage low for free/limited OpenRouter credits.
        temperature: 0.7,
        max_tokens: 340,
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
