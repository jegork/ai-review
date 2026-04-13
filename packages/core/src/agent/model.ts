import { createAzure } from "@ai-sdk/azure";
import { DefaultAzureCredential } from "@azure/identity";

export type ModelConfig =
  | { type: "router"; model: string }
  | { type: "azure-managed-identity"; resourceName: string; deploymentName: string }
  | { type: "openai-compatible"; baseUrl: string; model: string; apiKey?: string };

export function resolveModelConfig(): ModelConfig {
  if (process.env.RUSTY_AZURE_RESOURCE_NAME && process.env.RUSTY_AZURE_DEPLOYMENT) {
    return {
      type: "azure-managed-identity",
      resourceName: process.env.RUSTY_AZURE_RESOURCE_NAME,
      deploymentName: process.env.RUSTY_AZURE_DEPLOYMENT,
    };
  }

  if (process.env.RUSTY_LLM_BASE_URL) {
    return {
      type: "openai-compatible",
      baseUrl: process.env.RUSTY_LLM_BASE_URL,
      model: process.env.RUSTY_LLM_MODEL ?? "default",
      apiKey: process.env.RUSTY_LLM_API_KEY,
    };
  }

  return {
    type: "router",
    model: process.env.RUSTY_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514",
  };
}

// returns either a model router string or a provider model instance
export function resolveModel(
  config: ModelConfig,
): string | ReturnType<ReturnType<typeof createAzure>> {
  switch (config.type) {
    case "router":
      return config.model;

    case "azure-managed-identity": {
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";

      // inject bearer token via custom fetch
      // inject managed identity token into every request
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

export function getModelDisplayName(config: ModelConfig): string {
  switch (config.type) {
    case "router":
      return config.model;
    case "azure-managed-identity":
      return `azure/${config.deploymentName}`;
    case "openai-compatible":
      return `${config.baseUrl}/${config.model}`;
  }
}
