import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { cv } from "@/features/candidate-cvs/test-fixtures";
import { CvPreview } from "./cv-preview";

const word = { ...cv, name: "CV Almacén.docx", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const };
afterEach(cleanup);

describe("CvPreview", () => {
  it("renders an honest A4 page for a PDF: format icon, name, format and size, and «Vista previa próximamente»", () => {
    render(<CvPreview cv={cv} />);
    const page = screen.getByRole("figure", { name: `Vista previa de ${cv.name}` });
    expect(page).toHaveAttribute("data-state", "placeholder");
    expect(page).toHaveClass("aspect-[210/297]");
    expect(page.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(cv.name)).toBeInTheDocument();
    expect(screen.getByText("PDF · 340 KB")).toBeInTheDocument();
    expect(screen.getByText("Vista previa próximamente")).toBeInTheDocument();
    expect(page.querySelector("img")).toBeNull();
  });
  it("says a Word file has no browser preview and to download it", () => {
    render(<CvPreview cv={word} />);
    expect(screen.getByText("Word · 340 KB")).toBeInTheDocument();
    expect(screen.getByText("Sin vista previa en el navegador. Descárgalo para verlo.")).toBeInTheDocument();
    expect(screen.queryByText("Vista previa próximamente")).toBeNull();
  });
  it("keeps the format line but drops the name in the compact slot of an expanded row", () => {
    render(<CvPreview cv={cv} size="compact" />);
    expect(screen.queryByText(cv.name)).toBeNull();
    expect(screen.getByText("PDF · 340 KB")).toBeInTheDocument();
    expect(screen.getByText("Vista previa próximamente")).toBeInTheDocument();
  });
  it("shows a real first-page image when a source is plugged in, instead of the placeholder", () => {
    render(<CvPreview cv={cv} src="blob:first-page" />);
    const page = screen.getByRole("figure", { name: `Vista previa de ${cv.name}` });
    expect(page).toHaveAttribute("data-state", "page");
    expect(screen.getByRole("img", { name: `Primera página de ${cv.name}` })).toHaveAttribute("src", "blob:first-page");
    expect(screen.queryByText("Vista previa próximamente")).toBeNull();
  });
  it("lets a custom renderer draw the page; it wins over the image source", () => {
    render(<CvPreview cv={cv} src="blob:first-page" renderPage={doc => <canvas aria-label={`Lienzo de ${doc.name}`} />} />);
    expect(screen.getByLabelText(`Lienzo de ${cv.name}`)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: `Primera página de ${cv.name}` })).toBeNull();
  });
});
