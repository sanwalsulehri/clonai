/**
 * Server-only: call OpenRouter chat completions API.
 */
export async function fetchOpenRouterChatCompletion({ apiKey, payload }) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  return { ok: response.ok, status: response.status, data, rawText };
}

/** Safe extraction of assistant text from OpenRouter-style JSON. */
export function extractAssistantMessageContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
