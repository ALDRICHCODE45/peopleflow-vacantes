import { expect, it } from "vitest";
import { publicationStatus } from "./publication-status";

it.each([
  [null, "Borrador", "info"],
  ["published", "Activa", "accent"],
  ["paused", "Pausada", "review"],
  ["closed", "Cerrada · proceso en curso", "neutral"],
  [undefined, "Estado por confirmar", "neutral"],
] as const)("maps publication %s without conflating process state", (publication, label, variant) => {
  expect(publicationStatus(publication)).toMatchObject({ label, variant });
});
it("includes the finished process in the header badge", () => {
  expect(publicationStatus("closed", "accent", "finished").label).toBe("Cerrada · proceso finalizado");
});
it("preserves the editor's validated published variant", () => {
  expect(publicationStatus("published", "success")).toMatchObject({ label: "Activa", variant: "success" });
});
