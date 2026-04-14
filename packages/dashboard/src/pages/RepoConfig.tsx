import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type RepoConfig } from "../api";

const STYLES: { value: RepoConfig["style"]; label: string; description: string }[] = [
  {
    value: "strict",
    label: "Strict",
    description: "Flag all potential issues, including minor ones",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Focus on meaningful issues, skip nitpicks",
  },
  {
    value: "lenient",
    label: "Lenient",
    description: "Only surface critical bugs and security issues",
  },
  { value: "roast", label: "Roast", description: "Brutally honest with dark humour" },
];

const FOCUS_AREAS: { value: string; label: string; subtitle: string }[] = [
  { value: "security", label: "Security", subtitle: "Vulnerabilities, injections, auth flaws" },
  {
    value: "performance",
    label: "Performance",
    subtitle: "Algorithmic complexity, caching, queries",
  },
  { value: "testing", label: "Testing", subtitle: "Coverage, edge cases, test quality" },
  { value: "readability", label: "Readability", subtitle: "Naming, structure, documentation" },
  { value: "architecture", label: "Architecture", subtitle: "Design patterns, coupling, cohesion" },
  { value: "error-handling", label: "Error Handling", subtitle: "Exceptions, retries, fallbacks" },
];

export function RepoConfig() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["repo", owner, repo],
    queryFn: () => api.getRepo(owner ?? "", repo ?? ""),
    enabled: !!owner && !!repo,
  });

  const [style, setStyle] = useState<RepoConfig["style"]>("balanced");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [ignorePatterns, setIgnorePatterns] = useState("");

  useEffect(() => {
    if (data) {
      setStyle(data.style);
      setFocusAreas(data.focusAreas);
      setIgnorePatterns(data.ignorePatterns.join("\n"));
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () =>
      api.updateRepo(owner ?? "", repo ?? "", {
        style,
        focusAreas,
        ignorePatterns: ignorePatterns
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repo", owner, repo] });
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
    },
  });

  const toggleFocusArea = (value: string) => {
    setFocusAreas((prev) =>
      prev.includes(value) ? prev.filter((a) => a !== value) : [...prev, value],
    );
  };

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (isError) return <p className="text-red-400">Failed to load repository config.</p>;

  return (
    <div className="max-w-2xl">
      <button
        onClick={() => void navigate(-1)}
        className="text-slate-400 hover:text-slate-200 text-sm mb-4 transition-colors"
      >
        ← Back
      </button>
      <h1 className="text-2xl font-bold text-slate-100 mb-6">
        {owner}/{repo}
      </h1>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
          Review Style
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {STYLES.map(({ value, label, description }) => (
            <label
              key={value}
              className={`flex flex-col gap-1 p-3 border rounded-lg cursor-pointer transition-colors ${
                style === value
                  ? "border-amber-400 bg-amber-400/5"
                  : "border-slate-700 bg-slate-800 hover:border-slate-500"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="style"
                  value={value}
                  checked={style === value}
                  onChange={() => setStyle(value)}
                  className="accent-amber-400"
                />
                <span className="text-sm font-medium text-slate-100">{label}</span>
              </div>
              <p className="text-xs text-slate-500 pl-5">{description}</p>
            </label>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
          Focus Areas
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {FOCUS_AREAS.map(({ value, label, subtitle }) => (
            <label
              key={value}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                focusAreas.includes(value)
                  ? "border-amber-400 bg-amber-400/5"
                  : "border-slate-700 bg-slate-800 hover:border-slate-500"
              }`}
            >
              <input
                type="checkbox"
                checked={focusAreas.includes(value)}
                onChange={() => toggleFocusArea(value)}
                className="mt-0.5 accent-amber-400"
              />
              <div>
                <p className="text-sm font-medium text-slate-100">{label}</p>
                <p className="text-xs text-slate-500">{subtitle}</p>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide mb-3">
          Ignore Patterns
        </h2>
        <textarea
          rows={4}
          value={ignorePatterns}
          onChange={(e) => setIgnorePatterns(e.target.value)}
          placeholder={"*.lock\ndist/**\n*.generated.ts"}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400 font-mono resize-y"
        />
        <p className="text-xs text-slate-500 mt-1">one pattern per line</p>
      </section>

      {mutation.isSuccess && <p className="text-green-400 text-sm mb-3">Saved successfully.</p>}
      {mutation.isError && <p className="text-red-400 text-sm mb-3">Failed to save.</p>}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold text-sm rounded-md transition-colors"
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
