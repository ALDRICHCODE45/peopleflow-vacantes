import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// Substitutes the guarded `lib/api/server` module for Vitest only: "server-only"
// cannot execute under jsdom, so the marker is not executed here; production
// import correctness is established by the source-inspection test below.
vi.mock("../../../lib/api/server", async () => {
  const transport = await import("../../../lib/api/requestJson");
  return { requestJson: transport.requestJson };
});

vi.mock("../../../lib/env/server", () => ({
  serverEnv: {
    apiBaseUrl: "http://127.0.0.1:8080",
    siteUrl: "http://127.0.0.1:3000",
    apiTimeoutMs: 8000,
  },
}));

import { createJob } from "./createJob";
import type { CreateJobResult } from "./createJob";
import { jobEditorViewSchema } from "./schemas";
import type { CreateJobRequest } from "./schemas";

const JOB_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const COMPANY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";

const editorViewPayload = {
  id: JOB_ID,
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  status: "draft",
  updated_at: "2026-02-01T10:00:00Z",
  company: { id: COMPANY_ID, name: "Acme" },
};

const createRequest: CreateJobRequest = {
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  location: "Monterrey, NL",
  salary_min: 25000,
  salary_max: 40000,
  salary_currency: "MXN",
};

function status(statusCode: number, body?: unknown) {
  return {
    ok: statusCode < 300,
    status: statusCode,
    json: async () => {
      if (body !== undefined) return body;
      throw new SyntaxError("Unexpected token 'N', is not valid JSON");
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("createJob", () => {
  it("POSTs the JSON payload to /jobs with the explicit bearer token and returns the validated editor view", async () => {
    const fetchMock = vi.fn().mockResolvedValue(status(201, editorViewPayload));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createJob(createRequest, "test-token")).resolves.toEqual({
      ok: true,
      data: jobEditorViewSchema.parse(editorViewPayload),
    });

    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("http://127.0.0.1:8080/jobs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(createRequest);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(init.cache).toBe("no-store");
  });

  it("rejects an empty or blank bearer token without issuing any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const token of ["", "   ", "\n\t "]) {
      await expect(createJob(createRequest, token)).resolves.toEqual({
        ok: false,
        error: { kind: "missing_token", retryable: false },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the backend {error, code, data?} envelope on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(status(401, { error: "unauthenticated", code: "unauthenticated" })),
    );
    await expect(createJob(createRequest, "expired-token")).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 401 },
      envelope: { error: "unauthenticated", code: "unauthenticated" },
    });

    const conflictView = { ...editorViewPayload, status: "published" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        status(409, { error: "resource conflict", code: "conflict", data: conflictView }),
      ),
    );
    await expect(createJob(createRequest, "test-token")).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 409 },
      envelope: { error: "resource conflict", code: "conflict", data: conflictView },
    });
  });

  it("keeps the failure classification when the error body is not the backend envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(status(500, { message: "raw failure detail" })),
    );
    const result = await createJob(createRequest, "test-token");
    expect(result).toEqual({
      ok: false,
      error: { kind: "status", retryable: true, status: 500 },
    });
    expect((result as { envelope?: unknown }).envelope).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("raw failure detail");
  });

  it("classifies a schema-invalid editor response as an invalid response without leaking the body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(status(201, { id: "not-a-uuid", status: "draft" })),
    );
    const result = await createJob(createRequest, "test-token");
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_response", retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain("not-a-uuid");
  });

  it("rejects a 201 that is not a created draft or that carries published_at", async () => {
    const bodies = [
      { ...editorViewPayload, status: "published" },
      { ...editorViewPayload, status: "closed" },
      { ...editorViewPayload, status: "published", published_at: "2026-01-15T12:00:00Z" },
      { ...editorViewPayload, published_at: "2026-01-15T12:00:00Z" },
    ];
    for (const body of bodies) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(status(201, body)));
      const result = await createJob(createRequest, "test-token");
      expect(result).toEqual({
        ok: false,
        error: { kind: "invalid_response", retryable: false },
      });
      expect(Object.hasOwn(result, "envelope")).toBe(false);
      expect(JSON.stringify(result)).not.toContain("2026-01-15T12:00:00Z");
    }
  });

  it("accepts only an exact HTTP 201 and fails closed on every other success-class status", async () => {
    for (const statusCode of [200, 202, 206]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(status(statusCode, editorViewPayload)),
      );
      const result = await createJob(createRequest, "test-token");
      expect(result).toEqual({
        ok: false,
        error: { kind: "invalid_response", retryable: false },
      });
      expect(Object.hasOwn(result, "envelope")).toBe(false);
      // A success-class body that is not the promised 201 never reaches the caller.
      expect(JSON.stringify(result)).not.toContain(JOB_ID);
    }
  });

  it("classifies a network failure as retryable with no envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await createJob(createRequest, "test-token");
    expect(result).toEqual({ ok: false, error: { kind: "network", retryable: true } });
    expect((result as { envelope?: unknown }).envelope).toBeUndefined();
  });

  it("imports the transport only through the guarded server-only façade and retrieves no session", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/jobs/create/createJob.ts"),
      "utf8",
    );
    expect(source).toMatch(/lib\/api\/server"/);
    expect(source).not.toMatch(/lib\/api\/requestJson/);
    expect(source).not.toMatch(/cookies\(|next\/headers/);
  });

  it("returns the typed create-job result", () => {
    expectTypeOf(createJob).returns.toEqualTypeOf<Promise<CreateJobResult>>();
  });
});
