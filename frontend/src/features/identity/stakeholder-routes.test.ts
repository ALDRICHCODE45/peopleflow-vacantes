import { expect, it } from "vitest";
import { STAKEHOLDER_HOME, isInvitationRoute, stakeholderRoute } from "./stakeholder-routes";

it("lets a stakeholder reach Métricas and the invitation pages only", () => {
  expect(STAKEHOLDER_HOME).toBe("/empresa/metricas");
  for (const path of ["/empresa/metricas", "/empresa/metricas/reclutadores/u1", "/empresa/invitacion", "/empresa/invitacion/abc_DEF-1"]) expect(stakeholderRoute(path)).toBe("allowed");
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
