import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/auth/local-bootstrap/session", () => ({
  resolveLocalBootstrapSession: mocks.resolve,
}));

import BootstrapLocalPage from "./page";
import { POST as applyPost } from "@/app/api/auth/local-bootstrap/apply/route";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  createCsrfToken,
} from "@/lib/auth/local-bootstrap/csrf";
import {
  OPERATION_COOKIE_NAME,
  createOperationBinding,
} from "@/lib/auth/local-bootstrap/operation";
import {
  FIXTURE_ACCESS,
  FIXTURE_BASE_URL,
  FIXTURE_KEY,
  FIXTURE_NEXTAUTH_SECRET,
  FIXTURE_OPERATION_CODE,
  FIXTURE_SITE_URL,
} from "@/lib/auth/local-bootstrap/fixtures";

const NOW = 1_700_000_000_000;
const UI_CSRF = "fixture-ui-csrf-nonce";
const APPLY_ENDPOINT = "http://localhost:3000/api/auth/local-bootstrap/apply";

function stubEnabledEnv() {
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED", "true");
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL", FIXTURE_BASE_URL);
  vi.stubEnv("PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY", FIXTURE_KEY);
  vi.stubEnv("NEXTAUTH_URL", FIXTURE_SITE_URL);
  vi.stubEnv("NEXTAUTH_SECRET", FIXTURE_NEXTAUTH_SECRET);
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  stubEnabledEnv();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  mocks.resolve.mockReset();
  mocks.resolve.mockResolvedValue({ accessToken: FIXTURE_ACCESS, cookies: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apply failure regression: the actual route envelope reaches the UI", () => {
  it("keeps uncertainty after the real 500 bootstrap_failed envelope and never retries", async () => {
    // 1. Run the ACTUAL public apply route with a lost/ambiguous upstream response.
    const csrf = createCsrfToken(FIXTURE_NEXTAUTH_SECRET, FIXTURE_ACCESS, NOW);
    const binding = createOperationBinding(
      FIXTURE_NEXTAUTH_SECRET,
      FIXTURE_ACCESS,
      csrf,
      FIXTURE_OPERATION_CODE,
      60,
      NOW,
    );
    const goFetch = vi.fn().mockRejectedValue(new Error("lost response"));
    vi.stubGlobal("fetch", goFetch);
    const headers = new Headers({
      origin: FIXTURE_SITE_URL,
      cookie: `${CSRF_COOKIE_NAME}=${csrf}; ${OPERATION_COOKIE_NAME}=${binding}`,
      [CSRF_HEADER_NAME]: csrf,
      "content-type": "application/json",
    });
    const routeResponse = await applyPost(
      new NextRequest(APPLY_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ operation_code: FIXTURE_OPERATION_CODE }),
      }),
    );

    expect(routeResponse.status).toBe(500);
    const routeBody = (await routeResponse.json()) as { ok: boolean; code: string };
    expect(routeBody).toEqual({ ok: false, code: "bootstrap_failed" });
    expect(goFetch).toHaveBeenCalledTimes(1);

    // 2. Feed exactly that serialized envelope into the UI.
    const uiFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/nonce")) return Response.json({ ok: true, nonce: UI_CSRF });
      if (url.endsWith("/stage")) {
        return Response.json(
          { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 },
          { status: 202 },
        );
      }
      if (url.endsWith("/apply")) return Response.json(routeBody, { status: 500 });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", uiFetch);

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos confirmar el resultado/i),
    );
    expect(uiFetch).toHaveBeenCalledTimes(3);

    // 3. No automatic retry and no unsafe replacement on further clicks.
    const applyButton = screen.getByRole("button", { name: /aplicar/i });
    const prepareButton = screen.getByRole("button", { name: /preparar/i });
    expect(applyButton).toBeDisabled();
    expect(prepareButton).toBeDisabled();
    fireEvent.click(applyButton);
    fireEvent.click(prepareButton);
    await Promise.resolve();
    expect(uiFetch).toHaveBeenCalledTimes(3);
    expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos confirmar el resultado/i);
  });
});
