import { candidateIdentitySchema, candidateProfileSchema } from "./model";
import type { CandidateIdentity, CandidateProfile } from "./model";

/**
 * The fictional candidate who owns this prototype workspace: Ximena Barrera, a
 * made-up Mexican frontend engineer. Every value below — identity, contact
 * details, skills, languages, and salary expectations — is authored local demo
 * content validated at this module boundary and never fetched or persisted.
 *
 * Exactly one candidate exists here: the self-service identity plus the profile
 * it owns, both aligned with the backend response shapes.
 */
const IDENTITY_SOURCE: CandidateIdentity = {
  userId: "6f1a3c2e-9b4d-4e7a-8c2f-5d3b1a9e7f04",
  email: "ximena.barrera@correo.mx",
  fullName: "Ximena Barrera",
  userType: "candidate",
};

const PROFILE_SOURCE: CandidateProfile = {
  phone: "+52 55 4821 7790",
  linkedinUrl: "https://www.linkedin.com/in/ximena-barrera",
  portfolioUrl: "https://ximenabarrera.dev",
  professionalTitle: "Desarrolladora Frontend Senior",
  currentCompany: "Ámbar Studio",
  yearsOfExperience: 9,
  summary: "Frontend senior con nueve años construyendo interfaces accesibles para productos financieros y de salud.",
  birthDate: "1994-06-18",
  city: "Ciudad de México",
  country: "México",
  educationLevel: "bachelor",
  fieldOfStudy: "Ingeniería en Sistemas Computacionales",
  skills: ["react", "typescript", "node.js", "design systems"],
  currentSalaryGross: 62000,
  currentSalaryNet: 48000,
  expectedSalary: 75000,
  salaryCurrency: "MXN",
  expectedSalaryPeriod: "monthly",
  languages: [
    { name: "español", level: "C2" },
    { name: "inglés", level: "B2" },
  ],
  createdAt: "2026-02-01T09:00:00-06:00",
  updatedAt: "2026-03-15T18:30:00-06:00",
};

/** Freezes a value and every plain object reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** The one frozen prototype candidate identity. */
export const CANDIDATE_IDENTITY: CandidateIdentity = deepFreeze(candidateIdentitySchema.parse(IDENTITY_SOURCE));

/** The frozen profile owned by {@link CANDIDATE_IDENTITY}; same candidate, no server-side CV storage key. */
export const CANDIDATE_PROFILE: CandidateProfile = deepFreeze(candidateProfileSchema.parse(PROFILE_SOURCE));
