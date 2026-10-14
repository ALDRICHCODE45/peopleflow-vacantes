import { describe, expect, it } from "vitest";
import {
  LOCAL_BOOTSTRAP_APPLY_PATH,
  LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS,
  LOCAL_BOOTSTRAP_STAGE_PATH,
  isTrustedOrigin,
  validateLocalBootstrapEnv,
} from "./config";
import { FIXTURE_BASE_URL, FIXTURE_KEY, FIXTURE_NEXTAUTH_SECRET, FIXTURE_SITE_URL } from "./fixtures";

function env(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: "test",
    NEXTAUTH_URL: FIXTURE_SITE_URL,
    NEXTAUTH_SECRET: FIXTURE_NEXTAUTH_SECRET,
    PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED: "true",
    PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL: FIXTURE_BASE_URL,
    PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY: FIXTURE_KEY,
    ...overrides,
  };
}

describe("validateLocalBootstrapEnv", () => {
  it("is disabled by default and when the flag is exactly false", () => {
    expect(validateLocalBootstrapEnv({ NODE_ENV: "test" })).toEqual({ status: "disabled" });
    expect(
      validateLocalBootstrapEnv(env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED: "false" })),
    ).toEqual({ status: "disabled" });
  });

  it.each(["", "yes", "TRUE", "1", "true "])(
    "fails closed on a non-boolean flag (%j)",
    (flag) => {
      expect(
        validateLocalBootstrapEnv(env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED: flag })),
      ).toEqual({ status: "invalid" });
    },
  );

  it("never enables the tool in production", () => {
    expect(validateLocalBootstrapEnv(env({ NODE_ENV: "production" }))).toEqual({
      status: "invalid",
    });
  });

  it("derives fixed stage/apply URLs from the literal loopback origin and the trusted frontend origin", () => {
    const result = validateLocalBootstrapEnv(env());
    expect(result.status).toBe("enabled");
    if (result.status !== "enabled") throw new Error("unreachable");
    expect(result.config.baseUrl).toBe(FIXTURE_BASE_URL);
    expect(result.config.stageUrl).toBe(`${FIXTURE_BASE_URL}${LOCAL_BOOTSTRAP_STAGE_PATH}`);
    expect(result.config.applyUrl).toBe(`${FIXTURE_BASE_URL}${LOCAL_BOOTSTRAP_APPLY_PATH}`);
    expect(result.config.trustedOrigin).toBe(FIXTURE_SITE_URL);
    expect(result.config.key).toBe(FIXTURE_KEY);
    expect(result.config.timeoutMs).toBe(LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS);
  });

  it.each([
    "http://localhost:8081",
    "http://127.0.0.1",
    "http://127.0.0.1:0",
    "http://127.0.0.1:70000",
    "https://127.0.0.1:8081",
    "http://example.com:8081",
    "http://10.0.0.5:8081",
    "http://[::1]:8081",
    "http://user:pass@127.0.0.1:8081",
    "http://127.0.0.1:8081/api",
    "http://127.0.0.1:8081/?x=1",
    "http://127.0.0.1:8081/#frag",
  ])("rejects a base URL that is not a bare loopback http IP origin (%s)", (baseUrl) => {
    expect(
      validateLocalBootstrapEnv(env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL: baseUrl })),
    ).toEqual({ status: "invalid" });
  });

  it.each([
    "short-key",
    "fixture-local-bootstrap-key-32 whitespace",
    "fixture-local-bootstrap-key-32\tcontrol",
    "fixture-local-bootstrap-key-32\ncontrol",
    "",
  ])("rejects a key that is too short or carries whitespace/control bytes (%j)", (key) => {
    expect(
      validateLocalBootstrapEnv(env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY: key })),
    ).toEqual({ status: "invalid" });
  });

  it("accepts any key of at least 32 bytes without whitespace or control characters", () => {
    const result = validateLocalBootstrapEnv(
      env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY: "A".repeat(32) }),
    );
    expect(result.status).toBe("enabled");
  });

  it.each([
    "https://app.example.com",
    "http://192.168.1.10:3000",
    "http://localhost:3000/path",
    "http://localhost:3000?x=1",
  ])("rejects a NEXTAUTH_URL that is not a trusted local frontend origin (%s)", (siteUrl) => {
    expect(validateLocalBootstrapEnv(env({ NEXTAUTH_URL: siteUrl }))).toEqual({
      status: "invalid",
    });
  });

  it("requires the bootstrap key, the trusted origin and a non-empty secret", () => {
    expect(
      validateLocalBootstrapEnv(env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY: undefined })),
    ).toEqual({ status: "invalid" });
    expect(validateLocalBootstrapEnv(env({ NEXTAUTH_URL: undefined }))).toEqual({
      status: "invalid",
    });
    expect(validateLocalBootstrapEnv(env({ NEXTAUTH_SECRET: undefined }))).toEqual({
      status: "invalid",
    });
  });

  it("never returns configuration details on a failure", () => {
    const missing = validateLocalBootstrapEnv(env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY: undefined }));
    expect(Object.keys(missing)).toEqual(["status"]);
    const rejected = validateLocalBootstrapEnv(
      env({ PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL: "http://127.0.0.1:8081/?leak=1" }),
    );
    expect(JSON.stringify(rejected)).not.toContain("leak");
  });
});

describe("isTrustedOrigin", () => {
  it("accepts only the literal canonical trusted origin a real browser sends", () => {
    expect(isTrustedOrigin("http://localhost:3000", "http://localhost:3000")).toBe(true);
    expect(isTrustedOrigin("http://127.0.0.1:3000", "http://127.0.0.1:3000")).toBe(true);
  });

  it.each([
    "http://localhost:3000/",
    "http://user@localhost:3000",
    "http://user:pass@localhost:3000",
    "http://localhost:3000?x=1",
    "http://localhost:3000#f",
    "HTTP://LOCALHOST:3000",
    "http://localhost:03000",
    "https://localhost:3000",
    "http://localhost",
    "http://localhost:3001",
    "null",
    "",
  ])("rejects %j instead of quietly normalizing it", (origin) => {
    expect(isTrustedOrigin(origin, "http://localhost:3000")).toBe(false);
  });

  it("rejects a missing origin header", () => {
    expect(isTrustedOrigin(null, "http://localhost:3000")).toBe(false);
  });
});
