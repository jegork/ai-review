import { createAzure } from "@ai-sdk/azure";
import { DefaultAzureCredential } from "@azure/identity";

export type ModelConfig =
  | { type: "router"; model: string }
  | { type: "azure-api-key"; resourceName: string; deploymentName: string; apiKey: string }
  | { type: "azure-managed-identity"; resourceName: string; deploymentName: string }
  | { type: "openai-compatible"; baseUrl: string; model: string; apiKey?: string };

export function resolveModelConfig(): ModelConfig {
  const model = process.env.RUSTY_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514";

  // azure-openai/deployment-name with API key
  // accepts both AZURE_API_KEY (mastra convention) and AZURE_OPENAI_API_KEY
  const azureApiKey = process.env.AZURE_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  if (model.startsWith("azure-openai/") && azureApiKey && process.env.AZURE_OPENAI_RESOURCE_NAME) {
    return {
      type: "azure-api-key",
      resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME,
      deploymentName: model.replace("azure-openai/", ""),
      apiKey: azureApiKey,
    };
  }

  // azure with managed identity (no API key)
  if (process.env.RUSTY_AZURE_RESOURCE_NAME && process.env.RUSTY_AZURE_DEPLOYMENT) {
    return {
      type: "azure-managed-identity",
      resourceName: process.env.RUSTY_AZURE_RESOURCE_NAME,
      deploymentName: process.env.RUSTY_AZURE_DEPLOYMENT,
    };
  }

  // custom openai-compatible endpoint (e.g. litellm)
  if (process.env.RUSTY_LLM_BASE_URL) {
    return {
      type: "openai-compatible",
      baseUrl: process.env.RUSTY_LLM_BASE_URL,
      model,
      apiKey: process.env.RUSTY_LLM_API_KEY,
    };
  }

  return { type: "router", model };
}

/**
 * resolve a ModelConfig for a specific model string, as if RUSTY_LLM_MODEL
 * were set to it — so azure-openai/ prefix handling, openai-compatible
 * endpoints, etc. all apply consistently across per-agent overrides.
 */
export function resolveModelConfigWithOverride(overrideModel: string): ModelConfig {
  const saved = process.env.RUSTY_LLM_MODEL;
  process.env.RUSTY_LLM_MODEL = overrideModel;
  try {
    return resolveModelConfig();
  } finally {
    if (saved !== undefined) {
      process.env.RUSTY_LLM_MODEL = saved;
    } else {
      delete process.env.RUSTY_LLM_MODEL;
    }
  }
}

export function resolveTriageModelConfig(): ModelConfig | null {
  const triageModel = process.env.RUSTY_LLM_TRIAGE_MODEL;
  if (!triageModel) return null;
  return resolveModelConfigWithOverride(triageModel);
}

export function resolveModel(
  config: ModelConfig,
): string | ReturnType<ReturnType<typeof createAzure>> {
  switch (config.type) {
    case "router":
      return config.model;

    case "azure-api-key": {
      const azure = createAzure({
        resourceName: config.resourceName,
        apiKey: config.apiKey,
      });
      return azure(config.deploymentName);
    }

    case "azure-managed-identity": {
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";

      const azureFetch = (async (input: unknown, init?: Record<string, unknown>) => {
        const token = await credential.getToken(scope);
        const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
        headers.set("Authorization", `Bearer ${token.token}`);
        return globalThis.fetch(
          input as Parameters<typeof fetch>[0],
          { ...init, headers } as RequestInit,
        );
      }) as typeof globalThis.fetch;

      const azure = createAzure({
        resourceName: config.resourceName,
        fetch: azureFetch,
      });
      return azure(config.deploymentName);
    }

    case "openai-compatible":
      return config.model;
  }
}

export interface ModelSettings {
  temperature?: number;
  topP?: number;
}

type AgentKind = "review" | "triage" | "judge" | "description";

const AGENT_ENV_PREFIX: Record<AgentKind, string> = {
  review: "RUSTY_REVIEW",
  triage: "RUSTY_TRIAGE",
  judge: "RUSTY_JUDGE",
  description: "RUSTY_DESCRIPTION",
};

function readNumericEnv(
  agentKind: AgentKind,
  suffix: string,
  globalKey: string,
): number | undefined {
  const raw = process.env[`${AGENT_ENV_PREFIX[agentKind]}_${suffix}`] ?? process.env[globalKey];
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isNaN(n) ? undefined : n;
}

/** per-agent settings with global fallback: e.g. RUSTY_JUDGE_TEMPERATURE → RUSTY_LLM_TEMPERATURE */
export function resolveModelSettings(agentKind: AgentKind = "review"): ModelSettings {
  const settings: ModelSettings = {};

  const temp = readNumericEnv(agentKind, "TEMPERATURE", "RUSTY_LLM_TEMPERATURE");
  if (temp !== undefined) settings.temperature = temp;

  const topP = readNumericEnv(agentKind, "TOP_P", "RUSTY_LLM_TOP_P");
  if (topP !== undefined) settings.topP = topP;

  return settings;
}

export function getModelDisplayName(config: ModelConfig): string {
  switch (config.type) {
    case "router":
      return config.model;
    case "azure-api-key":
      return `azure/${config.deploymentName}`;
    case "azure-managed-identity":
      return `azure/${config.deploymentName}`;
    case "openai-compatible":
      return `${config.baseUrl}/${config.model}`;
  }
}
