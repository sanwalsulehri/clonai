import { NextResponse } from "next/server";
import { findCloneById } from "@/lib/cloneStore";
import { buildCloneSystemPrompt } from "@/lib/buildCloneSystemPrompt";
import {
  CHAT_FALLBACK_REPLY,
  CHAT_HISTORY_LIMIT,
  REACTION_ONLY_USER_LINE,
} from "@/lib/chatConstants";
import {
  applyReactionToHistoryContent,
  isSimpleGreeting,
  isSimpleHowAreYou,
  processCloneRawReply,
} from "@/lib/chatServerUtils";
import { normalizeLanguageCode } from "@/lib/languagePrompt";
import {
  extractAssistantMessageContent,
  fetchOpenRouterChatCompletion,
} from "@/lib/openRouterCompletion";

function jsonFallback() {
  return NextResponse.json({ reply: CHAT_FALLBACK_REPLY });
}

/** Server memory + client profile merge so localStorage can supply language, etc. */
function resolveClone(body) {
  const cloneId = body?.cloneId;
  const fallbackClone = body?.clone;
  const fromMem = cloneId ? findCloneById(cloneId) : null;
  const hasFallback =
    fallbackClone?.name?.trim() &&
    fallbackClone?.personality?.trim() &&
    fallbackClone?.style?.trim() &&
    fallbackClone?.tone?.trim();

  if (fromMem && hasFallback) {
    return { ...fromMem, ...fallbackClone };
  }
  if (fromMem) return fromMem;
  if (hasFallback) return fallbackClone;
  return null;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
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
    const rawHistory = Array.isArray(body?.history) ? body.history : [];

    if (!message || userTurn.length === 0) {
      return NextResponse.json(
        { error: "message is required." },
        { status: 400 },
      );
    }

    const clone = resolveClone(body);

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

    const langFromBody =
      typeof body?.language === "string" && body.language.trim()
        ? body.language.trim()
        : null;
    const language =
      langFromBody ||
      (typeof clone.language === "string" && clone.language.trim()) ||
      "english";
    const romanMode =
      typeof body?.romanMode === "boolean"
        ? body.romanMode
        : clone.romanMode === true;

    const isEnglish = normalizeLanguageCode(language) === "english";

    const systemPrompt = buildCloneSystemPrompt(clone, {
      language,
      romanMode,
    });

    if (
      !reactionOnly &&
      isEnglish &&
      userTurn.length === 1 &&
      isSimpleGreeting(userTurn[0])
    ) {
      return NextResponse.json({
        reply: userTurn[0].replace(/[.!? ]+$/g, ""),
      });
    }

    if (
      !reactionOnly &&
      isEnglish &&
      userTurn.length === 1 &&
      isSimpleHowAreYou(userTurn[0])
    ) {
      return NextResponse.json({
        reply: "good u?",
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
      .slice(-CHAT_HISTORY_LIMIT)
      .map((item) => ({
        role: item.role,
        content: applyReactionToHistoryContent(item),
      }));

    const { ok, data } = await fetchOpenRouterChatCompletion({
      apiKey: openRouterKey,
      payload: {
        model: "openai/gpt-4.1-mini",
        temperature: 0.9,
        top_p: 0.9,
        frequency_penalty: 0.3,
        presence_penalty: 0.3,
        max_tokens: 120,
        messages: [
          { role: "system", content: systemPrompt },
          ...history,
          ...userMessagesForModel,
        ],
      },
    });

    if (!ok) {
      return jsonFallback();
    }

    const aiMessage = extractAssistantMessageContent(data);
    if (!aiMessage?.trim()) {
      return jsonFallback();
    }

    const { reply } = processCloneRawReply(aiMessage);

    return NextResponse.json({ reply });
  } catch {
    return jsonFallback();
  }
}
