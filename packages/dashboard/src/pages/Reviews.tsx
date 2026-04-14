import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

const PAGE_SIZE = 20;

const recommendationColor: Record<string, string> = {
  looks_good: "text-green-400",
  critical_issues: "text-red-400",
  address_before_merge: "text-yellow-400",
};

const recommendationLabel: Record<string, string> = {
  looks_good: "Looks good",
  critical_issues: "Critical issues",
  address_before_merge: "Address before merge",
};

function TriageBadge({
  review,
}: {
  review: { filesSkipped?: number; filesSkimmed?: number; filesDeepReviewed?: number };
}) {
  if (
    review.filesSkipped == null &&
    review.filesSkimmed == null &&
    review.filesDeepReviewed == null
  ) {
    return <span className="text-slate-600 text-xs">—</span>;
  }

  return (
    <span className="inline-flex gap-1.5 text-xs">
      <span className="text-slate-500" title="Skipped">
        {review.filesSkipped ?? 0}s
      </span>
      <span className="text-slate-500">/</span>
      <span className="text-amber-400" title="Skimmed">
        {review.filesSkimmed ?? 0}k
      </span>
      <span className="text-slate-500">/</span>
      <span className="text-emerald-400" title="Deep reviewed">
        {review.filesDeepReviewed ?? 0}d
      </span>
    </span>
  );
}

export function Reviews() {
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["reviews", page],
    queryFn: () => api.getReviews(PAGE_SIZE, offset),
  });

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (isError) return <p className="text-red-400">Failed to load reviews.</p>;

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-100 mb-6">Reviews</h1>

      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Repository</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">PR</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Timestamp</th>
              <th className="text-right px-4 py-3 text-slate-400 font-medium">C / W / S</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Recommendation</th>
              <th
                className="text-center px-4 py-3 text-slate-400 font-medium"
                title="Triage: Skipped / Skimmed / Deep"
              >
                Triage
              </th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Model</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((review) => (
              <tr
                key={review.id}
                className="border-b border-slate-800 hover:bg-slate-800/60 transition-colors"
              >
                <td className="px-4 py-3 text-slate-200 font-medium">
                  {review.owner}/{review.repo}
                </td>
                <td className="px-4 py-3">
                  {review.prUrl ? (
                    <a
                      href={review.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      #{review.prNumber}
                    </a>
                  ) : (
                    <span className="text-slate-300">#{review.prNumber}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400">
                  {new Date(review.timestamp).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  <span className="text-red-400">{review.criticalCount}</span>
                  {" / "}
                  <span className="text-yellow-400">{review.warningCount}</span>
                  {" / "}
                  <span className="text-blue-400">{review.suggestionCount}</span>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`font-medium ${recommendationColor[review.recommendation] ?? "text-slate-300"}`}
                  >
                    {recommendationLabel[review.recommendation] ?? review.recommendation}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <TriageBadge review={review} />
                </td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{review.modelUsed}</td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  No reviews yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 0}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors"
          >
            ← Previous
          </button>
          <span className="text-sm text-slate-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 disabled:opacity-40 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
