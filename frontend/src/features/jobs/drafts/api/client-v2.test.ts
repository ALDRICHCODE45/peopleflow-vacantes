import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

// Substitutes the guarded `lib/api/server` façade for Vitest only, exactly like
// the v1 draft client and createJob tests: the real transport still runs;
// "server-only" is the only thing not executed under jsdom.
const envState = vi.hoisted(() => ({ accesses: 0 }));

vi.mock("../../../../lib/api/server", async () => {
  const transport = await import("../../../../lib/api/requestJson");
  return { requestJson: transport.requestJson };
});

vi.mock("../../../../lib/env/server", () => ({
  get serverEnv() {
    envState.accesses += 1;
    return {
      apiBaseUrl: "http://127.0.0.1:8080",
      siteUrl: "http://127.0.0.1:3000",
      apiTimeoutMs: 8000,
      sampleJobs: false,
    };
  },
}));

import { draftV2PostBodySchema } from "../screening-v2/wire";
import { createDraftV2, getDraftV2, saveDraftV2 } from "./client-v2";
import type { CreateDraftV2Result, GetDraftV2Result, SaveDraftV2Result } from "./client-v2";

const TOKEN = "draft-v2-secret-token";
const ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const OTHER_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";
const IDEMPOTENCY_KEY = "3f4a5b6c-7d8e-4f1a-9b2c-3d4e5f6a7b8c";
const ETAG = '"jd-r2-0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e-v1"';
const BASE = "http://127.0.0.1:8080";
const COLLECTION = `${BASE}/v2/me/company/job-drafts`;
const TIMESTAMP = "2026-10-06T03:00:00.123456Z";

// Uppercase hex spellings prove the client preserves the exact submitted case.
const OPEN_ID = "D2B3C4D5-E6F7-4A8B-9C0D-1E2F3A4B5C6D";
const EVALUATED_ID = "B0F1C2D3-4E5F-4A6B-8C7D-9E0F1A2B3C4D";
const CORRECT_ID = "1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D";
const WRONG_ID = "2B3C4D5E-6F7A-4B8C-9D0E-1F2A3B4C5D6E";

const openQuestion = () => ({
  id: OPEN_ID,
  type: "open" as const,
  prompt: "Describe un proyecto del que estés orgulloso.",
});

const evaluatedQuestion = () => ({
  id: EVALUATED_ID,
  type: "single_choice_evaluated" as const,
  prompt: "¿Qué palabra clave declara una función en Go?",
  options: [
    { id: CORRECT_ID, label: "func" },
    { id: WRONG_ID, label: "function" },
  ],
  correct_option_id: CORRECT_ID,
});

const v2Questions = () => [openQuestion(), evaluatedQuestion()];

function readEnvelopeV2(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    id: ID,
    status: "draft",
    principal_recruiter_id: OTHER_ID,
    version: "1",
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    fields: {
      ...draftV2PostBodySchema.parse({ fields: {} }).fields,
      screening_questions: v2Questions(),
      description_plain: null as string | null,
    },
    ...overrides,
  };
}

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  };
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

beforeEach(() => {
  envState.accesses = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runtime missing inputs", () => {
  it("returns missing_token for absent or undefined credentials in every entry point", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const tokenFields of [{}, { token: undefined }]) {
      await expect(
        createDraftV2({ ...tokenFields, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } } as unknown as Parameters<typeof createDraftV2>[0]),
      ).resolves.toEqual({ ok: false, error: { kind: "missing_token", retryable: false } });
      await expect(
        getDraftV2({ ...tokenFields, id: ID } as unknown as Parameters<typeof getDraftV2>[0]),
      ).resolves.toEqual({ ok: false, error: { kind: "missing_token", retryable: false } });
      await expect(
        saveDraftV2({ ...tokenFields, id: ID, ifMatch: ETAG, body: { fields: { title: "x" } } } as unknown as Parameters<typeof saveDraftV2>[0]),
      ).resolves.toEqual({ ok: false, error: { kind: "missing_token", retryable: false } });
    }
    expect(envState.accesses).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns invalid_request for absent or undefined If-Match before env or network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const tagFields of [{}, { ifMatch: undefined }]) {
      await expect(
        saveDraftV2({ token: TOKEN, id: ID, ...tagFields, body: { fields: { title: "x" } } } as unknown as Parameters<typeof saveDraftV2>[0]),
      ).resolves.toEqual({ ok: false, error: { kind: "invalid_request", retryable: false } });
    }
    expect(envState.accesses).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createDraftV2", () => {
  it("POSTs the validated v2 body to the exact v2 route with explicit credentials and idempotency key", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(201, readEnvelopeV2(), { ETag: ETAG, "Idempotency-Replayed": "false" }));
    vi.stubGlobal("fetch", fetchMock);

    const body = { fields: { screening_questions: v2Questions() } };
    const input = { token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body };
    const before = structuredClone(body);

    await expect(createDraftV2(input)).resolves.toEqual({
      ok: true,
      data: readEnvelopeV2(),
      etag: ETAG,
      idempotencyReplayed: "false",
    });

    const [calledUrl, init] = lastCall(fetchMock);
    expect(calledUrl).toBe(COLLECTION);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(draftV2PostBodySchema.parse(body)));
    const serialized = JSON.parse(init.body as string);
    expect(serialized.fields.screening_questions[0]).toEqual(openQuestion());
    expect(serialized.fields.screening_questions[1].correct_option_id).toBe(CORRECT_ID);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("accept")).toBe("application/json");
    expect(init.cache).toBe("no-store");
    // Credentialed calls never follow redirects (S4: any 3xx is an error).
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(input.body).toStrictEqual(before);
  });

  it("preserves the raw replay flag `true` without converting it to a boolean", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(201, readEnvelopeV2(), { ETag: ETAG, "Idempotency-Replayed": "true" })),
    );
    const result = await createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } });
    expect(result).toMatchObject({ ok: true, idempotencyReplayed: "true" });
  });

  it("fails closed as invalid_response when the mandatory ETag or replay flag is missing or malformed", async () => {
    const scenarios: Record<string, string>[] = [
      {},
      { ETag: ETAG },
      { "Idempotency-Replayed": "false" },
      { ETag: "   ", "Idempotency-Replayed": "false" },
      { ETag: ETAG, "Idempotency-Replayed": "TRUE" },
      { ETag: ETAG, "Idempotency-Replayed": "1" },
      { ETag: ETAG, "Idempotency-Replayed": "" },
    ];
    for (const headers of scenarios) {
      const fetchMock = vi.fn().mockResolvedValue(response(201, readEnvelopeV2(), headers));
      vi.stubGlobal("fetch", fetchMock);
      const result = await createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } });
      expect(result).toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
      expect(Object.hasOwn(result, "envelope")).toBe(false);
      expect(JSON.stringify(result)).not.toContain(ID);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects any success-class status other than 201 without reading the body", async () => {
    const json = vi.fn(async () => readEnvelopeV2());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: ETAG, "Idempotency-Replayed": "false" }),
        json,
      }),
    );
    const result = await createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } });
    expect(result).toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
    expect(json).not.toHaveBeenCalled();
  });

  it("returns the decoded error envelope/code while dropping data and unknown error fields, without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(409, {
        error: "idempotency conflict",
        code: "idempotency_conflict",
        data: { secret: "must-not-leak" },
        unknown: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } });
    expect(result).toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 409 },
      envelope: { error: "idempotency conflict", code: "idempotency_conflict" },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies every mutation failure as non-retryable, including network and 5xx transport flags", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(
      createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } }),
    ).resolves.toEqual({ ok: false, error: { kind: "network", retryable: false } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(503, { error: "down", code: "internal_error" })));
    await expect(
      createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 503 },
      envelope: { error: "down", code: "internal_error" },
    });
  });

  it("classifies a mutation timeout as non-retryable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve({
          ...response(201, readEnvelopeV2(), { ETag: ETAG, "Idempotency-Replayed": "false" }),
          json: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        }),
      ),
    );
    const pending = createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } });
    await vi.advanceTimersByTimeAsync(8001);
    await expect(pending).resolves.toEqual({ ok: false, error: { kind: "timeout", retryable: false } });
  });

  it("preflights missing credential, malformed idempotency key and invalid v2 write bodies before any environment or network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = envState.accesses;

    for (const token of ["", "   ", "\n\t "]) {
      await expect(
        createDraftV2({ token, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } }),
      ).resolves.toEqual({ ok: false, error: { kind: "missing_token", retryable: false } });
    }
    for (const idempotencyKey of ["", "not-a-uuid", `${IDEMPOTENCY_KEY}-x`]) {
      await expect(
        createDraftV2({ token: TOKEN, idempotencyKey, body: { fields: {} } }),
      ).resolves.toEqual({ ok: false, error: { kind: "invalid_request", retryable: false } });
    }
    const v1Question = { id: EVALUATED_ID, prompt: "Only a v1 prompt" };
    for (const body of [null, {}, { fields: { unknown: 1 } }, { fields: "x" }, { fields: { screening_questions: [v1Question] } }]) {
      await expect(
        createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body }),
      ).resolves.toEqual({ ok: false, error: { kind: "invalid_request", retryable: false } });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envState.accesses).toBe(before);
  });

  it("preserves the caller payload and key so a failed create replays with the same pair and no generated key", async () => {
    const body = { fields: { screening_questions: v2Questions() } };
    const before = structuredClone(body);

    const failure = vi.fn().mockResolvedValue(response(500, { error: "down", code: "internal_error" }));
    vi.stubGlobal("fetch", failure);
    const first = await createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body });
    expect(first).toMatchObject({ ok: false, error: { kind: "status", status: 500 } });

    const success = vi
      .fn()
      .mockResolvedValue(response(201, readEnvelopeV2(), { ETag: ETAG, "Idempotency-Replayed": "true" }));
    vi.stubGlobal("fetch", success);
    await expect(createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body })).resolves.toMatchObject({
      ok: true,
      idempotencyReplayed: "true",
    });

    const expectedBody = JSON.stringify(draftV2PostBodySchema.parse(body));
    for (const mock of [failure, success]) {
      const [calledUrl, init] = lastCall(mock);
      expect(calledUrl).toBe(COLLECTION);
      expect(new Headers(init.headers).get("idempotency-key")).toBe(IDEMPOTENCY_KEY);
      expect(init.body).toBe(expectedBody);
    }
    expect(body).toStrictEqual(before);
  });

  it("never leaks the credential through a successful result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(201, readEnvelopeV2(), { ETag: ETAG, "Idempotency-Replayed": "false" })),
    );
    const result = await createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

describe("getDraftV2", () => {
  it("GETs the exact v2 draft path with the explicit credential and returns the v2 envelope with the opaque ETag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, readEnvelopeV2(), { ETag: ETAG }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toEqual({
      ok: true,
      data: readEnvelopeV2(),
      etag: ETAG,
    });

    const [calledUrl, init] = lastCall(fetchMock);
    expect(calledUrl).toBe(`${COLLECTION}/${ID}`);
    expect(init.method === undefined || init.method === "GET").toBe(true);
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect([...headers.keys()].sort()).toEqual(["accept", "authorization"]);
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
  });

  it("preserves private correct_option_id, UUID hex case and question/option order verbatim", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, readEnvelopeV2(), { ETag: ETAG }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getDraftV2({ token: TOKEN, id: ID });
    if (!result.ok) throw new Error("expected a successful v2 read");
    const questions = result.data.fields.screening_questions;
    expect(questions.map((question) => question.id)).toEqual([OPEN_ID, EVALUATED_ID]);
    const evaluated = questions[1];
    if (evaluated?.type !== "single_choice_evaluated") throw new Error("expected the evaluated variant");
    expect(evaluated.correct_option_id).toBe(CORRECT_ID);
    expect(evaluated.options.map((option) => option.id)).toEqual([CORRECT_ID, WRONG_ID]);
  });

  it("accepts a case-insensitive identity match and rejects a mismatched draft identity as invalid_response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(200, readEnvelopeV2({ id: ID.toUpperCase() }), { ETag: ETAG })),
    );
    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toMatchObject({ ok: true, etag: ETAG });

    const fetchMock = vi.fn().mockResolvedValue(response(200, readEnvelopeV2({ id: OTHER_ID }), { ETag: ETAG }));
    vi.stubGlobal("fetch", fetchMock);
    const mismatch = await getDraftV2({ token: TOKEN, id: ID });
    expect(mismatch).toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
    expect(JSON.stringify(mismatch)).not.toContain(OTHER_ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a v1-shaped payload on the v2 route as invalid_response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(200, readEnvelopeV2({ schema_version: 1 }), { ETag: ETAG })),
    );
    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toEqual({
      ok: false,
      error: { kind: "invalid_response", retryable: false },
    });
  });

  it("fails closed when the success ETag is missing and propagates 404/412 status codes without retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, readEnvelopeV2())));
    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toEqual({
      ok: false,
      error: { kind: "invalid_response", retryable: false },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404, { error: "not found", code: "not_found" })));
    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 404 },
      envelope: { error: "not found", code: "not_found" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(412, { error: "conflict", code: "version_conflict" })));
    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 412 },
      envelope: { error: "conflict", code: "version_conflict" },
    });
  });

  it("keeps the transport retry classification for a read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toEqual({
      ok: false,
      error: { kind: "network", retryable: true },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(503, { error: "down", code: "internal_error" })));
    await expect(getDraftV2({ token: TOKEN, id: ID })).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: true, status: 503 },
      envelope: { error: "down", code: "internal_error" },
    });
  });

  it("preflights missing credential and malformed draft ids before any environment or network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = envState.accesses;

    await expect(getDraftV2({ token: "  ", id: ID })).resolves.toEqual({
      ok: false,
      error: { kind: "missing_token", retryable: false },
    });
    for (const id of ["", "not-a-uuid", `${ID} `]) {
      await expect(getDraftV2({ token: TOKEN, id })).resolves.toEqual({
        ok: false,
        error: { kind: "invalid_request", retryable: false },
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envState.accesses).toBe(before);
  });
});

describe("saveDraftV2", () => {
  it("PATCHes the exact v2 draft path with the explicit credential, opaque If-Match and validated v2 patch body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, readEnvelopeV2({ version: "2" }), { ETag: ETAG }));
    vi.stubGlobal("fetch", fetchMock);

    const body = { fields: { screening_questions: v2Questions() } };
    const input = { token: TOKEN, id: ID, ifMatch: ETAG, body };
    const before = structuredClone(body);

    const result = await saveDraftV2(input);
    expect(result).toMatchObject({ ok: true, etag: ETAG, data: { version: "2" } });

    const [calledUrl, init] = lastCall(fetchMock);
    expect(calledUrl).toBe(`${COLLECTION}/${ID}`);
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify(body));
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("if-match")).toBe(ETAG);
    expect(headers.get("content-type")).toBe("application/json");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(input.body).toStrictEqual(before);
  });

  it("rejects a blank If-Match before any environment or network access and never constructs a tag", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = envState.accesses;

    for (const ifMatch of ["", "   ", "\n"]) {
      await expect(
        saveDraftV2({ token: TOKEN, id: ID, ifMatch, body: { fields: { title: "x" } } }),
      ).resolves.toEqual({ ok: false, error: { kind: "invalid_request", retryable: false } });
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(envState.accesses).toBe(before);
  });

  it("propagates 412/428/409 precondition and conflict codes without retry or success", async () => {
    const scenarios = [
      [412, { error: "draft version conflict", code: "version_conflict" }],
      [428, { error: "precondition required", code: "precondition_required" }],
      [409, { error: "company not active", code: "company_not_active" }],
    ] as const;
    for (const [status, envelope] of scenarios) {
      const fetchMock = vi.fn().mockResolvedValue(response(status, envelope));
      vi.stubGlobal("fetch", fetchMock);
      const result = await saveDraftV2({ token: TOKEN, id: ID, ifMatch: ETAG, body: { fields: { title: "x" } } });
      expect(result).toEqual({
        ok: false,
        error: { kind: "status", retryable: false, status },
        envelope,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a mismatched read DTO identity and a missing success ETag as invalid_response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(200, readEnvelopeV2({ id: OTHER_ID }), { ETag: ETAG })),
    );
    await expect(
      saveDraftV2({ token: TOKEN, id: ID, ifMatch: ETAG, body: { fields: { title: "x" } } }),
    ).resolves.toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, readEnvelopeV2())));
    await expect(
      saveDraftV2({ token: TOKEN, id: ID, ifMatch: ETAG, body: { fields: { title: "x" } } }),
    ).resolves.toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
  });

  it("preflights invalid v2 patch bodies and classifies mutations as non-retryable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const body of [{ fields: {} }, null, { fields: { unknown: 1 } }]) {
      await expect(
        saveDraftV2({ token: TOKEN, id: ID, ifMatch: ETAG, body }),
      ).resolves.toEqual({ ok: false, error: { kind: "invalid_request", retryable: false } });
    }
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(
      saveDraftV2({ token: TOKEN, id: ID, ifMatch: ETAG, body: { fields: { title: "x" } } }),
    ).resolves.toEqual({ ok: false, error: { kind: "network", retryable: false } });
  });
});

describe("additive isolation and typed results", () => {
  it("targets the v2 routes only and never falls back to the v1 collection, even on failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(500, { error: "down", code: "internal_error" }));
    vi.stubGlobal("fetch", fetchMock);

    await createDraftV2({ token: TOKEN, idempotencyKey: IDEMPOTENCY_KEY, body: { fields: {} } });
    await getDraftV2({ token: TOKEN, id: ID });
    await saveDraftV2({ token: TOKEN, id: ID, ifMatch: ETAG, body: { fields: { title: "x" } } });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [calledUrl] of fetchMock.mock.calls) {
      expect(calledUrl).toMatch(/\/v2\/me\/company\/job-drafts/);
      expect(calledUrl).not.toBe(`${BASE}/me/company/job-drafts`);
    }
  });

  it("imports the transport only through the guarded server-only façade and resolves no session", () => {
    const source = readFileSync(join(process.cwd(), "src/features/jobs/drafts/api/client-v2.ts"), "utf8");
    expect(source).toMatch(/lib\/api\/server"/);
    expect(source).not.toMatch(/lib\/api\/requestJson/);
    expect(source).not.toMatch(/cookies\(|next\/headers|findSampleJob|SAMPLE_JOBS|sampleJobs/);
  });

  it("returns the typed v2 draft client results", () => {
    expectTypeOf(createDraftV2).returns.toEqualTypeOf<Promise<CreateDraftV2Result>>();
    expectTypeOf(getDraftV2).returns.toEqualTypeOf<Promise<GetDraftV2Result>>();
    expectTypeOf(saveDraftV2).returns.toEqualTypeOf<Promise<SaveDraftV2Result>>();
  });
});
