import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SectionCards } from "./section-cards";
afterEach(cleanup);
it("renders endpoint counts without invented trends", () => {
  render(<SectionCards data={{ published_vacancies: 17, in_process: 26, pool_added_last_7_days: 9, positions: { covered: 3, required: 5 } }} />);
  for (const text of ["Vacantes publicadas", "17", "Candidatos en proceso", "26", "Nuevos en la base", "9", "Últimos 7 días", "Posiciones cubiertas", "3/5"]) expect(screen.getByText(text)).toBeInTheDocument();
  expect(document.querySelector("svg")).toBeNull();
});
