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
      !form.tone.trim()
    ) {
      setError("Please fill in all fields.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/create-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
            Define how your clone talks in 4 clear fields.
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
