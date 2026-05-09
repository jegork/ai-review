import { describe, expect, it, vi, beforeEach } from "vitest";

const setGlobalDispatcherMock = vi.fn();
const agentCtorSpy = vi.fn();

vi.mock("undici", () => {
  class FakeAgent {
    readonly __mock = true;
    constructor(opts: unknown) {
      agentCtorSpy(opts);
    }
  }
  return {
    setGlobalDispatcher: setGlobalDispatcherMock,
    Agent: FakeAgent,
  };
});

describe("configureGlobalHttp", () => {
  beforeEach(() => {
    setGlobalDispatcherMock.mockReset();
    agentCtorSpy.mockReset();
    delete process.env.RUSTY_LLM_HEADERS_TIMEOUT_MS;
    delete process.env.RUSTY_LLM_BODY_TIMEOUT_MS;
    vi.resetModules();
  });

  it("uses 600000ms defaults when env vars are unset", async () => {
    const { configureGlobalHttp } = await import("../http-config.js");
    configureGlobalHttp();

    expect(agentCtorSpy).toHaveBeenCalledTimes(1);
    expect(agentCtorSpy).toHaveBeenCalledWith({
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
    });
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(1);
  });

  it("honors RUSTY_LLM_HEADERS_TIMEOUT_MS and RUSTY_LLM_BODY_TIMEOUT_MS when set", async () => {
    process.env.RUSTY_LLM_HEADERS_TIMEOUT_MS = "900000";
    process.env.RUSTY_LLM_BODY_TIMEOUT_MS = "1200000";
    const { configureGlobalHttp } = await import("../http-config.js");
    configureGlobalHttp();

    expect(agentCtorSpy).toHaveBeenCalledWith({
      headersTimeout: 900_000,
      bodyTimeout: 1_200_000,
    });
  });

  it("falls back to defaults when env values are non-numeric", async () => {
    process.env.RUSTY_LLM_HEADERS_TIMEOUT_MS = "abc";
    process.env.RUSTY_LLM_BODY_TIMEOUT_MS = "";
    const { configureGlobalHttp } = await import("../http-config.js");
    configureGlobalHttp();

    expect(agentCtorSpy).toHaveBeenCalledWith({
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
    });
  });

  it("falls back to defaults when env values are zero or negative", async () => {
    process.env.RUSTY_LLM_HEADERS_TIMEOUT_MS = "0";
    process.env.RUSTY_LLM_BODY_TIMEOUT_MS = "-5000";
    const { configureGlobalHttp } = await import("../http-config.js");
    configureGlobalHttp();

    expect(agentCtorSpy).toHaveBeenCalledWith({
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
    });
  });

  it("floors fractional millisecond values", async () => {
    process.env.RUSTY_LLM_HEADERS_TIMEOUT_MS = "750000.9";
    const { configureGlobalHttp } = await import("../http-config.js");
    configureGlobalHttp();

    expect(agentCtorSpy).toHaveBeenCalledWith({
      headersTimeout: 750_000,
      bodyTimeout: 600_000,
    });
  });

  it("is idempotent — second call is a no-op", async () => {
    const { configureGlobalHttp } = await import("../http-config.js");
    configureGlobalHttp();
    configureGlobalHttp();
    configureGlobalHttp();

    expect(agentCtorSpy).toHaveBeenCalledTimes(1);
    expect(setGlobalDispatcherMock).toHaveBeenCalledTimes(1);
  });
});
