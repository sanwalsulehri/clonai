/**
 * Client-side API helpers (fetch to this app's routes).
 */

export async function postCloneChat(payload, options = {}) {
  const { signal } = options;
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return { response, data };
}
