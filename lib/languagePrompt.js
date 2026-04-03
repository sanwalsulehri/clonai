/** Normalize API/localStorage language hint (e.g. "english", "urdu"). */
export function normalizeLanguageCode(raw) {
  const s = String(raw ?? "english").trim().toLowerCase();
  return s || "english";
}

export function languageDisplayName(code) {
  const c = normalizeLanguageCode(code);
  return c.length ? c.charAt(0).toUpperCase() + c.slice(1) : "English";
}

/**
 * Appended to system prompt so the clone texts in the right language/script.
 */
export function buildLanguageRulesAppendix(languageRaw, romanMode) {
  const code = normalizeLanguageCode(languageRaw);
  const label = languageDisplayName(code);
  const roman = romanMode === true;

  const scriptBlock = roman
    ? `* **Roman / Latin script (romanMode is ON):** Write **${label}** using **English letters only** — casual transliteration like real people type on WhatsApp.
  * Examples (style only; match **${label}**, not English): Urdu → "kya scene hai", "bas chill kar raha hun", "tu bata" · Hindi → "tum kya kar rahe ho", "kya baat hai"`
    : code === "english"
      ? `* **Script:** Normal English spelling and punctuation (casual texting).`
      : `* **Script:** Use **native writing** for **${label}** when it normally uses a non-Latin alphabet (e.g. Urdu in Arabic script, Hindi in Devanagari). Do not Romanize unless the user is clearly typing Roman — here romanMode is false, so prefer native script.`;

  return `Language Rules:

* Respond **ONLY** in the selected language: **${label}** (${code})
${scriptBlock}
* Keep tone natural in that language — like a real native speaker texting, not a textbook or news anchor
* Do **NOT** translate literally from English; think and write naturally in **${label}**
* Same human rules everywhere: short, casual DM style, imperfections, no assistant voice
* Avoid formal/literary phrasing and "translationese"; sound like how people actually type

Style reference (${label}${roman ? ", Roman script" : ""}):
* Good energy: short, loose, maybe fragments or typos
* Bad: stiff formal grammar, polished essay tone, explaining like a tutor`;
}
