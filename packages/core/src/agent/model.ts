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

export function resolveDefaultAgentOptions(
  config: ModelConfig,
): { providerOptions: { requesty: { auto_cache: true } } } | undefined {
  if (process.env.RUSTY_PROMPT_CACHE === "false") return undefined;
  if (config.type !== "router") return undefined;
  if (!config.model.startsWith("requesty/")) return undefined;
  return { providerOptions: { requesty: { auto_cache: true } } };
}

export function supportsAnthropicCacheControl(config: ModelConfig): boolean {
  if (config.type !== "router") return false;
  return config.model.includes("anthropic/");
}

const NATIVE_STRUCTURED_OUTPUT_ROUTER_PREFIXES = [
  "openai/",
  "anthropic/",
  "google/",
  "azure-openai/",
  "requesty/openai/",
  "requesty/anthropic/",
  "requesty/google/",
  "requesty/moonshot/",
  "requesty/fireworks/",
];

export function supportsNativeStructuredOutput(config: ModelConfig): boolean {
  switch (config.type) {
    case "azure-api-key":
    case "azure-managed-identity":
      return true;
    case "openai-compatible":
      return true;
    case "router":
      return NATIVE_STRUCTURED_OUTPUT_ROUTER_PREFIXES.some((prefix) =>
        config.model.startsWith(prefix),
      );
  }
}

function modelMatchKey(config: ModelConfig): string {
  switch (config.type) {
    case "router":
      return config.model;
    case "openai-compatible":
      return config.model;
    case "azure-api-key":
    case "azure-managed-identity":
      return `azure-openai/${config.deploymentName}`;
  }
}

function matchesAny(modelKey: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      if (modelKey.startsWith(prefix)) return true;
    } else if (modelKey === pattern) {
      return true;
    }
  }
  return false;
}

export function resolveJsonPromptInjection(config: ModelConfig): boolean {
  const key = modelMatchKey(config);

  const forceOn = readCsvEnv("RUSTY_LLM_JSON_PROMPT_INJECTION");
  if (forceOn.length > 0 && matchesAny(key, forceOn)) return true;

  const forceOff = readCsvEnv("RUSTY_LLM_NATIVE_STRUCTURED_OUTPUT");
  if (forceOff.length > 0 && matchesAny(key, forceOff)) return false;

  return !supportsNativeStructuredOutput(config);
}

export interface ModelSettings {
  temperature?: number;
  topP?: number;
}

type AgentKind = "review" | "triage" | "judge" | "description" | "title";

const AGENT_ENV_PREFIX: Record<AgentKind, string> = {
  review: "RUSTY_REVIEW",
  triage: "RUSTY_TRIAGE",
  judge: "RUSTY_JUDGE",
  description: "RUSTY_DESCRIPTION",
  title: "RUSTY_TITLE",
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

function readCsvEnv(key: string): string[] {
  return (
    process.env[key]
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

function readNumericCsvEnv(key: string): number[] {
  return readCsvEnv(key)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

export interface ReviewPassModelConfig {
  config: ModelConfig;
  settings: ModelSettings;
  displayName: string;
}

export function resolveReviewPassModelConfigs(passCount: number): ReviewPassModelConfig[] {
  const reviewModels = readCsvEnv("RUSTY_REVIEW_MODELS");
  const reviewTemperatures = readNumericCsvEnv("RUSTY_REVIEW_TEMPERATURES");
  const reviewTopPs = readNumericCsvEnv("RUSTY_REVIEW_TOP_PS");
  const defaultSettings = resolveModelSettings("review");

  return Array.from({ length: passCount }, (_, index) => {
    const model = reviewModels[index];
    const config = model ? resolveModelConfigWithOverride(model) : resolveModelConfig();
    const settings: ModelSettings = { ...defaultSettings };

    if (index < reviewTemperatures.length) {
      settings.temperature = reviewTemperatures[index];
    }
    if (index < reviewTopPs.length) {
      settings.topP = reviewTopPs[index];
    }

    return {
      config,
      settings: applyModelConstraints(config, settings),
      displayName: getModelDisplayName(config),
    };
  });
}

interface HardTemperatureLock {
  pattern: RegExp;
  temperature: number;
}

const HARD_TEMPERATURE_LOCKS: HardTemperatureLock[] = [
  { pattern: /moonshot\/kimi-k2\.5/i, temperature: 1 },
];

function findHardTemperatureLock(displayName: string): HardTemperatureLock | undefined {
  return HARD_TEMPERATURE_LOCKS.find((entry) => entry.pattern.test(displayName));
}

export function applyModelConstraints(config: ModelConfig, settings: ModelSettings): ModelSettings {
  const lock = findHardTemperatureLock(getModelDisplayName(config));
  if (!lock) return settings;
  if (settings.temperature === lock.temperature) return settings;
  return { ...settings, temperature: lock.temperature };
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
