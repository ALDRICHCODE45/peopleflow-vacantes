import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_API_TIMEOUT_MS, validateServerEnv } from "./validate";

const API = "PEOPLEFLOW_API_BASE_URL", SITE = "PEOPLEFLOW_SITE_URL";
const KEYS = [API, SITE];
const LOOPBACK: Record<string, string> = { [API]: "http://127.0.0.1:8080", [SITE]: "http://127.0.0.1:3000" };
const HTTPS: Record<string, string> = { [API]: "https://api.peopleflow.mx", [SITE]: "https://peopleflow.mx" };
// Vary one origin while the other stays a valid production HTTPS origin.
const prodEnv = (key: string, value: string) => ({ NODE_ENV: "production", ...HTTPS, [key]: value });
const envWith = (key: string, value: unknown) => ({ ...LOOPBACK, [key]: value });
const throws = (env: Record<string, unknown>, msg?: string) => expect(() => validateServerEnv(env as never), msg).toThrow();
const passes = (env: Record<string, unknown>, msg?: string) => expect(() => validateServerEnv(env as never), msg).not.toThrow();

describe("server environment validation", () => {
  it("accepts loopback HTTP origins and returns the validated values", () => {
    expect(validateServerEnv({ ...LOOPBACK })).toEqual({
      apiBaseUrl: "http://127.0.0.1:8080", siteUrl: "http://127.0.0.1:3000", apiTimeoutMs: 8000, sampleJobs: false,
    });
  });

  it("requires absolute, pathless, credential-free origins without query or fragment, for both origins", () => {
    for (const key of KEYS)
      for (const value of [
        undefined, "not-an-origin", "/jobs/relative",
        "http://user:pass@127.0.0.1:8080", "http://127.0.0.1:8080/api/v1", // credentials, origin path
        "https://peopleflow.mx/?x=1", "https://peopleflow.mx/#fragmento", "ftp://127.0.0.1:8080", // query, fragment, non-HTTP scheme
      ])
        throws(envWith(key, value), `${key}: ${value ?? "missing"}`);
  });

  it("requires HTTPS in production and loopback-only HTTP in development, symmetrically for both origins", () => {
    for (const key of KEYS) {
      throws(prodEnv(key, LOOPBACK[key]));
      passes(prodEnv(key, HTTPS[key]));
      for (const host of ["127.0.0.1", "localhost", "[::1]"]) passes(envWith(key, `http://${host}:8080`));
      throws(envWith(key, "http://api.example.com"));
    }
  });

  it("allows an explicit production preview only when both origins are loopback", () => {
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      const env = { NODE_ENV: "production", PEOPLEFLOW_LOCAL_PREVIEW: "true", [API]: `http://${host}:4110`, [SITE]: `http://${host}:3000` };
      expect(validateServerEnv(env)).toEqual({ apiBaseUrl: env[API], siteUrl: env[SITE], apiTimeoutMs: 8000, sampleJobs: false });
    }
    throws({ NODE_ENV: "production", ...LOOPBACK, PEOPLEFLOW_LOCAL_PREVIEW: "false" });
    for (const key of KEYS) {
      for (const origin of ["http://example.com", "https://example.com", "http://localhost.example.com", "http://192.168.1.10"]) {
        throws({ NODE_ENV: "production", ...LOOPBACK, PEOPLEFLOW_LOCAL_PREVIEW: "true", [key]: origin });
      }
      for (const malformed of ["http://user:pass@localhost:4110", "http://localhost:4110/jobs", "http://localhost:4110?x=1", "http://localhost:4110#x"]) {
        throws({ NODE_ENV: "production", ...LOOPBACK, PEOPLEFLOW_LOCAL_PREVIEW: "true", [key]: malformed });
      }
    }
  });

  it("rejects ambiguous preview flags and keeps production HTTPS valid without opt-in", () => {
    for (const flag of ["1", "yes", "TRUE", "", true, false, 1]) {
      expect(() => validateServerEnv({ ...LOOPBACK, PEOPLEFLOW_LOCAL_PREVIEW: flag })).toThrow("PEOPLEFLOW_LOCAL_PREVIEW");
    }
    passes({ NODE_ENV: "production", ...HTTPS });
    passes({ NODE_ENV: "production", ...HTTPS, PEOPLEFLOW_LOCAL_PREVIEW: "false" });
    throws({ ...HTTPS, PEOPLEFLOW_LOCAL_PREVIEW: "true" });
    throws({ NODE_ENV: "production", ...LOOPBACK, PEOPLEFLOW_LOCAL_PREVIEW: "true", PEOPLEFLOW_API_TIMEOUT_MS: "0" });
  });

  it("accepts only integer timeouts between 1000 and 30000 ms and defaults to 8000", () => {
    expect(DEFAULT_API_TIMEOUT_MS).toBe(8000);
    for (const ms of ["1000", "15000", "30000", 1000, 30000]) passes({ ...LOOPBACK, PEOPLEFLOW_API_TIMEOUT_MS: ms });
    for (const ms of ["999", "30001", "1500.5", "abc", "", 0]) throws({ ...LOOPBACK, PEOPLEFLOW_API_TIMEOUT_MS: ms });
  });

  it("defaults the sample-jobs flag to false, accepts only true/false strings, and never changes the required origins", () => {
    expect(validateServerEnv({ ...LOOPBACK }).sampleJobs).toBe(false);
    expect(validateServerEnv({ ...LOOPBACK, PEOPLEFLOW_SAMPLE_JOBS: "false" }).sampleJobs).toBe(false);
    expect(validateServerEnv({ ...LOOPBACK, PEOPLEFLOW_SAMPLE_JOBS: "true" }).sampleJobs).toBe(true);
    for (const flag of ["1", "yes", "TRUE", "", true, false, 1])
      expect(() => validateServerEnv({ ...LOOPBACK, PEOPLEFLOW_SAMPLE_JOBS: flag })).toThrow("PEOPLEFLOW_SAMPLE_JOBS");
    // The flag is independent of the site/API origins, which stay required.
    throws({ PEOPLEFLOW_SAMPLE_JOBS: "true" });
  });

  it("keeps the server-only guard on the process entry module", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/env/server.ts"), "utf8");
    expect(source).toMatch(/import\s+"server-only"/);
    expect(source).toMatch(/validateServerEnv/);
  });
});
