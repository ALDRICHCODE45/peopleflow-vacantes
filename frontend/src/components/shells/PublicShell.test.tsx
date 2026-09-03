import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { PublicShell } from "./PublicShell";

describe("PublicShell", () => {
  it("renders a main landmark containing the composed content", () => {
    const { container } = render(<PublicShell>contenido</PublicShell>);

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main).toHaveTextContent("contenido");
  });

  it("renders exactly one Vacantes link to /vacantes", () => {
    const { container } = render(<PublicShell>contenido</PublicShell>);

    const vacantesLinks = Array.from(container.querySelectorAll("a")).filter(
      (a) => a.getAttribute("href") === "/vacantes",
    );
    expect(vacantesLinks).toHaveLength(1);
    expect(vacantesLinks[0]).toHaveTextContent(/vacantes/i);
  });

  it("renders the PeopleFlow brand identity", () => {
    const { container } = render(<PublicShell>contenido</PublicShell>);

    const brandImage = container.querySelector("img[alt*='PeopleFlow' i]");
    expect(brandImage).not.toBeNull();
  });

  it("renders a restrained footer", () => {
    const { container } = render(<PublicShell>contenido</PublicShell>);

    expect(container.querySelector("footer")).not.toBeNull();
  });

  it("renders no out-of-scope actions or links", () => {
    const { container } = render(<PublicShell>contenido</PublicShell>);

    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    for (const href of hrefs) {
      expect(["/", "/vacantes"]).toContain(href);
    }
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container).not.toHaveTextContent(
      /(iniciar|inicia)\s+sesi[oó]n|publicar|empleador|t[eé]rminos|privacidad|tema|candidato/i,
    );
  });
});
