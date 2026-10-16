import { expect, it } from "vitest";
import { formatPublishedSaveMissing, groupMissing, MISSING_ITEMS } from "./publication-model";
it("maps all fourteen server codes and routes by owning module", () => {
 expect(Object.keys(MISSING_ITEMS)).toHaveLength(14);
 expect(MISSING_ITEMS.title_missing.label).toBe("Título");
 expect(MISSING_ITEMS.commitment_date_past.label).toBe("La fecha compromiso ya pasó");
 expect(MISSING_ITEMS.title_missing.href("id")).toBe("/empresa/vacantes/borradores/id");
 expect(MISSING_ITEMS.request_date_missing.href("id")).toBe("/empresa/vacantes/id/configuracion/solicitud");
 expect(MISSING_ITEMS.delivery_target_missing.href("id")).toBe("/empresa/vacantes/id/configuracion/entrega");
});
it("uses consistent delivery labels and formats published save rejections in server order", () => {
 expect(MISSING_ITEMS.delivery_cutoff_missing.label).toBe("Columna de corte");
 expect(MISSING_ITEMS.delivery_target_missing.label).toBe("Objetivo de entrega");
 expect(formatPublishedSaveMissing(["delivery_target_missing", "title_missing", "future", "__proto__"])).toBe("No puedes dejarla sin: Objetivo de entrega, Título, Otro requisito pendiente, Otro requisito pendiente. Tus cambios siguen aquí.");
});
it("preserves server order within groups and handles unknown codes without crashing", () => {
 const groups = groupMissing(["commitment_date_past", "title_missing", "future", "description_missing"]);
 expect(groups.map(group => group.group)).toEqual(["entrega", "editor"]);
 expect(groups[1].items.map(item => item.label)).toEqual(["Título", "Otro requisito pendiente", "Descripción"]);
 expect(groups[1].items[1].href("id")).toBe("/empresa/vacantes/borradores/id");
 expect(groupMissing([])).toEqual([]);
});
