import "./browser-platform.test-support";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { SitePublication } from "./publication";
import { createAutosave, type AutosaveController } from "../autosave";
import { defaultBlock, defaultSiteDraft } from "../defaults";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { notifyActionResult } from "@/components/feedback/notify";
import type { SiteState } from "../api/model";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
vi.mock("next/font/google", () => ({ Fraunces: () => ({ variable: "editorial" }), Plus_Jakarta_Sans: () => ({ variable: "modern" }) }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
let controller: AutosaveController;
beforeEach(() => {
  vi.mocked(getActionAccessToken).mockResolvedValue("recruiter-fixture-token");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "forbidden", error: "upstream-private-detail" }), { status: 403 })));
});
afterEach(() => { cleanup(); controller?.dispose(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it.each(["publish", "unpublish"] as const)("surfaces the backend recruiter 403 on the real %s action path despite stale owner UI", async operation => {
  const draft = defaultSiteDraft(); draft.slug = "nexo";
  if (draft.blocks[0].type === "hero") draft.blocks[0].content.title = "Únete";
  const closing = defaultBlock("closing"); if (closing.type === "closing") closing.content.title = "Crece";
  draft.blocks.push(closing);
  const data: SiteState = { draft, draft_version: 7, published: { version: 7, slug: "nexo", published_at: "2026-10-27T00:00:00Z" }, has_unpublished_changes: false, media: [], updated_at: "2026-10-27T00:00:00Z" };
  controller = createAutosave(data, '"7"', vi.fn());
  const onState = vi.fn();
  // The role displayed by a mounted page can become stale. The server session
  // now belongs to a recruiter; real server actions/client must surface its 403.
  render(<SitePublication controller={controller} role="owner" company={{ name: "Nexo", logo_url: "https://example.com/logo.png" }} published={data.published} onState={onState} onNavigate={vi.fn()} onConflict={vi.fn()} />);
  await act(async () => fireEvent.click(operation === "publish" ? screen.getByRole("button", { name: "Publicar" }) : screen.getByRole("menuitem", { name: "Despublicar" })));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: operation === "publish" ? "Publicar sitio" : "Despublicar sitio" })));
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`http://localhost:8080/v2/me/company/site/${operation}`, expect.objectContaining({ method: "POST", headers: expect.any(Headers) }));
  expect(within(screen.getByRole("alertdialog")).getByRole("status")).toHaveTextContent(`Solo la persona dueña de la empresa puede ${operation === "publish" ? "publicar" : "despublicar"}`);
  expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer recruiter-fixture-token");
  expect(onState).not.toHaveBeenCalled();
  expect(notifyActionResult).toHaveBeenCalledOnce();
  expect(document.body.textContent).not.toMatch(/upstream-private-detail|recruiter-fixture-token/);
});
