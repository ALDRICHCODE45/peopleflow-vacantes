import { expect, it } from "vitest";
import { groupMissing, MISSING_ITEMS } from "./publication-model";
it("maps all fourteen server codes and routes by owning module", () => {
 expect(Object.keys(MISSING_ITEMS)).toHaveLength(14);
 expect(MISSING_ITEMS.title_missing.label).toBe("Título");
 expect(MISSING_ITEMS.commitment_date_past.label).toBe("La fecha compromiso ya pasó");
 expect(MISSING_ITEMS.title_missing.href("id")).toBe("/empresa/vacantes/borradores/id");
 expect(MISSING_ITEMS.request_date_missing.href("id")).toBe("/empresa/vacantes/id/configuracion/solicitud");
 expect(MISSING_ITEMS.delivery_target_missing.href("id")).toBe("/empresa/vacantes/id/configuracion/entrega");
});
it("preserves server order within groups and handles unknown codes without crashing", () => {
 const groups = groupMissing(["commitment_date_past", "title_missing", "future", "description_missing"]);
 expect(groups.map(group => group.group)).toEqual(["entrega", "editor"]);
 expect(groups[1].items.map(item => item.label)).toEqual(["Título", "Otro requisito pendiente", "Descripción"]);
 expect(groups[1].items[1].href("id")).toBe("/empresa/vacantes/borradores/id");
 expect(groupMissing([])).toEqual([]);
});
