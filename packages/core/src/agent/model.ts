import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { DefaultAzureCredential } from "@azure/identity";

export type ModelConfig =
  | { type: "router"; model: string }
  | { type: "azure-api-key"; resourceName: string; deploymentName: string; apiKey: string }
  | { type: "azure-managed-identity"; resourceName: string; deploymentName: string }
  | { type: "azure-foundry-api-key"; resourceName: string; deploymentName: string; apiKey: string }
  | { type: "azure-foundry-managed-identity"; resourceName: string; deploymentName: string }
  | { type: "azure-anthropic-api-key"; baseUrl: string; deploymentName: string; apiKey: string }
  | { type: "azure-anthropic-managed-identity"; baseUrl: string; deploymentName: string }
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

  // non-OpenAI models on Azure AI Foundry (Kimi, Llama, Mistral, etc.) — they
  // share the AOAI endpoint shape but only support /chat/completions, not the
  // newer /responses API that azure(deployment) defaults to.
  if (model.startsWith("azure-foundry/") && azureApiKey && process.env.AZURE_OPENAI_RESOURCE_NAME) {
    return {
      type: "azure-foundry-api-key",
      resourceName: process.env.AZURE_OPENAI_RESOURCE_NAME,
      deploymentName: model.replace("azure-foundry/", ""),
      apiKey: azureApiKey,
    };
  }

  if (process.env.RUSTY_AZURE_FOUNDRY_RESOURCE_NAME && process.env.RUSTY_AZURE_FOUNDRY_DEPLOYMENT) {
    return {
      type: "azure-foundry-managed-identity",
      resourceName: process.env.RUSTY_AZURE_FOUNDRY_RESOURCE_NAME,
      deploymentName: process.env.RUSTY_AZURE_FOUNDRY_DEPLOYMENT,
    };
  }

  // anthropic on azure ai foundry (api key mode)
  // accepts both AZURE_ANTHROPIC_API_KEY and RUSTY_AZURE_ANTHROPIC_API_KEY
  const azureAnthropicBaseUrl = process.env.RUSTY_AZURE_ANTHROPIC_BASE_URL;
  const azureAnthropicApiKey =
    process.env.RUSTY_AZURE_ANTHROPIC_API_KEY ?? process.env.AZURE_ANTHROPIC_API_KEY;
  if (model.startsWith("azure-anthropic/") && azureAnthropicBaseUrl && azureAnthropicApiKey) {
    return {
      type: "azure-anthropic-api-key",
      baseUrl: azureAnthropicBaseUrl,
      deploymentName: model.replace("azure-anthropic/", ""),
      apiKey: azureAnthropicApiKey,
    };
  }

  // anthropic on azure ai foundry (managed identity / entra id mode)
  if (azureAnthropicBaseUrl && process.env.RUSTY_AZURE_ANTHROPIC_DEPLOYMENT) {
    return {
      type: "azure-anthropic-managed-identity",
      baseUrl: azureAnthropicBaseUrl,
      deploymentName: process.env.RUSTY_AZURE_ANTHROPIC_DEPLOYMENT,
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

interface FoundryBodyOptions {
  disableThinking?: boolean;
}

// Moonshot/Kimi expose two ways to disable the reasoning trace:
//   1. Their direct API takes a top-level `thinking: { type: "disabled" }`
//   2. vLLM- and SGLang-based deployments (which is what Azure Foundry's MaaS
//      runs for Kimi K2.x) take `chat_template_kwargs: { thinking: false }`
// Foundry's strict OpenAI-compatible allowlist rejects unknown top-level
// fields with `unrecognized_request_argument`, so we have to use the
// chat_template_kwargs form. We merge into any caller-provided value so we
// don't clobber other template kwargs the user might set later.
export function mutateBodyForFoundry(
  init: Record<string, unknown> | undefined,
  opts: FoundryBodyOptions,
): void {
  if (!init || typeof init.body !== "string") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const body = parsed as Record<string, unknown>;
  if (opts.disableThinking) {
    const existing =
      typeof body.chat_template_kwargs === "object" &&
      body.chat_template_kwargs !== null &&
      !Array.isArray(body.chat_template_kwargs)
        ? (body.chat_template_kwargs as Record<string, unknown>)
        : {};
    body.chat_template_kwargs = { ...existing, thinking: false };
  }
  init.body = JSON.stringify(body);
}

function makeFoundryFetch(opts: FoundryBodyOptions): typeof globalThis.fetch {
  return (async (input: unknown, init?: Record<string, unknown>) => {
    const next = { ...init };
    mutateBodyForFoundry(next, opts);
    return globalThis.fetch(input as Parameters<typeof fetch>[0], next);
  }) as typeof globalThis.fetch;
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
        return globalThis.fetch(input as Parameters<typeof fetch>[0], { ...init, headers });
      }) as typeof globalThis.fetch;

      const azure = createAzure({
        resourceName: config.resourceName,
        fetch: azureFetch,
      });
      return azure(config.deploymentName);
    }

    case "azure-foundry-api-key": {
      const disableThinking = resolveDisableThinking(config);
      const azure = createAzure({
        resourceName: config.resourceName,
        apiKey: config.apiKey,
        ...(disableThinking && { fetch: makeFoundryFetch({ disableThinking: true }) }),
      });
      // .chat() routes to /v1/chat/completions; the default azure() picks
      // /v1/responses, which non-OpenAI Foundry models reject
      return azure.chat(config.deploymentName);
    }

    case "azure-foundry-managed-identity": {
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";
      const disableThinking = resolveDisableThinking(config);

      const azureFetch = (async (input: unknown, init?: Record<string, unknown>) => {
        const token = await credential.getToken(scope);
        const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
        headers.set("Authorization", `Bearer ${token.token}`);
        const next = { ...init, headers };
        if (disableThinking) mutateBodyForFoundry(next, { disableThinking: true });
        return globalThis.fetch(input as Parameters<typeof fetch>[0], next);
      }) as typeof globalThis.fetch;

      const azure = createAzure({
        resourceName: config.resourceName,
        fetch: azureFetch,
      });
      return azure.chat(config.deploymentName);
    }

    case "azure-anthropic-api-key": {
      const anthropic = createAnthropic({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
      });
      return anthropic(config.deploymentName);
    }

    case "azure-anthropic-managed-identity": {
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";

      const anthropicFetch = (async (input: unknown, init?: Record<string, unknown>) => {
        const token = await credential.getToken(scope);
        const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
        headers.delete("x-api-key");
        headers.set("Authorization", `Bearer ${token.token}`);
        return globalThis.fetch(input as Parameters<typeof fetch>[0], { ...init, headers });
      }) as typeof globalThis.fetch;

      const anthropic = createAnthropic({
        baseURL: config.baseUrl,
        // createAnthropic requires apiKey or authToken; the fetch wrapper
        // overrides Authorization with a fresh entra token per request.
        authToken: "managed-identity",
        fetch: anthropicFetch,
      });
      return anthropic(config.deploymentName);
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
  if (
    config.type === "azure-anthropic-api-key" ||
    config.type === "azure-anthropic-managed-identity"
  ) {
    return true;
  }
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
    case "azure-anthropic-api-key":
    case "azure-anthropic-managed-identity":
      return true;
    case "azure-foundry-api-key":
    case "azure-foundry-managed-identity":
      // Foundry chat completions for non-OpenAI models (Kimi, Llama, etc.)
      // varies by deployment; default to prompt-injected JSON to be safe
      return false;
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
    case "azure-foundry-api-key":
    case "azure-foundry-managed-identity":
      return `azure-foundry/${config.deploymentName}`;
    case "azure-anthropic-api-key":
    case "azure-anthropic-managed-identity":
      return `azure-anthropic/${config.deploymentName}`;
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

/**
 * Whether the deployment should have its thinking/reasoning trace disabled at
 * request time. Currently only takes effect on azure-foundry/* deployments —
 * other paths have no Foundry-style `thinking` knob to flip. Matches the
 * model display name against `RUSTY_LLM_DISABLE_THINKING` (CSV with trailing-*
 * wildcards), same pattern as `RUSTY_LLM_JSON_PROMPT_INJECTION`.
 */
export function resolveDisableThinking(config: ModelConfig): boolean {
  if (config.type !== "azure-foundry-api-key" && config.type !== "azure-foundry-managed-identity") {
    return false;
  }
  const patterns = readCsvEnv("RUSTY_LLM_DISABLE_THINKING");
  if (patterns.length === 0) return false;
  return matchesAny(modelMatchKey(config), patterns);
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
    case "azure-foundry-api-key":
      return `azure-foundry/${config.deploymentName}`;
    case "azure-foundry-managed-identity":
      return `azure-foundry/${config.deploymentName}`;
    case "azure-anthropic-api-key":
      return `azure-anthropic/${config.deploymentName}`;
    case "azure-anthropic-managed-identity":
      return `azure-anthropic/${config.deploymentName}`;
    case "openai-compatible":
      return `${config.baseUrl}/${config.model}`;
  }
}
