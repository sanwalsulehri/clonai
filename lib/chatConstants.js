/** Max prior turns (user + assistant) — keep last ~8–10 exchanges, fast context. */
export const CHAT_HISTORY_LIMIT = 9;

export const CHAT_FALLBACK_REPLY = "wait that was weird… try again";

/** Small pause after API returns before simulated typing (ms). */
export const POST_FETCH_REVEAL_MS = 400;

/** Synthetic user line when the client sends reactionOnly (no typed message). */
export const REACTION_ONLY_USER_LINE =
  "[Reaction only — no new text. Read what they reacted to; answer in 1–2 very short lines like a DM. No brackets/meta.]";
