import { afterEach, expect, it } from "vitest";
import { companyReceives, PROFILE_VISIBILITY, sectionVisibility, visibleToCompany } from "./visibility";

const original = { ...PROFILE_VISIBILITY };
afterEach(() => { Object.assign(PROFILE_VISIBILITY, original); });

it("holds the backend-confirmed visibility of every profile fact in one map", () => {
  expect(Object.entries(PROFILE_VISIBILITY).filter(([, audience]) => audience === "company").map(([field]) => field))
    .toEqual(["fullName", "email", "phone", "location", "professionalTitle", "yearsOfExperience", "seniority", "educationLevel", "skills", "languages"]);
  expect(Object.entries(PROFILE_VISIBILITY).filter(([, audience]) => audience === "private").map(([field]) => field))
    .toEqual(["birthDate", "linkedinUrl", "portfolioUrl", "currentCompany", "summary", "educationDetails", "currentSalaryGross", "currentSalaryNet", "expectedSalary", "expectedSalaryPeriod", "salaryCurrency"]);
});

it("tags each section from the map", () => {
  expect(sectionVisibility("experience")).toBe("mixed");
  expect(sectionVisibility("education")).toBe("mixed");
  expect(sectionVisibility("personal")).toBe("mixed");
  expect(sectionVisibility("languages")).toBe("company");
  expect(sectionVisibility("compensation")).toBe("private");
});

it("writes «Qué recibe la empresa» from the map", () => {
  expect(companyReceives()).toEqual({
    company: "Nombre, correo, teléfono, ubicación, título profesional, años de experiencia, seniority, tu nivel de estudios más alto, habilidades e idiomas.",
    private: "Solo tú ves tu fecha de nacimiento, LinkedIn, portafolio, empresa actual, resumen profesional, los detalles de tus estudios y tu compensación.",
  });
  PROFILE_VISIBILITY.professionalTitle = "private";
  expect(visibleToCompany("professionalTitle")).toBe(false);
  expect(companyReceives().company).not.toContain("título profesional");
  expect(companyReceives().private).toContain("título profesional");
});
