"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    personality: "",
    style: "",
    tone: "",
    humor: "",
    language: "english",
    romanMode: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (
      !form.name.trim() ||
      !form.personality.trim() ||
      !form.style.trim() ||
      !form.tone.trim() ||
      !form.humor.trim()
    ) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/create-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          personality: form.personality,
          style: form.style,
          tone: form.tone,
          humor: form.humor,
          language: form.language || "english",
          romanMode: form.romanMode === true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to create clone.");
      }

      localStorage.setItem("cloneId", data.id);
      localStorage.setItem(
        "cloneProfile",
        JSON.stringify({
          name: data.name,
          personality: data.personality,
          style: data.style,
          tone: data.tone,
          humor: data.humor,
          language: data.language ?? "english",
          romanMode: data.romanMode === true,
        }),
      );
      router.push("/chat");
    } catch (submitError) {
      setError(submitError.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-900 px-4 py-10 text-stone-100">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-2xl border border-stone-700/80 bg-stone-800/95 p-6 shadow-2xl shadow-stone-950/50">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200/90">
            AI Clone Studio
          </p>
          <h1 className="text-2xl font-semibold text-stone-50">Create Your AI Clone</h1>
          <p className="text-sm text-stone-400">
            Define how your clone talks in 5 clear fields.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-xs font-medium text-stone-300">
              Clone Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Sulehri"
              className="w-full rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="personality" className="text-xs font-medium text-stone-300">
              Personality
            </label>
            <input
              id="personality"
              name="personality"
              type="text"
              value={form.personality}
              onChange={handleChange}
              placeholder="e.g. bold, playful, sharp"
              className="w-full rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="style" className="text-xs font-medium text-stone-300">
              Speaking Style
            </label>
            <input
              id="style"
              name="style"
              type="text"
              value={form.style}
              onChange={handleChange}
              placeholder="e.g. natural, direct, short-texting"
              className="w-full rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="tone" className="text-xs font-medium text-stone-300">
              Tone
            </label>
            <input
              id="tone"
              name="tone"
              type="text"
              value={form.tone}
              onChange={handleChange}
              placeholder="e.g. mature, confident, respectful"
              className="w-full rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="humor" className="text-xs font-medium text-stone-300">
              Humor
            </label>
            <input
              id="humor"
              name="humor"
              type="text"
              value={form.humor}
              onChange={handleChange}
              placeholder="e.g. dry wit, playful jokes, mostly serious, meme-y"
              className="w-full rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-stone-300">Chat language & script</p>
            <div className="flex flex-row flex-nowrap items-stretch gap-3">
              <div className="min-w-0 flex-1">
                <label htmlFor="language" className="sr-only">
                  Chat language
                </label>
                <select
                  id="language"
                  name="language"
                  value={form.language}
                  onChange={handleChange}
                  className="h-full min-h-[2.75rem] w-full rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
                >
                  <option value="english">English</option>
                  <option value="urdu">Urdu</option>
                  <option value="hindi">Hindi</option>
                  <option value="arabic">Arabic</option>
                  <option value="punjabi">Punjabi</option>
                </select>
              </div>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl border border-stone-600/90 bg-stone-900/50 px-3 py-2.5 transition hover:border-stone-500 hover:bg-stone-900/70 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-500/35">
                <input
                  type="checkbox"
                  name="romanMode"
                  checked={form.romanMode}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, romanMode: e.target.checked }))
                  }
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 bg-stone-950 transition ${
                    form.romanMode
                      ? "border-amber-400 bg-amber-600/40 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]"
                      : "border-stone-500"
                  }`}
                >
                  <svg
                    viewBox="0 0 12 12"
                    className={`h-3 w-3 text-amber-200 transition-opacity ${
                      form.romanMode ? "opacity-100" : "opacity-0"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M2.5 6l2.5 2.5L9.5 3.5" />
                  </svg>
                </span>
                <span className="text-xs leading-snug text-stone-300 select-none">
                  Roman / Latin script{" "}
                  <span className="text-stone-500">(e.g. Urdu in English letters)</span>
                </span>
              </label>
            </div>
          </div>

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-amber-800 px-4 py-2.5 font-medium text-stone-50 transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Creating..." : "Create Clone"}
          </button>
        </form>
      </div>
    </main>
  );
}
