import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import BootstrapLocalPage from "./page";
import { FIXTURE_OPERATION_CODE } from "@/lib/auth/local-bootstrap/fixtures";

const CSRF = "fixture-csrf-nonce-value";

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

function mockFetchSequence(nonce = CSRF) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/auth/local-bootstrap/nonce")) {
      return jsonResponse(200, { ok: true, nonce });
    }
    if (url.endsWith("/api/auth/local-bootstrap/stage")) {
      return jsonResponse(202, {
        ok: true,
        operation_code: FIXTURE_OPERATION_CODE,
        expires_in: 60,
      });
    }
    if (url.endsWith("/api/auth/local-bootstrap/apply")) {
      return jsonResponse(200, { ok: true, code: "created" });
    }
    throw new Error(`unexpected request: ${url} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("temporary local identity bootstrap page", () => {
  it("performs no stage, apply or mutation on mount and exposes explicit actions", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<BootstrapLocalPage />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /preparar/i })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /aplicar/i })).not.toBeInTheDocument();
  });

  it("stages only through the read-only nonce plus the stage route with the bound CSRF header", async () => {
    const fetchMock = mockFetchSequence();

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));

    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      "/api/auth/local-bootstrap/nonce",
      "/api/auth/local-bootstrap/stage",
    ]);
    const [nonceCall, stageCall] = fetchMock.mock.calls as [RequestInfo | URL, RequestInit][];
    expect(nonceCall[1].method).toBe("GET");
    expect(nonceCall[1].cache).toBe("no-store");
    expect(stageCall[1].method).toBe("POST");
    expect(stageCall[1].body).toBe("{}");
    expect(new Headers(stageCall[1].headers).get("x-local-bootstrap-csrf")).toBe(CSRF);
    expect(screen.getByRole("button", { name: /aplicar/i })).toBeEnabled();
  });

  it("applies only after the explicit Apply action, sending exactly the staged operation code", async () => {
    const fetchMock = mockFetchSequence();

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/auth/local-bootstrap/nonce",
      "/api/auth/local-bootstrap/stage",
    ]);

    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    await waitFor(() => expect(screen.getByText(/se creó el usuario local/i)).toBeInTheDocument());

    const applyCall = fetchMock.mock.calls.at(-1) as [RequestInfo | URL, RequestInit];
    expect(String(applyCall[0])).toBe("/api/auth/local-bootstrap/apply");
    expect(applyCall[1].body).toBe(JSON.stringify({ operation_code: FIXTURE_OPERATION_CODE }));
    expect(new Headers(applyCall[1].headers).get("x-local-bootstrap-csrf")).toBe(CSRF);
  });

  it("keeps approval_required pending and explicit, without auto-applying again", async () => {
    const fetchMock = mockFetchSequence();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/nonce")) return jsonResponse(200, { ok: true, nonce: CSRF });
      if (url.endsWith("/stage")) {
        return jsonResponse(202, { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 });
      }
      return jsonResponse(409, { ok: false, code: "approval_required" });
    });

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/aprobación en la terminal/i),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: /aplicar/i })).toBeEnabled();

    // A pending/approval operation can only be completed: no unsafe replacement.
    expect(screen.getByRole("button", { name: /preparar/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument();
  });

  it("retains uncertainty on an upstream bootstrap_failed and disables both actions", async () => {
    const fetchMock = mockFetchSequence();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/nonce")) return jsonResponse(200, { ok: true, nonce: CSRF });
      if (url.endsWith("/stage")) {
        return jsonResponse(202, { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 });
      }
      return jsonResponse(500, { ok: false, code: "bootstrap_failed" });
    });

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos confirmar el resultado/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const applyButton = screen.getByRole("button", { name: /aplicar/i });
    const prepareButton = screen.getByRole("button", { name: /preparar/i });
    expect(applyButton).toBeDisabled();
    expect(prepareButton).toBeDisabled();

    fireEvent.click(applyButton);
    fireEvent.click(prepareButton);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos confirmar el resultado/i);
  });

  it("treats an unknown or malformed apply response as uncertainty, not as a failed write", async () => {
    const fetchMock = mockFetchSequence();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/nonce")) return jsonResponse(200, { ok: true, nonce: CSRF });
      if (url.endsWith("/stage")) {
        return jsonResponse(202, { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 });
      }
      return jsonResponse(200, { ok: true, code: "unexpected" });
    });

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos confirmar el resultado/i),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: /aplicar/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /preparar/i })).toBeDisabled();
  });

  it("reports an ambiguous apply result and refuses an automatic retry", async () => {
    const fetchMock = mockFetchSequence();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/nonce")) return jsonResponse(200, { ok: true, nonce: CSRF });
      if (url.endsWith("/stage")) {
        return jsonResponse(202, { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 });
      }
      throw new Error("socket hang up");
    });

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /aplicar/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos confirmar el resultado/i),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: /aplicar/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /preparar/i })).toBeDisabled();
  });

  it("reports expiry immediately and disables Apply, with no extra request", async () => {
    const fetchMock = mockFetchSequence();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/nonce")) return jsonResponse(200, { ok: true, nonce: CSRF });
      if (url.endsWith("/stage")) {
        return jsonResponse(202, {
          ok: true,
          operation_code: FIXTURE_OPERATION_CODE,
          expires_in: 0,
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    expect(screen.getByRole("alert")).toHaveTextContent(/expiró/i);
    expect(screen.getByRole("button", { name: /aplicar/i })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never renders email, name or any credential and never logs", async () => {
    const fetchMock = mockFetchSequence();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    const { container } = render(<BootstrapLocalPage />);
    fireEvent.click(screen.getByRole("button", { name: /preparar/i }));
    await waitFor(() => expect(screen.getByText(FIXTURE_OPERATION_CODE)).toBeInTheDocument());

    expect(container.textContent ?? "").not.toMatch(/@|email|fixture-private|access.?token/i);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
