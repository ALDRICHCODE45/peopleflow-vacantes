import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { formatSalary } from "../formatters";
import type { JobItem } from "../types";
import { JobDetailView } from "./JobDetailView";

const baseJob: JobItem = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  title: "Ingeniera Frontend",
  description: "Construye experiencias accesibles.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};

// Markup-like middle segments must render as text, never be interpreted.
const UNSAFE_DESCRIPTION =
  "Primer párrafo de la vacante.\n\n<script>alert('xss')</script>\n\nSegundo párrafo con <img src=x onerror=alert(1)> incrustado.\n\nLínea uno\nLínea dos.";

describe("JobDetailView validated rendering", () => {
  const fullJob: JobItem = {
    ...baseJob,
    location: "Monterrey, Nuevo León",
    salary_min: 30000,
    salary_max: 45000,
    published_at: "2026-02-14T09:30:00Z",
  };

  it("renders one article with the title, company, full metadata, and back navigation", () => {
    const { salary_min: min, salary_max: max, salary_currency: cur } = fullJob;
    const salary = formatSalary({ min, max, currency: cur });
    render(<JobDetailView job={fullJob} />);
    const view = within(screen.getByRole("article"));
    const h1 = view.getAllByRole("heading", { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveAccessibleName(fullJob.title);
    expect(view.getByText(fullJob.company.name)).toBeVisible();
    expect(view.getByText(fullJob.location!)).toBeVisible();
    expect(view.getByText(salary!)).toBeVisible();
    expect(view.getByText(/publicada/i)).toBeVisible();
    for (const label of ["Remoto", "Tiempo completo", "Senior"]) {
      expect(view.getByText(label, { exact: true })).toBeVisible();
    }
    const back = view.getByRole("link", { name: /volver a vacantes/i });
    expect(back).toHaveAttribute("href", "/vacantes");
  });

  it("renders the description as escaped plain text with paragraphs and line breaks", () => {
    const job = { ...baseJob, description: UNSAFE_DESCRIPTION };
    const { container } = render(<JobDetailView job={job} />);
    const article = container.querySelector("article");
    expect(article).not.toBeNull();
    expect(article!.querySelector("script")).toBeNull();
    expect(article!.querySelector("img")).toBeNull();
    expect(screen.getByText("<script>alert('xss')</script>")).toBeVisible();
    // Blank lines split paragraphs; a single break stays inside one paragraph.
    const paragraphs = screen.getAllByRole("paragraph");
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[3].textContent).toBe("Línea uno\nLínea dos.");
  });

  it("omits absent optional metadata instead of showing placeholders", () => {
    render(<JobDetailView job={baseJob} />);
    const article = screen.getByRole("article");
    expect(article).toBeVisible();
    expect(screen.queryByText(/publicada/i)).toBeNull();
    expect(screen.queryByText(/MXN|USD/)).toBeNull();
    expect(screen.queryByText(/Desde|Hasta/)).toBeNull();
    expect(article.textContent).not.toContain("undefined");
  });
});
