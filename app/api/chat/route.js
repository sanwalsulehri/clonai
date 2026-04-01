import { NextResponse } from "next/server";
import { findCloneById } from "@/lib/cloneStore";

const HISTORY_LIMIT = 10;

function capLength(text, responseLength) {
  const charLimit = responseLength === "medium" ? 300 : 180;
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
      fallbackClone?.tone?.trim() &&
      fallbackClone?.responseLength?.trim() &&
      fallbackClone?.goals?.trim();

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
Primary Goals: ${clone.goals}
Avoid these words/styles: ${clone.doNotUse || "none"}
Target Response Length: ${clone.responseLength}

Rules you must follow in every reply:
- Stay fully in character.
- Be point-to-point and practical.
- No fluff, no filler, no long intros.
- Match the clone's natural language style exactly. If that style is rough or uses slang, keep it natural and authentic.
- Respect "Avoid these words/styles" strictly.
- Keep replies concise.
- Answer in 1-3 short lines max.
- Ask one short follow-up question only if needed for clarity.`;

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
        max_tokens: 220,
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

    const cleaned = capLength(normalizeReply(aiMessage), clone.responseLength);

    return NextResponse.json({ reply: cleaned });
  } catch (error) {
    return NextResponse.json({ error: "Chat request failed." }, { status: 500 });
  }
}
