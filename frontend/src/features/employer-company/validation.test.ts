import { describe, expect, it } from "vitest";
import { normalizeWebsite, validateCompany } from "./validation";

const valid = { name: "Acme México", rfc: "aaa010101aaa", industryId: "industry-1" };

describe("company validation messages", () => {
  it("normalizes a valid company without field errors", () => {
    expect(validateCompany(valid)).toEqual({
      value: { name: "Acme México", rfc: "AAA010101AAA", industryId: "industry-1" },
      fields: {},
    });
  });

  it("explains the minimum name length in plain characters", () => {
    expect(validateCompany({ ...valid, name: " Acm " }).fields).toEqual({
      name: "El nombre debe tener al menos 4 caracteres.",
    });
  });

  it("requires exactly 12 RFC characters", () => {
    expect(validateCompany({ ...valid, rfc: "AAA010101AA" }).fields).toEqual({
      rfc: "El RFC debe tener exactamente 12 caracteres.",
    });
  });

  it("counts RFC characters, so Ñ and & count as one", () => {
    expect(validateCompany({ ...valid, rfc: " añb010101ab1 " })).toEqual({
      value: { ...valid, rfc: "AÑB010101AB1" },
      fields: {},
    });
    expect(validateCompany({ ...valid, rfc: "A&B010101AB1" }).fields).toEqual({});
    expect(validateCompany({ ...valid, rfc: "ÑAA010101AAAA" }).fields).toEqual({
      rfc: "El RFC debe tener exactamente 12 caracteres.",
    });
  });

  it("counts name characters, not bytes", () => {
    expect(validateCompany({ ...valid, name: "Añó" }).fields).toEqual({
      name: "El nombre debe tener al menos 4 caracteres.",
    });
    expect(validateCompany({ ...valid, name: "Añós" }).fields).toEqual({});
  });

  it("asks for an industry", () => {
    expect(validateCompany({ ...valid, industryId: " " }).fields).toEqual({
      industryId: "Selecciona una industria.",
    });
  });
});

describe("optional website (A4.5 «Tu empresa»)", () => {
  it("keeps today's value shape when no website is given (Configuración sends none)", () => {
    expect(validateCompany({ ...valid, website: "  " })).toEqual({ value: { name: "Acme México", rfc: "AAA010101AAA", industryId: "industry-1" }, fields: {} });
  });

  it.each([
    ["grupoaltavista.mx", "https://grupoaltavista.mx"],
    ["www.grupoaltavista.mx", "https://www.grupoaltavista.mx"],
    [" https://grupoaltavista.mx/empleos ", "https://grupoaltavista.mx/empleos"],
    ["http://grupoaltavista.mx", "http://grupoaltavista.mx"],
    ["HTTPS://Grupo-Altavista.com.mx", "https://Grupo-Altavista.com.mx"],
  ])("accepts %j with or without scheme or www → %s", (raw, website) => {
    expect(normalizeWebsite(raw)).toBe(website);
    expect(validateCompany({ ...valid, website: raw })).toEqual({ value: { name: "Acme México", rfc: "AAA010101AAA", industryId: "industry-1", website }, fields: {} });
  });

  it.each(["grupoaltavista", "https://", "grupo altavista.mx", "javascript:alert(1)", "ftp://grupo.mx", "-grupo.mx", "grupo..mx", `${"a".repeat(250)}.mx`])("rejects %j, which does not look like a domain", raw => {
    expect(normalizeWebsite(raw)).toBeNull();
    expect(validateCompany({ ...valid, website: raw }).fields).toEqual({ website: "Escribe un sitio válido, como grupoaltavista.mx." });
  });
});
