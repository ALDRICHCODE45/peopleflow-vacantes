import { expect, it, vi } from "vitest";
vi.mock("@/features/psychometrics/candidate/account-page", () => ({ AccountAssessmentPage: vi.fn() }));
import Page, { metadata } from "./page";
import { AccountAssessmentPage } from "@/features/psychometrics/candidate/account-page";
it("keeps noindex and places the reused account flow inside the candidate route without a second heading", async () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });
  const page = await Page({ params: Promise.resolve({ iid: "10000000-0000-4000-8000-000000000001" }) });
  expect(page.props.children[0].props).toMatchObject({ heading: false, title: "Evaluación", parent: { href: "/candidato/postulaciones" } });
  expect(page.props.children[1].type).toBe(AccountAssessmentPage);
  expect(page.props.children[1].props).toEqual({ invitationId: "10000000-0000-4000-8000-000000000001" });
});
