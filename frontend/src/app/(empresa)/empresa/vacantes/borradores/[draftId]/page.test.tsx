import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useReportDraftPageState } from "@/features/jobs/drafts/ui/draft-page-chrome";
import "@testing-library/jest-dom/vitest";
import { notFound } from "next/navigation";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { DraftEditLoader } from "@/features/jobs/drafts/reopen/draft-edit-loader";
import Page, { dynamic } from "./page";
vi.mock("@/features/jobs/drafts/reopen/load", () => ({loadDraftForEditAction:vi.fn()}));
vi.mock("@/features/jobs/drafts/reopen/draft-edit-loader", () => ({DraftEditLoader:vi.fn(() => <div data-testid="draft-loader" />)}));
vi.mock("next/navigation", () => ({notFound:vi.fn(() => {throw new Error("NEXT_NOT_FOUND");})}));
vi.mock("@/components/company-dashboard/site-header", () => ({SiteHeader:({title,parent}:{title:string;parent:{label:string;href:string}}) => <header><h1>{title}</h1><a href={parent.href}>{parent.label}</a></header>}));
const id = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => {vi.clearAllMocks();});
afterEach(cleanup);
it("awaits params, renders a generic header and delegates loading without fetching private data in RSC", async () => {
  expect(dynamic).toBe("force-dynamic");
  render(await Page({params:Promise.resolve({draftId:id})}));
  // Until the editor reports what it loaded, neither «borrador» nor the draft-only columns link is claimed.
  expect(screen.getByRole("heading",{level:1})).toHaveTextContent("Editar vacante");
  expect(screen.getByRole("link",{name:"Vacantes"})).toHaveAttribute("href","/empresa/vacantes");
  expect(screen.queryByRole("link", {name:"Configurar columnas"})).not.toBeInTheDocument();
  expect(DraftEditLoader).toHaveBeenCalledWith({draftId:id},undefined);
  expect(loadDraftForEditAction).not.toHaveBeenCalled();
});
it.each([["draft","Editar borrador",true],["vacancy","Editar vacante",false]] as const)("follows what the editor loaded: %s reads «%s» (columns link: %s)", async (state,title,columns) => {
  vi.mocked(DraftEditLoader).mockImplementationOnce(() => { useReportDraftPageState(state); return <div data-testid="draft-loader" />; });
  render(await Page({params:Promise.resolve({draftId:id})}));
  expect(await screen.findByRole("heading",{level:1})).toHaveTextContent(title);
  const link = screen.queryByRole("link", {name:"Configurar columnas"});
  if (columns) { expect(link).toHaveAttribute("href", `/empresa/vacantes/${id}/configuracion/columnas`); expect(link!.compareDocumentPosition(screen.getByTestId("draft-loader")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); }
  else expect(link).not.toBeInTheDocument();
});
it.each(["bad","../nuevo",""])("notFound for invalid UUID %j before mounting the client loader", async draftId => {
  await expect(Page({params:Promise.resolve({draftId})})).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
  expect(DraftEditLoader).not.toHaveBeenCalled();
  expect(loadDraftForEditAction).not.toHaveBeenCalled();
});
