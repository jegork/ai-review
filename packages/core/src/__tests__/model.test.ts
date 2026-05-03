import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveModelConfig,
  resolveTriageModelConfig,
  resolveModelConfigWithOverride,
  resolveReviewPassModelConfigs,
  getModelDisplayName,
  resolveDefaultAgentOptions,
  supportsAnthropicCacheControl,
  applyModelConstraints,
} from "../agent/model.js";

function clearEnv() {
  delete process.env.RUSTY_LLM_MODEL;
  delete process.env.RUSTY_LLM_TRIAGE_MODEL;
  delete process.env.RUSTY_REVIEW_MODELS;
  delete process.env.RUSTY_REVIEW_TEMPERATURES;
  delete process.env.RUSTY_REVIEW_TOP_PS;
  delete process.env.RUSTY_REVIEW_TEMPERATURE;
  delete process.env.RUSTY_REVIEW_TOP_P;
  delete process.env.RUSTY_LLM_TEMPERATURE;
  delete process.env.RUSTY_LLM_TOP_P;
  delete process.env.AZURE_API_KEY;
  delete process.env.AZURE_OPENAI_API_KEY;
  delete process.env.AZURE_OPENAI_RESOURCE_NAME;
  delete process.env.RUSTY_AZURE_RESOURCE_NAME;
  delete process.env.RUSTY_AZURE_DEPLOYMENT;
  delete process.env.RUSTY_LLM_BASE_URL;
  delete process.env.RUSTY_LLM_API_KEY;
  delete process.env.REQUESTY_API_KEY;
  delete process.env.RUSTY_PROMPT_CACHE;
}

describe("resolveModelConfig", () => {
  beforeEach(clearEnv);

  it("falls back to router with the default model when nothing is set", () => {
    const config = resolveModelConfig();
    expect(config.type).toBe("router");
    if (config.type === "router") {
      expect(config.model).toMatch(/anthropic\//);
    }
  });

  it("returns router config for arbitrary provider strings", () => {
    process.env.RUSTY_LLM_MODEL = "anthropic/claude-haiku";
    const config = resolveModelConfig();
    expect(config).toEqual({ type: "router", model: "anthropic/claude-haiku" });
  });

  it("builds azure-api-key config when azure-openai prefix + api key + resource name are present", () => {
    process.env.RUSTY_LLM_MODEL = "azure-openai/gpt-5.4-mini";
    process.env.AZURE_API_KEY = "secret";
    process.env.AZURE_OPENAI_RESOURCE_NAME = "my-resource";

    const config = resolveModelConfig();
    expect(config.type).toBe("azure-api-key");
    if (config.type === "azure-api-key") {
      expect(config.deploymentName).toBe("gpt-5.4-mini");
      expect(config.resourceName).toBe("my-resource");
      expect(config.apiKey).toBe("secret");
    }
  });

  it("accepts AZURE_OPENAI_API_KEY as an alternative to AZURE_API_KEY", () => {
    process.env.RUSTY_LLM_MODEL = "azure-openai/gpt-5.4-mini";
    process.env.AZURE_OPENAI_API_KEY = "other-secret";
    process.env.AZURE_OPENAI_RESOURCE_NAME = "my-resource";

    const config = resolveModelConfig();
    expect(config.type).toBe("azure-api-key");
    if (config.type === "azure-api-key") {
      expect(config.apiKey).toBe("other-secret");
    }
  });

  it("falls through to router when azure-openai prefix is set but resource name is missing", () => {
    process.env.RUSTY_LLM_MODEL = "azure-openai/gpt-5.4-mini";
    process.env.AZURE_API_KEY = "secret";
    // no AZURE_OPENAI_RESOURCE_NAME

    const config = resolveModelConfig();
    expect(config.type).toBe("router");
  });

  it("leaves requesty/ models on the native mastra router", () => {
    process.env.RUSTY_LLM_MODEL = "requesty/anthropic/claude-sonnet-4";

    const config = resolveModelConfig();
    expect(config).toEqual({ type: "router", model: "requesty/anthropic/claude-sonnet-4" });
  });
});

describe("resolveReviewPassModelConfigs", () => {
  beforeEach(clearEnv);

  it("uses the default review model for every pass when no per-pass models are set", () => {
    process.env.RUSTY_LLM_MODEL = "anthropic/claude-sonnet";

    const configs = resolveReviewPassModelConfigs(3);

    expect(configs.map((c) => c.displayName)).toEqual([
      "anthropic/claude-sonnet",
      "anthropic/claude-sonnet",
      "anthropic/claude-sonnet",
    ]);
  });

  it("resolves per-pass models and falls back to RUSTY_LLM_MODEL for missing entries", () => {
    process.env.RUSTY_LLM_MODEL = "anthropic/default";
    process.env.RUSTY_REVIEW_MODELS = "anthropic/pass-1, openai/pass-2";

    const configs = resolveReviewPassModelConfigs(3);

    expect(configs.map((c) => c.displayName)).toEqual([
      "anthropic/pass-1",
      "openai/pass-2",
      "anthropic/default",
    ]);
  });

  it("applies per-pass temperature and top-p overrides", () => {
    process.env.RUSTY_REVIEW_TEMPERATURE = "0.5";
    process.env.RUSTY_REVIEW_TOP_P = "0.8";
    process.env.RUSTY_REVIEW_TEMPERATURES = "0.1,0.2";
    process.env.RUSTY_REVIEW_TOP_PS = "0.9";

    const configs = resolveReviewPassModelConfigs(3);

    expect(configs.map((c) => c.settings)).toEqual([
      { temperature: 0.1, topP: 0.9 },
      { temperature: 0.2, topP: 0.8 },
      { temperature: 0.5, topP: 0.8 },
    ]);
  });

  it("forces temperature=1 for kimi-k2.5 even when the per-pass list says otherwise", () => {
    process.env.RUSTY_REVIEW_MODELS = "anthropic/claude-sonnet,requesty/moonshot/kimi-k2.5";
    process.env.RUSTY_REVIEW_TEMPERATURES = "0.2,0.2";

    const configs = resolveReviewPassModelConfigs(2);

    expect(configs[0].settings.temperature).toBe(0.2);
    expect(configs[1].settings.temperature).toBe(1);
  });
});

describe("applyModelConstraints", () => {
  beforeEach(clearEnv);

  it("forces temperature=1 for moonshot/kimi-k2.5 router models", () => {
    const settings = applyModelConstraints(
      { type: "router", model: "requesty/moonshot/kimi-k2.5" },
      { temperature: 0.2, topP: 0.9 },
    );
    expect(settings).toEqual({ temperature: 1, topP: 0.9 });
  });

  it("matches kimi-k2.5 even without a routing prefix", () => {
    const settings = applyModelConstraints(
      { type: "router", model: "moonshot/kimi-k2.5" },
      { temperature: 0.4 },
    );
    expect(settings.temperature).toBe(1);
  });

  it("leaves settings unchanged when temperature is already at the locked value", () => {
    const original = { temperature: 1, topP: 0.5 };
    const settings = applyModelConstraints(
      { type: "router", model: "requesty/moonshot/kimi-k2.5" },
      original,
    );
    expect(settings).toBe(original);
  });

  it("returns settings unchanged for unaffected models", () => {
    const original = { temperature: 0.2 };
    const settings = applyModelConstraints(
      { type: "router", model: "anthropic/claude-sonnet-4-6" },
      original,
    );
    expect(settings).toBe(original);
  });
});

describe("resolveDefaultAgentOptions", () => {
  beforeEach(clearEnv);

  it("returns auto_cache providerOptions for requesty/ router models", () => {
    const opts = resolveDefaultAgentOptions({
      type: "router",
      model: "requesty/anthropic/claude-sonnet-4",
    });
    expect(opts).toEqual({
      providerOptions: { requesty: { auto_cache: true } },
    });
  });

  it("returns undefined for non-requesty router models", () => {
    expect(
      resolveDefaultAgentOptions({ type: "router", model: "anthropic/claude-sonnet" }),
    ).toBeUndefined();
  });

  it("returns undefined for non-router configs", () => {
    expect(
      resolveDefaultAgentOptions({
        type: "azure-api-key",
        resourceName: "r",
        deploymentName: "d",
        apiKey: "k",
      }),
    ).toBeUndefined();
    expect(
      resolveDefaultAgentOptions({
        type: "openai-compatible",
        baseUrl: "https://litellm.example.com/v1",
        model: "anything",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when RUSTY_PROMPT_CACHE=false even for requesty/ models", () => {
    process.env.RUSTY_PROMPT_CACHE = "false";
    expect(
      resolveDefaultAgentOptions({
        type: "router",
        model: "requesty/anthropic/claude-sonnet-4",
      }),
    ).toBeUndefined();
  });
});

describe("supportsAnthropicCacheControl", () => {
  it("returns true for direct anthropic router models", () => {
    expect(
      supportsAnthropicCacheControl({
        type: "router",
        model: "anthropic/claude-sonnet-4",
      }),
    ).toBe(true);
  });

  it("returns true for requesty-routed anthropic models", () => {
    expect(
      supportsAnthropicCacheControl({
        type: "router",
        model: "requesty/anthropic/claude-sonnet-4",
      }),
    ).toBe(true);
  });

  it("returns true when anthropic appears later in a router model string", () => {
    expect(
      supportsAnthropicCacheControl({
        type: "router",
        model: "gateway/vendor/anthropic/claude-sonnet-4",
      }),
    ).toBe(true);
  });

  it("returns false for other requesty-routed providers", () => {
    expect(
      supportsAnthropicCacheControl({
        type: "router",
        model: "requesty/openai/gpt-5",
      }),
    ).toBe(false);
  });

  it("returns false for non-router configs", () => {
    expect(
      supportsAnthropicCacheControl({
        type: "openai-compatible",
        baseUrl: "https://example.com/v1",
        model: "anthropic/claude-sonnet-4",
      }),
    ).toBe(false);
  });
});

describe("getModelDisplayName", () => {
  it("returns azure/<deployment> for azure-api-key configs", () => {
    const name = getModelDisplayName({
      type: "azure-api-key",
      resourceName: "my-resource",
      deploymentName: "gpt-5.4-mini",
      apiKey: "secret",
    });
    expect(name).toBe("azure/gpt-5.4-mini");
  });

  it("returns the raw model string for router configs", () => {
    const name = getModelDisplayName({ type: "router", model: "azure-openai/gpt-5.4-mini" });
    expect(name).toBe("azure-openai/gpt-5.4-mini");
  });
});

describe("resolveTriageModelConfig", () => {
  beforeEach(clearEnv);

  it("returns null when no triage model is configured", () => {
    expect(resolveTriageModelConfig()).toBeNull();
  });

  it("resolves the triage override through the azure-api-key branch when env is set", () => {
    process.env.RUSTY_LLM_TRIAGE_MODEL = "azure-openai/gpt-5.4-mini";
    process.env.AZURE_API_KEY = "secret";
    process.env.AZURE_OPENAI_RESOURCE_NAME = "my-resource";
    process.env.RUSTY_LLM_MODEL = "anthropic/claude-sonnet";

    const config = resolveTriageModelConfig();
    expect(config?.type).toBe("azure-api-key");
    if (config?.type === "azure-api-key") {
      expect(config.deploymentName).toBe("gpt-5.4-mini");
    }
  });

  it("restores the original RUSTY_LLM_MODEL after resolving", () => {
    process.env.RUSTY_LLM_TRIAGE_MODEL = "azure-openai/gpt-5.4-mini";
    process.env.AZURE_API_KEY = "secret";
    process.env.AZURE_OPENAI_RESOURCE_NAME = "my-resource";
    process.env.RUSTY_LLM_MODEL = "anthropic/claude-sonnet";

    resolveTriageModelConfig();

    expect(process.env.RUSTY_LLM_MODEL).toBe("anthropic/claude-sonnet");
  });

  it("leaves RUSTY_LLM_MODEL unset when it was unset before", () => {
    process.env.RUSTY_LLM_TRIAGE_MODEL = "anthropic/claude-haiku";
    expect(process.env.RUSTY_LLM_MODEL).toBeUndefined();

    resolveTriageModelConfig();

    expect(process.env.RUSTY_LLM_MODEL).toBeUndefined();
  });
});

describe("resolveModelConfigWithOverride", () => {
  beforeEach(clearEnv);

  it("resolves an azure-openai override through the azure-api-key branch", () => {
    process.env.AZURE_API_KEY = "secret";
    process.env.AZURE_OPENAI_RESOURCE_NAME = "my-resource";
    process.env.RUSTY_LLM_MODEL = "anthropic/claude-sonnet";

    const config = resolveModelConfigWithOverride("azure-openai/gpt-5.4-mini");
    expect(config.type).toBe("azure-api-key");
    if (config.type === "azure-api-key") {
      expect(config.deploymentName).toBe("gpt-5.4-mini");
      expect(config.resourceName).toBe("my-resource");
    }
  });

  it("returns a router config for a plain router-style override", () => {
    const config = resolveModelConfigWithOverride("anthropic/claude-haiku");
    expect(config).toEqual({ type: "router", model: "anthropic/claude-haiku" });
  });

  it("routes through openai-compatible when RUSTY_LLM_BASE_URL is set", () => {
    process.env.RUSTY_LLM_BASE_URL = "https://litellm.example/v1";
    process.env.RUSTY_LLM_API_KEY = "k";

    const config = resolveModelConfigWithOverride("custom/model");
    expect(config).toEqual({
      type: "openai-compatible",
      baseUrl: "https://litellm.example/v1",
      model: "custom/model",
      apiKey: "k",
    });
  });

  it("restores the original RUSTY_LLM_MODEL after resolving", () => {
    process.env.RUSTY_LLM_MODEL = "anthropic/claude-sonnet";

    resolveModelConfigWithOverride("anthropic/claude-haiku");

    expect(process.env.RUSTY_LLM_MODEL).toBe("anthropic/claude-sonnet");
  });

  it("leaves RUSTY_LLM_MODEL unset when it was unset before", () => {
    expect(process.env.RUSTY_LLM_MODEL).toBeUndefined();

    resolveModelConfigWithOverride("anthropic/claude-haiku");

    expect(process.env.RUSTY_LLM_MODEL).toBeUndefined();
  });

  it("restores RUSTY_LLM_MODEL when resolveModelConfig throws", () => {
    process.env.RUSTY_LLM_MODEL = "anthropic/claude-sonnet";

    // process.env rejects accessor descriptors, so wrap it in a Proxy that
    // throws on AZURE_API_KEY reads — resolveModelConfig hits that read
    // once the model string starts with "azure-openai/"
    const realEnv = process.env;
    const throwingEnv = new Proxy(realEnv, {
      get(target, prop) {
        if (prop === "AZURE_API_KEY") throw new Error("simulated env failure");
        return Reflect.get(target, prop);
      },
      // delegate set/delete directly to target so process.env's string-coercion
      // path runs on the real env, not on the Proxy wrapper
      set(target, prop, value) {
        (target as Record<string, string>)[prop as string] = value;
        return true;
      },
      deleteProperty(target, prop) {
        return Reflect.deleteProperty(target, prop);
      },
    });
    Object.defineProperty(process, "env", { value: throwingEnv, configurable: true });

    try {
      expect(() => resolveModelConfigWithOverride("azure-openai/gpt-5.4-mini")).toThrow(
        "simulated env failure",
      );
    } finally {
      Object.defineProperty(process, "env", { value: realEnv, configurable: true });
    }

    expect(process.env.RUSTY_LLM_MODEL).toBe("anthropic/claude-sonnet");
  });
});
