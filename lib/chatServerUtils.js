export function applyReactionToHistoryContent(item) {
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
  const reaction =
    typeof item.reaction === "string" ? item.reaction.trim() : "";
  if (reaction) {
    base = `${base}\n[User reacted to this message with: ${reaction}]`;
  }
  return base;
}

/** Remove structured tail lines if the model ignores instructions. */
function stripStructuredLabels(text) {
  let t = text.trimEnd();
  if (!t) return t;
  const lines = t.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1]?.trim() ?? "";
    if (/^REACTION:\s*/i.test(last) || /^EMOTION:\s*/i.test(last)) {
      lines.pop();
      t = lines.join("\n").trimEnd();
      continue;
    }
    break;
  }
  return t.trim();
}

function capLength(text) {
  const charLimit = 200;
  const clean = text.trim();
  if (clean.length <= charLimit) return clean;
  return `${clean.slice(0, charLimit).trimEnd()}…`;
}

/** Hard cap ~22 words across max 2 lines — backs prompt "mostly under 15 words". */
function capWordCountMultiline(text, maxTotal = 22, maxLines = 2) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  const out = [];
  let total = 0;
  for (const line of lines) {
    const words = line.split(/\s+/).filter(Boolean);
    const room = maxTotal - total;
    if (room <= 0) break;
    const perLineCap = Math.min(14, room);
    const w = words.slice(0, perLineCap);
    if (w.length === 0) continue;
    out.push(w.join(" "));
    total += w.length;
  }
  return out.join("\n");
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
    .slice(0, 2);

  const compact = lines.join("\n");
  const base = compact || normalized;
  const wordCapped = capWordCountMultiline(base, 22, 2);
  return capLength(wordCapped);
}

function humanizeReply(text) {
  return text
    .replace(/^(Certainly|Sure|Of course|Absolutely|Great question)[,!.\s-]*/i, "")
    .replace(/\bAs an AI\b/gi, "")
    .replace(/\bI'?m an AI\b/gi, "")
    .replace(/^I (completely |fully )?understand( that)?[,.:]?\s*/i, "")
    .replace(/^I hear what you(?:'re| are) saying[,.:]?\s*/i, "")
    .replace(/^How can I help( you)?\??\s*/i, "")
    .replace(/^What can I do for you\??\s*/i, "")
    .replace(/^How may I assist\b[^.?!]*[.?!]?\s*/i, "")
    .replace(/^I hear you,?\s+/i, "")
    .replace(/^Thank you for sharing[.:]?\s*/i, "")
    .replace(/\bI'?d be (delighted|happy) to\b[^.?!]*[.?!]\s*/gi, "")
    .replace(/\bFeel free to reach out\b[^.?!]*[.?!]\s*/gi, "")
    .replace(/\bplease don'?t hesitate\b[^.?!]*[.?!]\s*/gi, "")
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

  const lines = t.split("\n").map((line) => line.trim()).filter(Boolean);
  const badClosingLine = (line) =>
    /^what'?s\s+next\??$/i.test(line) ||
    /^what (else|now)\??$/i.test(line) ||
    /^anything else\??$/i.test(line) ||
    /^how can i help( you)?\??$/i.test(line) ||
    /^what can i do for you\??$/i.test(line) ||
    /^I (completely |fully )?understand[.,]?\s*$/i.test(line) ||
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

function stripPerformativeAIText(text) {
  const t = text.trim();
  if (!t) return t;

  const scrubLine = (line) => {
    let s = line.trim();
    if (!s) return "";
    s = s
      .replace(/\bglad you got a chuckle out of[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\bglad (you )?got a laugh out of[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\bcheers to shared suffering[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\bhere'?s to shared suffering[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\ba (little )?shared suffering[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\bthe usual cocktail of[^.]*\b(sprinkled|dusted)( on top)?[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\bexistential dread (sprinkled|on top)[^.?!]*[.?!]?\s*/gi, "")
      .replace(/\s+/g, " ")
      .replace(/\s*([.?!,])\s*\1+/g, "$1")
      .trim();
    s = s.replace(/^[,;.\s]+/, "").replace(/[,;.\s]+$/, "").trim();
    return s;
  };

  return t
    .split("\n")
    .map(scrubLine)
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function processCloneRawReply(rawText) {
  const stripped = stripStructuredLabels(typeof rawText === "string" ? rawText : "");
  const replyCore = stripPerformativeAIText(
    stripHostyTrailingStuff(
      removeCannedEndingQuestion(humanizeReply(shapeReply(stripped))),
    ),
  );
  let reply = replyCore?.trim() || "";
  if (!reply) reply = "ok";
  return { reply };
}

export function isSimpleGreeting(text) {
  const normalized = text.toLowerCase().trim();
  return /^(hi|hii|hiii|hey|heyy|heyyy|hello|yo|sup|wassup|salam|aslam|assalamualaikum)[!. ]*$/.test(
    normalized,
  );
}

export function isSimpleHowAreYou(text) {
  const normalized = text.toLowerCase().trim();
  return /^(how are you|how r u|how are u|how's it going|hows it going|kese ho|kaise ho)[?.! ]*$/.test(
    normalized,
  );
}
