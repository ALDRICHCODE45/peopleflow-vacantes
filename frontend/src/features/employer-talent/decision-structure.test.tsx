import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TalentTable } from "./talent-table";
import { TALENT_PEOPLE } from "./prototype-talent";

afterEach(cleanup);
it("keeps numeric application counts as text and exposes omitted skills through the real person detail", () => {
  const person = TALENT_PEOPLE[0];
  const onSelectPerson = vi.fn();
  const { container } = render(<TalentTable people={[person]} onSelectPerson={onSelectPerson} selectedPersonId={null} />);
  const row = container.querySelector(`[data-pf-talento-row="${person.id}"]`)! as HTMLElement;
  const count = within(row).getByText("2 postulaciones");
  expect(count.closest('[data-slot="badge"]')).toBeNull();
  const more = within(row).getByRole("button", { name: "y 2 habilidades más de Gabriela Soto" });
  expect(more).toBeVisible();
  fireEvent.click(more);
  expect(onSelectPerson).toHaveBeenCalledExactlyOnceWith(person.id);
  expect(screen.getByRole("button", { name: person.fullName })).toHaveClass("min-h-10");
});
