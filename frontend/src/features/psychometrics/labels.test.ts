import { expect, it } from "vitest";
import { COMPETENCY_IDS, FACET_IDS } from "./model";
import { bandLabels, competencyLabels, facetLabels, fitLabels, importanceLabels, signalReason, tierLabels, tierMessages } from "./labels";
it("labels every canonical display id without aliases or diagnostic facet names", () => {
  expect(Object.keys(competencyLabels)).toEqual([...COMPETENCY_IDS]);
  expect(Object.keys(facetLabels)).toEqual([...FACET_IDS]);
  expect(Object.values(bandLabels)).toEqual(["Bajo", "Medio", "Alto"]);
  expect(Object.values(fitLabels)).toEqual(["Alineado", "Por explorar", "Foco de atención"]);
  expect(Object.values(importanceLabels)).toEqual(["Clave", "Importante", "No relevante"]);
  expect(Object.values(tierLabels)).toEqual(["Sin señales", "Algunas señales", "Señales relevantes"]);
  expect(tierMessages["tier.sin"]).toBe("No se detectaron patrones que requieran seguimiento con la información disponible. Esto no confirma por sí solo la calidad de las respuestas.");
  expect(Object.values(facetLabels).join(" ")).not.toMatch(/Ansiedad|Vulnerabilidad|Debilidad|Liberalismo/);
});
it("never invents a reason or zeroes for unknown or untriggered signals", () => {
  expect(signalReason({ id: "signal.fast", severity: "unknown", counts: null })).toBeNull();
  expect(signalReason({ id: "signal.attention", severity: "none", counts: { misses: 0, total: 3 } })).toBeNull();
  expect(signalReason({ id: "signal.fast", severity: "strong", counts: { fast_count: 30, total: 60 } })).toBe("Se registraron menos de 2 segundos en 30 de 60 frases. El tiempo registrado puede ser incompleto o modificable; pregunta cómo se respondió.");
});
