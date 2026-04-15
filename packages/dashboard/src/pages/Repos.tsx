import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type RepoConfig } from "../api";

const styleBadgeColor: Record<RepoConfig["style"], string> = {
  strict: "bg-red-900 text-red-300",
  balanced: "bg-blue-900 text-blue-300",
  lenient: "bg-green-900 text-green-300",
  roast: "bg-orange-900 text-orange-300",
  thorough: "bg-purple-900 text-purple-300",
};

function AddRepoForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.updateRepo(owner, repo, {
        style: "balanced",
        focusAreas: [],
        ignorePatterns: [],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repos"] });
      onClose();
    },
  });

  return (
    <div className="mt-4 p-4 border border-slate-700 rounded-lg bg-slate-800 max-w-sm">
      <h3 className="text-sm font-semibold mb-3 text-slate-200">Add repository</h3>
      <div className="flex gap-2 mb-3">
        <input
          className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
          placeholder="owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
        <span className="text-slate-500 self-center">/</span>
        <input
          className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
          placeholder="repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
      </div>
      {mutation.isError && <p className="text-red-400 text-xs mb-2">Failed to add repository.</p>}
      <div className="flex gap-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={!owner || !repo || mutation.isPending}
          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-medium text-sm rounded transition-colors"
        >
          {mutation.isPending ? "Adding…" : "Add"}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Repos() {
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["repos"],
    queryFn: api.getRepos,
  });

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (isError) return <p className="text-red-400">Failed to load repositories.</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-100">Repositories</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium text-sm rounded-md transition-colors"
        >
          + Add repository
        </button>
      </div>

      {showForm && <AddRepoForm onClose={() => setShowForm(false)} />}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {data?.map((r) => (
          <div
            key={`${r.owner}/${r.repo}`}
            onClick={() => void navigate(`/repos/${r.owner}/${r.repo}`)}
            className="p-4 bg-slate-800 border border-slate-700 rounded-lg cursor-pointer hover:border-slate-500 transition-colors"
          >
            <p className="text-slate-100 font-medium text-sm mb-2">
              {r.owner}/{r.repo}
            </p>
            <div className="flex items-center justify-between">
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${styleBadgeColor[r.style]}`}
              >
                {r.style}
              </span>
              <span className="text-xs text-slate-500">
                {r.focusAreas.length} focus area{r.focusAreas.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        ))}
      </div>

      {data?.length === 0 && (
        <p className="mt-8 text-slate-500 text-sm">No repositories configured yet.</p>
      )}
    </div>
  );
}
