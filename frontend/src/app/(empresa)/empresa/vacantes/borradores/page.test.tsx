import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title, parent }: { title: string; parent: { label: string; href: string } }) => <header><h1>{title}</h1><a href={parent.href}>{parent.label}</a></header> }));
vi.mock("@/features/jobs/drafts/list/draft-list", () => ({ DraftList: () => <section aria-label="Lista de borradores" /> }));
it("composes the shared header, Vacantes parent and draft list", async () => {
 const { default: Page, metadata } = await import("./page"); render(<Page />);
 expect(metadata.title).toBe("Borradores"); expect(screen.getByRole("heading", { name: "Borradores" })).toBeInTheDocument();
 expect(screen.getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/vacantes"); expect(screen.getByRole("region", { name: "Lista de borradores" })).toBeInTheDocument();
});
