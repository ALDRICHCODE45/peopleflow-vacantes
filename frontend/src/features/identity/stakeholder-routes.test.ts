import { expect, it } from "vitest";
import { STAKEHOLDER_HOME, STAKEHOLDER_VACANCIES, isInvitationRoute, stakeholderRoute } from "./stakeholder-routes";

const ID = "123e4567-e89b-42d3-a456-426614174000";

it("lets a stakeholder reach Métricas and the invitation pages only", () => {
  expect(STAKEHOLDER_HOME).toBe("/empresa/metricas");
  for (const path of ["/empresa/metricas", "/empresa/metricas/reclutadores", "/empresa/metricas/reclutadores/u1", "/empresa/invitacion", "/empresa/invitacion/abc_DEF-1"]) expect(stakeholderRoute(path)).toBe("allowed");
});

// S11/S12: the read-only «Vacantes» list and the Documentos tab of one vacancy; nothing else under /empresa/vacantes.
it("lets a stakeholder reach the vacancy list and the Documentos tab of a vacancy, and nothing else", () => {
  expect(STAKEHOLDER_VACANCIES).toBe("/empresa/stakeholder/vacantes");
  for (const path of [STAKEHOLDER_VACANCIES, `/empresa/vacantes/${ID}/documentos`, `/empresa/vacantes/${ID.toUpperCase()}/documentos`]) expect(stakeholderRoute(path)).toBe("allowed");
});

it.each([
  "/empresa/vacantes", `/empresa/vacantes/${ID}`, `/empresa/vacantes/${ID}/pipeline`, `/empresa/vacantes/${ID}/configuracion`, `/empresa/vacantes/${ID}/documentos/otra`, `/empresa/vacantes/${ID}/documentos/`,
  "/empresa/vacantes/borradores/nuevo", "/empresa/vacantes/borradores/documentos", "/empresa/vacantes/no-es-un-uuid/documentos", `/empresa/vacantes/${ID} /documentos`, `/empresa/vacantes/${ID}x/documentos`,
  "/empresa/stakeholder", "/empresa/stakeholder/vacantes/otra", "/empresa/stakeholder/vacantes/", "/empresa/stakeholder/vacantes-extra", "/empresa/stakeholder/otra",
])("keeps %s blocked for a stakeholder", path => {
  expect(stakeholderRoute(path)).toBe("blocked");
});

it("sends a stakeholder opening the employer landing to Métricas", () => {
  expect(stakeholderRoute("/empresa/dashboard")).toBe("landing");
  expect(stakeholderRoute("/empresa")).toBe("landing");
});

it("blocks every other employer route, including look-alike prefixes", () => {
  for (const path of ["/empresa/vacantes", "/empresa/equipo", "/empresa/talento", "/empresa/sitio", "/empresa/configuracion", "/empresa/auditoria", "/empresa/mi-historial", "/empresa/metricas-extra", "/empresa/invitaciones", null]) {
    expect(stakeholderRoute(path)).toBe("blocked");
  }
});

it("recognizes the invitation pages, with or without a token", () => {
  expect(isInvitationRoute("/empresa/invitacion")).toBe(true);
  expect(isInvitationRoute("/empresa/invitacion/token")).toBe(true);
  expect(isInvitationRoute("/empresa/invitaciones")).toBe(false);
  expect(isInvitationRoute(null)).toBe(false);
});
