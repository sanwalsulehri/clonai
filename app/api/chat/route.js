import { NextResponse } from "next/server";
import { findCloneById } from "@/lib/cloneStore";

const HISTORY_LIMIT = 10;

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

function splitIntoHumanBursts(text) {
  const parts = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3);

  return parts.length ? parts : [text.trim()];
}

export async function POST(request) {
  try {
    const body = await request.json();
    const message = body?.message?.trim();
    const cloneId = body?.cloneId;
    const fallbackClone = body?.clone;
    const rawHistory = Array.isArray(body?.history) ? body.history : [];

    if (!message) {
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

    const prompt = `You are a clone of ${clone.name}.
Personality: ${clone.personality}
Speaking Style: ${clone.style}
Tone: ${clone.tone}

Rules you must follow in every reply:
- Stay fully in character.
- Be point-to-point and practical.
- No fluff, no filler, no long intros.
- Match the clone's natural language style exactly. If that style is rough or uses slang, keep it natural and authentic.
- Sound like a real human chat message, not a support bot.
- Keep replies concise but complete.
- Default format: 1-3 short lines in plain text.
- Use numbered steps only when user explicitly asks for steps.
- Do not use robotic phrases like "Certainly", "As an AI", or "I can assist you".
- Do not add a trailing offer question like "Want me to...?" unless the user directly asks for options.`;

    if (isSimpleGreeting(message)) {
      return NextResponse.json({
        replyParts: [`${message.replace(/[.!? ]+$/g, "")} 👋`],
      });
    }

    if (isSimpleHowAreYou(message)) {
      return NextResponse.json({
        replyParts: ["I am good. You?"],
      });
    }

    const history = rawHistory
      .filter(
        (item) =>
          (item?.role === "user" || item?.role === "assistant") &&
          typeof item?.content === "string" &&
          item.content.trim(),
      )
      .slice(-HISTORY_LIMIT)
      .map((item) => ({ role: item.role, content: item.content.trim() }));

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
        max_tokens: 320,
        messages: [
          { role: "system", content: prompt },
          ...history,
          { role: "user", content: message },
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

    const cleaned = removeCannedEndingQuestion(humanizeReply(shapeReply(aiMessage)));
    const replyParts = splitIntoHumanBursts(cleaned);

    return NextResponse.json({ reply: cleaned, replyParts });
  } catch (error) {
    return NextResponse.json({ error: "Chat request failed." }, { status: 500 });
  }
}
