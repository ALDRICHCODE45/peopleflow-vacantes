import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "unauthenticated", result: undefined }) }));
import { ApplicationChannelProvider } from "../application/application-channel";
import { PublicApplyLink } from "./public-apply-link";
const jobId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
afterEach(cleanup);
it("forwards the careers site channel the route resolved into the postular link", () => {
  render(<ApplicationChannelProvider channel="careers_site"><PublicApplyLink jobId={jobId} /></ApplicationChannelProvider>);
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${jobId}/postular?origen=sitio`);
});
it("keeps the plain portal link for the portal channel and without a provider", () => {
  render(<ApplicationChannelProvider channel="portal"><PublicApplyLink jobId={jobId} /></ApplicationChannelProvider>);
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${jobId}/postular`);
  cleanup(); render(<PublicApplyLink jobId={jobId} />);
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveAttribute("href", `/vacantes/${jobId}/postular`);
});
