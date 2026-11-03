import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PersonField, sortPeople } from "./controls";
import { createFixtureClient } from "./prototype-client";
afterEach(cleanup);
// Opening the Combobox popup loops in jsdom (rules §13.7): the order is a pure function, the open list is browser QA.
it("sorts people with es-MX collation without mutating the caller's list", async () => {
  const company = await createFixtureClient("owner").getCompanyMembers();
  const names = ["Zoe", "Ñora", "Álvaro", "Nora", "Ana"];
  const members = names.map((name, i) => ({ ...company.members[0], id: `member-${i}`, user: { ...company.members[0].user, id: `user-${i}`, full_name: name } }));
  expect(sortPeople(members).map(member => member.user.full_name)).toEqual(["Álvaro", "Ana", "Nora", "Ñora", "Zoe"]);
  expect(members.map(member => member.user.full_name)).toEqual(names);
});
it("renders the picker closed with its label and selected person", async () => {
  const company = await createFixtureClient("owner").getCompanyMembers();
  const selected = company.members[0];
  render(<PersonField id="person" label="Persona" members={company.members} value={selected.user.id} onChange={() => {}} />);
  expect(screen.getByLabelText("Persona")).toHaveValue(selected.user.full_name);
});
