import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage, { metadata } from "./page";

afterEach(cleanup);

describe("/aviso-de-privacidad (provisional, L23)", () => {
  it("is public and never indexed", () => {
    expect(metadata.title).toBe("Aviso de privacidad");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("states that the text is provisional and shows only a neutral heading structure", () => {
    const { container } = render(<PrivacyPage />);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(screen.getByRole("note")).toHaveTextContent("Texto provisional: el texto legal definitivo se publicará antes del lanzamiento.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Aviso de privacidad");
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Responsable", "Datos que recabamos", "Finalidades", "Transferencias", "Derechos ARCO", "Cambios a este aviso", "Contacto",
    ]);
    expect(container.querySelectorAll("main section p")).toHaveLength(0);
  });

  it("links home and to the other provisional page", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("link", { name: "Términos y condiciones" })).toHaveAttribute("href", "/terminos");
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });
});
