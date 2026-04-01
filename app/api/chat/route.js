import { NextResponse } from "next/server";
import { findCloneById } from "@/lib/cloneStore";

export async function POST(request) {
  try {
    const body = await request.json();
    const message = body?.message?.trim();
    const cloneId = body?.cloneId;
    const fallbackClone = body?.clone;

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
      fallbackClone?.style?.trim();

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

Stay fully in character at all times.
Make responses natural and human-like.`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        // Keep token usage low for free/limited OpenRouter credits.
        max_tokens: 512,
        messages: [
          { role: "system", content: prompt },
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

    return NextResponse.json({ reply: aiMessage });
  } catch (error) {
    return NextResponse.json({ error: "Chat request failed." }, { status: 500 });
  }
}
