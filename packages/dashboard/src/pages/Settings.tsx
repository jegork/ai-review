import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Settings } from "../api";

function MaskedInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="px-3 py-2 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 border border-slate-700 rounded transition-colors"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export function Settings() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  });

  const [llmModel, setLlmModel] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [linearToken, setLinearToken] = useState("");
  const [adoToken, setAdoToken] = useState("");

  useEffect(() => {
    if (data) {
      setLlmModel(data.llmModel ?? "");
      setJiraToken(data.jiraToken ?? "");
      setLinearToken(data.linearToken ?? "");
      setAdoToken(data.adoToken ?? "");
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => api.updateSettings({ llmModel, jiraToken, linearToken, adoToken }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  if (isLoading) return <p className="text-slate-400">Loading…</p>;
  if (isError) return <p className="text-red-400">Failed to load settings.</p>;

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-slate-100 mb-6">Settings</h1>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">LLM Model</label>
          <input
            type="text"
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            placeholder="e.g. claude-opus-4-5"
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-400"
          />
        </div>

        <div className="pt-2 border-t border-slate-700">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-4">
            Integrations
          </h2>
          <div className="space-y-4">
            <MaskedInput
              label="Jira API Token"
              value={jiraToken}
              onChange={setJiraToken}
              placeholder="••••••••"
            />
            <MaskedInput
              label="Linear API Key"
              value={linearToken}
              onChange={setLinearToken}
              placeholder="lin_api_••••••••"
            />
            <MaskedInput
              label="Azure DevOps PAT"
              value={adoToken}
              onChange={setAdoToken}
              placeholder="••••••••"
            />
          </div>
        </div>
      </div>

      {mutation.isSuccess && <p className="text-green-400 text-sm mt-4">Saved successfully.</p>}
      {mutation.isError && <p className="text-red-400 text-sm mt-4">Failed to save settings.</p>}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="mt-6 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold text-sm rounded-md transition-colors"
      >
        {mutation.isPending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
