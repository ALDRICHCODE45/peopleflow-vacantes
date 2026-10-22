import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ArrowDownToLine, FileType2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocumentItem } from "./document-item";

afterEach(cleanup);

it("composes an outlined small document with icon, truncated filename, description and download actions", () => {
  const name = "CV de experiencia profesional y proyectos de desarrollo.pdf";
  const { container } = render(<DocumentItem title={name}
    description={<>Documento PDF · <Badge variant="accent">CV corregido por tu empresa</Badge></>}
    actions={<Button variant="outline" size="sm" nativeButton={false} render={<a href="/cv" download role="link" />} aria-label="Descargar CV de Frontend"><ArrowDownToLine aria-hidden="true" data-icon="inline-start" />Descargar CV</Button>} />);
  const item = container.querySelector('[data-slot="item"]')!;
  expect(item).toHaveAttribute("data-variant", "outline");
  expect(item).toHaveAttribute("data-size", "sm");
  expect(Array.from(item.children).map(child => child.getAttribute("data-slot"))).toEqual(["item-media", "item-content", "item-actions"]);
  expect(item.querySelector('[data-slot="item-media"]')).toHaveAttribute("data-variant", "icon");
  expect(item.querySelector('[data-slot="item-media"] > svg')).toHaveClass("lucide-file-text");
  expect(screen.getByTitle(name)).toHaveTextContent(name);
  expect(screen.getByText(name)).toHaveClass("truncate");
  expect(item.querySelector('[data-slot="item-title"]')).toHaveTextContent(name);
  expect(item.querySelector('[data-slot="item-description"]')).toHaveTextContent("Documento PDF · CV corregido por tu empresa");
  const link = screen.getByRole("link", { name: "Descargar CV de Frontend" });
  expect(item.querySelector('[data-slot="item-actions"]')).toContainElement(link);
  expect(link).toHaveAttribute("download");
  expect(item).toHaveClass("flex-wrap");
  expect(item.querySelector('[data-slot="item-actions"]')).toHaveClass("flex-wrap");
  expect(container.querySelector('[class*="basis-full"]')).toBeNull();
  for (const icon of item.querySelectorAll("svg")) expect(icon.getAttribute("class")).not.toMatch(/(?:size-|\bw-|\bh-)/);
});

it("accepts an alternate document icon and arbitrary description/actions", () => {
  const { container } = render(<DocumentItem icon={FileType2} title="cv.docx" description="Documento Word" actions={<a href="/word" download>Descargar Word</a>} />);
  expect(container.querySelector('[data-slot="item-media"] > svg')).toHaveClass("lucide-file-type-corner");
  expect(container.querySelector('[data-slot="item-title"]')).toHaveTextContent("cv.docx");
  expect(container.querySelector('[data-slot="item-actions"]')).toContainElement(screen.getByRole("link", { name: "Descargar Word" }));
});
it("lets the actions wrap below the content instead of squeezing it, and keeps the badge on its own wrap (QA L8)", () => {
  render(<DocumentItem title="CV.pdf" description="Documento PDF" badge={<Badge variant="accent">CV corregido por tu empresa</Badge>} actions={<a href="/cv">Descargar CV</a>} />);
  const content = document.querySelector('[data-slot="item-content"]')!;
  expect(content).toHaveClass("basis-40");
  const description = document.querySelector('[data-slot="item-description"]')!;
  expect(description).toHaveClass("flex", "flex-wrap");
  expect(description.textContent).not.toContain("·");
  expect(description).toHaveTextContent("Documento PDF");
  expect(screen.getByText("CV corregido por tu empresa")).toHaveAttribute("data-slot", "badge");
});
