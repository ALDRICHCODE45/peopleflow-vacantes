import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DraftEditErrorState } from "./error-state";

afterEach(cleanup);
it.each([
  ["invalid_id","No encontramos este borrador","/empresa/vacantes"],
  ["not_found","No encontramos este borrador","/empresa/vacantes"],
  ["unauthenticated","Tu sesión expiró","/empresa/login"],
  ["forbidden","No tienes permiso para abrirlo","/empresa/vacantes"],
  ["company_inactive","Falta configurar tu empresa","/empresa/configuracion"],
  ["company_not_active","Falta configurar tu empresa","/empresa/configuracion"],
  ["server_error","El servidor tuvo un problema","/empresa/vacantes"],
  ["no_response","No hubo respuesta del servidor","/empresa/vacantes"],
  ["unrecognized_response","No pudimos confirmar el resultado","/empresa/vacantes"],
] as const)("shows a safe page-level Empty for %s", (reason,title,href) => {
  const {container} = render(<DraftEditErrorState reason={reason} />);
  expect(screen.getByRole("heading",{name:title,level:2})).toBeVisible();
  expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
  expect(screen.getByRole("link")).toHaveAttribute("href",href);
  expect(screen.getByRole("link")).toHaveClass("min-h-10");
  expect(container).not.toHaveTextContent(/token|cookie|internal_error|invalid_id/);
});
