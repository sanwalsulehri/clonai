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
    responseLength: "",
    goals: "",
    doNotUse: "",
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
      !form.responseLength.trim() ||
      !form.goals.trim()
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
          responseLength: data.responseLength,
          goals: data.goals,
          doNotUse: data.doNotUse,
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
            Define exactly how your clone should talk and what it must avoid.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            name="name"
            type="text"
            value={form.name}
            onChange={handleChange}
            placeholder="Name"
            className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
          />
          <input
            name="personality"
            type="text"
            value={form.personality}
            onChange={handleChange}
            placeholder="Personality"
            className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
          />
          <input
            name="style"
            type="text"
            value={form.style}
            onChange={handleChange}
            placeholder="Speaking style (e.g. natural, direct, calm)"
            className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
          />
          <input
            name="tone"
            type="text"
            value={form.tone}
            onChange={handleChange}
            placeholder="Tone (e.g. mature, respectful, confident)"
            className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
          />
          <select
            name="responseLength"
            value={form.responseLength}
            onChange={handleChange}
            className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
          >
            <option value="">Response length</option>
            <option value="short">Short (1-2 lines)</option>
            <option value="medium">Medium (2-4 lines)</option>
          </select>
          <textarea
            name="goals"
            value={form.goals}
            onChange={handleChange}
            placeholder="How this clone should behave (point-to-point, ask useful follow-ups, be precise)"
            rows={3}
            className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
          />
          <textarea
            name="doNotUse"
            value={form.doNotUse}
            onChange={handleChange}
            placeholder="Words or styles to avoid (optional)"
            rows={2}
            className="rounded-xl border border-stone-600 bg-stone-900/80 px-3 py-2.5 text-stone-100 outline-none transition placeholder:text-stone-500 focus:border-amber-600/70 focus:ring-2 focus:ring-amber-500/25"
          />

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
