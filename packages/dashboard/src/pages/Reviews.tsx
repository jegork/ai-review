import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

const PAGE_SIZE = 20;

const recommendationColor: Record<string, string> = {
  approve: "text-green-400",
  "request-changes": "text-red-400",
  comment: "text-yellow-400",
};

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
              <th className="text-right px-4 py-3 text-slate-400 font-medium">Findings</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Recommendation</th>
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
                <td className="px-4 py-3 text-slate-300">#{review.prNumber}</td>
                <td className="px-4 py-3 text-slate-400">
                  {new Date(review.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {review.findings.length}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`font-medium ${recommendationColor[review.recommendation] ?? "text-slate-300"}`}
                  >
                    {review.recommendation}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 font-mono text-xs">{review.model}</td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
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
