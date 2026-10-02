import {
  parseTalentPeople,
  type TalentAvailability,
  type TalentIndustry,
  type TalentLanguage,
  type TalentLocation,
  type TalentModality,
  type TalentPerson,
  type TalentSkill,
  type TalentSource,
  type TalentStage,
} from "./model";

/**
 * The fictional employer of this workspace is Nexo Labs. Every person and every
 * application below is authored local demo content: validated by
 * `parseTalentPeople` at this module boundary, then deeply frozen. Nothing is
 * fetched, persisted or sent anywhere, and no name is reused from another
 * prototype surface.
 *
 * Applications reference the committed Nexo vacancy ids so the talent base and
 * the vacancy portfolio share one vocabulary, but the histories are authored
 * here from scratch: they are never inferred from another fixture.
 */

/** `[vacancyId, stage, source, appliedAt]` — compact and fully explicit. */
type TalentApplicationSeed = readonly [
  vacancyId: string,
  stage: TalentStage,
  source: TalentSource,
  appliedAt: string,
];

type TalentPersonSeed = {
  readonly id: string;
  readonly fullName: string;
  readonly professionalTitle: string;
  readonly location: TalentLocation;
  readonly industry: TalentIndustry;
  readonly currentCompany: string;
  readonly yearsOfExperience: number;
  readonly skills: readonly TalentSkill[];
  readonly education: string;
  readonly languages: readonly TalentLanguage[];
  readonly preferredModality: TalentModality;
  readonly availability: TalentAvailability;
  readonly applications: readonly TalentApplicationSeed[];
};

const TALENT_SEEDS: readonly TalentPersonSeed[] = [
  {
    id: "gabriela-soto", fullName: "Gabriela Soto", professionalTitle: "Frontend Engineer",
    location: "Guadalajara", industry: "Tecnología", currentCompany: "Pixelaria", yearsOfExperience: 5,
    skills: ["React", "TypeScript", "Next.js", "Tailwind CSS"],
    education: "Licenciatura en Ingeniería en Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "hybrid", availability: "two_weeks",
    applications: [
      ["frontend-engineer-react", "in_review", "linkedin", "2026-03-11T15:00:00Z"],
      ["fullstack-developer", "submitted", "direct", "2026-03-14T09:30:00Z"],
    ],
  },
  {
    id: "ricardo-mendoza", fullName: "Ricardo Mendoza", professionalTitle: "Backend Developer Senior",
    location: "CDMX", industry: "Fintech", currentCompany: "Banca Móvil MX", yearsOfExperience: 9,
    skills: ["Node.js", "PostgreSQL", "AWS", "Docker"],
    education: "Maestría en Ciencias de la Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "immediate",
    applications: [["backend-developer-senior", "hired", "referral", "2026-02-20T17:10:00Z"]],
  },
  {
    id: "ana-lucia-pineda", fullName: "Ana Lucía Pineda", professionalTitle: "QA Automation Engineer",
    location: "Monterrey", industry: "Manufactura", currentCompany: "Acero Norte", yearsOfExperience: 6,
    skills: ["Playwright", "Testing", "TypeScript", "CI/CD"],
    education: "Licenciatura en Ingeniería Industrial",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "onsite", availability: "one_month",
    applications: [
      ["qa-automation-engineer", "rejected", "job_board", "2026-01-25T14:00:00Z"],
      ["data-analyst", "in_review", "direct", "2026-02-10T11:20:00Z"],
    ],
  },
  {
    id: "sergio-tapia", fullName: "Sergio Tapia", professionalTitle: "DevOps Engineer",
    location: "Querétaro", industry: "Tecnología", currentCompany: "Nube Andina", yearsOfExperience: 8,
    skills: ["Kubernetes", "Terraform", "AWS", "CI/CD", "Docker"],
    education: "Licenciatura en Ingeniería en Sistemas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "immediate",
    applications: [["devops-engineer", "submitted", "linkedin", "2026-03-13T08:45:00Z"]],
  },
  {
    id: "valeria-cordova", fullName: "Valeria Córdova", professionalTitle: "Data Analyst",
    location: "Mérida", industry: "Educación", currentCompany: "Instituto Peninsular", yearsOfExperience: 4,
    skills: ["SQL", "Python", "PostgreSQL"],
    education: "Licenciatura en Actuaría",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "hybrid", availability: "two_weeks",
    applications: [
      ["data-analyst", "in_review", "referral", "2026-02-12T16:05:00Z"],
      ["backend-developer-senior", "rejected", "job_board", "2026-01-30T10:40:00Z"],
    ],
  },
  {
    id: "hector-rivera", fullName: "Héctor Rivera", professionalTitle: "Fullstack Developer",
    location: "Guadalajara", industry: "Comercio", currentCompany: "Tienda Central", yearsOfExperience: 7,
    skills: ["React", "Node.js", "TypeScript", "MongoDB"],
    education: "Licenciatura en Ingeniería en Software",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "hybrid", availability: "immediate",
    applications: [["fullstack-developer", "submitted", "direct", "2026-03-15T13:25:00Z"]],
  },
  {
    id: "paulina-ortega", fullName: "Paulina Ortega", professionalTitle: "Frontend Engineer",
    location: "CDMX", industry: "Salud", currentCompany: "Salud Digital", yearsOfExperience: 3,
    skills: ["React", "JavaScript", "Tailwind CSS", "UX"],
    education: "Licenciatura en Diseño de Interfaces",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "remote", availability: "to_confirm",
    applications: [["frontend-engineer-react", "submitted", "job_board", "2026-03-13T12:15:00Z"]],
  },
  {
    id: "emilio-cardenas", fullName: "Emilio Cárdenas", professionalTitle: "Backend Developer",
    location: "Monterrey", industry: "Logística", currentCompany: "Ruta Logística", yearsOfExperience: 11,
    skills: ["Java", "Spring", "PostgreSQL", "Redis"],
    education: "Licenciatura en Ingeniería en Sistemas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "onsite", availability: "one_month",
    applications: [
      ["backend-developer-senior", "in_review", "linkedin", "2026-03-05T09:05:00Z"],
      ["fullstack-developer", "rejected", "direct", "2026-01-18T15:30:00Z"],
    ],
  },
  {
    id: "renata-guerrero", fullName: "Renata Guerrero", professionalTitle: "QA Automation Engineer",
    location: "Puebla", industry: "Tecnología", currentCompany: "Pruebas Ágiles", yearsOfExperience: 5,
    skills: ["Playwright", "Testing", "JavaScript"],
    education: "Licenciatura en Ingeniería en Sistemas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "hybrid", availability: "two_weeks",
    applications: [["qa-automation-engineer", "hired", "referral", "2026-01-22T11:50:00Z"]],
  },
  {
    id: "diego-molina", fullName: "Diego Molina", professionalTitle: "DevOps Engineer",
    location: "Tijuana", industry: "Manufactura", currentCompany: "Electrónica Frontera", yearsOfExperience: 10,
    skills: ["Kubernetes", "Docker", "AWS", "Terraform", "Go"],
    education: "Maestría en Ingeniería de Software",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "onsite", availability: "one_month",
    applications: [["devops-engineer", "in_review", "direct", "2026-03-02T14:35:00Z"]],
  },
  {
    id: "ximena-vargas", fullName: "Ximena Vargas", professionalTitle: "Data Analyst",
    location: "León", industry: "Comercio", currentCompany: "Comercio del Bajío", yearsOfExperience: 3,
    skills: ["SQL", "Python", "MongoDB"],
    education: "Licenciatura en Economía",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "hybrid", availability: "immediate",
    applications: [["data-analyst", "submitted", "linkedin", "2026-02-25T10:55:00Z"]],
  },
  {
    id: "rodrigo-espinoza", fullName: "Rodrigo Espinoza", professionalTitle: "Fullstack Developer",
    location: "Guadalajara", industry: "Fintech", currentCompany: "Pagos del Pacífico", yearsOfExperience: 6,
    skills: ["React", "Node.js", "PostgreSQL", "Docker", "GraphQL"],
    education: "Licenciatura en Ingeniería en Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "two_weeks",
    applications: [
      ["fullstack-developer", "hired", "referral", "2026-02-28T18:20:00Z"],
      ["backend-developer-senior", "submitted", "direct", "2026-03-14T08:10:00Z"],
    ],
  },
  {
    id: "camila-solorzano", fullName: "Camila Solórzano", professionalTitle: "Frontend Engineer",
    location: "Mérida", industry: "Educación", currentCompany: "Aula Digital", yearsOfExperience: 4,
    skills: ["React", "Next.js", "TypeScript", "Figma"],
    education: "Licenciatura en Diseño Gráfico",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "immediate",
    applications: [["frontend-engineer-react", "rejected", "job_board", "2026-02-01T09:40:00Z"]],
  },
  {
    id: "joaquin-herrera", fullName: "Joaquín Herrera", professionalTitle: "Backend Developer Senior",
    location: "Querétaro", industry: "Tecnología", currentCompany: "Plataforma Central", yearsOfExperience: 12,
    skills: ["Go", "PostgreSQL", "Kubernetes", "AWS"],
    education: "Maestría en Ciencias de la Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "hybrid", availability: "one_month",
    applications: [["backend-developer-senior", "submitted", "linkedin", "2026-03-12T17:00:00Z"]],
  },
  {
    id: "fernanda-ibarra", fullName: "Fernanda Ibarra", professionalTitle: "QA Automation Engineer",
    location: "CDMX", industry: "Fintech", currentCompany: "Cartera Segura", yearsOfExperience: 7,
    skills: ["Playwright", "Testing", "CI/CD", "TypeScript"],
    education: "Licenciatura en Ingeniería en Software",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "two_weeks",
    applications: [
      ["qa-automation-engineer", "in_review", "referral", "2026-02-18T13:30:00Z"],
      ["devops-engineer", "submitted", "direct", "2026-03-10T10:05:00Z"],
    ],
  },
  {
    id: "alejandro-nunez", fullName: "Alejandro Núñez", professionalTitle: "Data Analyst",
    location: "Monterrey", industry: "Manufactura", currentCompany: "Industrias del Norte", yearsOfExperience: 9,
    skills: ["SQL", "Python", "PostgreSQL", "AWS"],
    education: "Licenciatura en Ingeniería Industrial",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "onsite", availability: "to_confirm",
    applications: [["data-analyst", "rejected", "job_board", "2026-01-28T16:45:00Z"]],
  },
  {
    id: "mariana-palacios", fullName: "Mariana Palacios", professionalTitle: "Fullstack Developer",
    location: "Puebla", industry: "Salud", currentCompany: "Clínica Conectada", yearsOfExperience: 5,
    skills: ["React", "Node.js", "MySQL", "TypeScript"],
    education: "Licenciatura en Ingeniería en Sistemas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "hybrid", availability: "immediate",
    applications: [["fullstack-developer", "in_review", "direct", "2026-03-09T12:00:00Z"]],
  },
  {
    id: "sebastian-camacho", fullName: "Sebastián Camacho", professionalTitle: "DevOps Engineer",
    location: "Guadalajara", industry: "Tecnología", currentCompany: "Servicios SaaS", yearsOfExperience: 4,
    skills: ["Docker", "AWS", "CI/CD", "Terraform"],
    education: "Licenciatura en Ingeniería en Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "two_weeks",
    applications: [["devops-engineer", "rejected", "job_board", "2026-02-05T15:15:00Z"]],
  },
  {
    id: "natalia-fuentes", fullName: "Natalia Fuentes", professionalTitle: "Frontend Engineer",
    location: "CDMX", industry: "Tecnología", currentCompany: "Producto Vivo", yearsOfExperience: 8,
    skills: ["React", "Next.js", "TypeScript", "Testing", "Figma"],
    education: "Licenciatura en Ingeniería en Software",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "hybrid", availability: "immediate",
    applications: [["frontend-engineer-react", "hired", "referral", "2026-03-01T11:35:00Z"]],
  },
  {
    id: "ignacio-bravo", fullName: "Ignacio Bravo", professionalTitle: "Backend Developer",
    location: "León", industry: "Logística", currentCompany: "Carga Express", yearsOfExperience: 6,
    skills: ["Node.js", "MongoDB", "Redis", "Docker"],
    education: "Licenciatura en Ingeniería en Sistemas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "onsite", availability: "one_month",
    applications: [["backend-developer-senior", "rejected", "direct", "2026-02-08T10:25:00Z"]],
  },
  {
    id: "lucia-montes", fullName: "Lucía Montes", professionalTitle: "Data Analyst",
    location: "Querétaro", industry: "Tecnología", currentCompany: "Analítica Aplicada", yearsOfExperience: 5,
    skills: ["SQL", "Python", "PostgreSQL", "GraphQL"],
    education: "Licenciatura en Matemáticas Aplicadas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "immediate",
    applications: [["data-analyst", "hired", "linkedin", "2026-02-16T14:50:00Z"]],
  },
  {
    id: "mauricio-rosas", fullName: "Mauricio Rosas", professionalTitle: "Arquitecto de Software",
    location: "Tijuana", industry: "Fintech", currentCompany: "Pagos Frontera", yearsOfExperience: 14,
    skills: ["Java", "Spring", "AWS", "Kubernetes"],
    education: "Maestría en Ingeniería de Software",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "one_month",
    applications: [["backend-developer-senior", "hired", "referral", "2026-02-22T09:20:00Z"]],
  },
  {
    id: "daniela-acosta", fullName: "Daniela Acosta", professionalTitle: "QA Automation Engineer",
    location: "Mérida", industry: "Educación", currentCompany: "Escuela en Línea", yearsOfExperience: 3,
    skills: ["Testing", "Playwright", "JavaScript"],
    education: "Licenciatura en Ingeniería en Software",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "hybrid", availability: "two_weeks",
    applications: [["qa-automation-engineer", "submitted", "job_board", "2026-03-11T13:40:00Z"]],
  },
  {
    id: "pablo-esquivel", fullName: "Pablo Esquivel", professionalTitle: "Fullstack Developer",
    location: "Monterrey", industry: "Comercio", currentCompany: "Mercado Regio", yearsOfExperience: 10,
    skills: ["React", "Node.js", "PostgreSQL", "AWS", "Docker"],
    education: "Licenciatura en Ingeniería en Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "hybrid", availability: "immediate",
    applications: [
      ["fullstack-developer", "in_review", "linkedin", "2026-03-06T16:10:00Z"],
      ["frontend-engineer-react", "submitted", "direct", "2026-03-13T09:55:00Z"],
    ],
  },
  {
    id: "alejandra-sandoval", fullName: "Alejandra Sandoval", professionalTitle: "Frontend Engineer",
    location: "Puebla", industry: "Manufactura", currentCompany: "Grupo Automotriz", yearsOfExperience: 2,
    skills: ["React", "JavaScript", "Tailwind CSS"],
    education: "Licenciatura en Diseño Digital",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "basic" }],
    preferredModality: "onsite", availability: "immediate",
    applications: [["frontend-engineer-react", "in_review", "referral", "2026-03-10T08:30:00Z"]],
  },
  {
    id: "cristian-peralta", fullName: "Cristian Peralta", professionalTitle: "DevOps Engineer",
    location: "CDMX", industry: "Tecnología", currentCompany: "Plataforma Urbana", yearsOfExperience: 7,
    skills: ["Kubernetes", "Terraform", "CI/CD", "Go", "AWS"],
    education: "Licenciatura en Ingeniería en Sistemas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "two_weeks",
    applications: [["devops-engineer", "hired", "direct", "2026-02-26T12:05:00Z"]],
  },
  {
    id: "isabela-rojas", fullName: "Isabela Rojas", professionalTitle: "Data Analyst",
    location: "Guadalajara", industry: "Salud", currentCompany: "Datos Clínicos", yearsOfExperience: 6,
    skills: ["SQL", "Python", "Testing"],
    education: "Licenciatura en Bioestadística",
    languages: [
      { name: "Español", level: "native" },
      { name: "Inglés", level: "advanced" },
      { name: "Francés", level: "basic" },
    ],
    preferredModality: "hybrid", availability: "two_weeks",
    applications: [
      ["data-analyst", "in_review", "referral", "2026-02-13T11:30:00Z"],
      ["backend-developer-senior", "submitted", "job_board", "2026-03-08T15:45:00Z"],
    ],
  },
  {
    id: "andres-galvan", fullName: "Andrés Galván", professionalTitle: "Backend Developer",
    location: "Querétaro", industry: "Tecnología", currentCompany: "Servicios Integrados", yearsOfExperience: 5,
    skills: ["Node.js", "PostgreSQL", "Redis", "TypeScript"],
    education: "Licenciatura en Ingeniería en Software",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "hybrid", availability: "immediate",
    applications: [
      ["backend-developer-senior", "in_review", "direct", "2026-03-07T10:15:00Z"],
      ["fullstack-developer", "rejected", "linkedin", "2026-01-29T14:20:00Z"],
    ],
  },
  {
    id: "paola-madrigal", fullName: "Paola Madrigal", professionalTitle: "QA Automation Engineer",
    location: "León", industry: "Comercio", currentCompany: "Retail Bajío", yearsOfExperience: 8,
    skills: ["Testing", "Playwright", "CI/CD", "Python"],
    education: "Licenciatura en Ingeniería en Sistemas",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "one_month",
    applications: [["qa-automation-engineer", "rejected", "job_board", "2026-02-03T09:10:00Z"]],
  },
  {
    id: "santiago-lozano", fullName: "Santiago Lozano", professionalTitle: "Fullstack Developer",
    location: "Mérida", industry: "Tecnología", currentCompany: "Estudio Nueva Ola", yearsOfExperience: 3,
    skills: ["React", "Node.js", "MongoDB", "JavaScript"],
    education: "Licenciatura en Ingeniería en Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "remote", availability: "immediate",
    applications: [["fullstack-developer", "submitted", "linkedin", "2026-03-15T16:30:00Z"]],
  },
  {
    id: "catalina-bustamante", fullName: "Catalina Bustamante", professionalTitle: "Data Analyst",
    location: "Tijuana", industry: "Logística", currentCompany: "Cadena Costera", yearsOfExperience: 4,
    skills: ["SQL", "Python", "PostgreSQL"],
    education: "Licenciatura en Ingeniería Industrial",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "intermediate" }],
    preferredModality: "onsite", availability: "two_weeks",
    applications: [["data-analyst", "submitted", "direct", "2026-02-27T13:15:00Z"]],
  },
  {
    id: "rafael-ocampo", fullName: "Rafael Ocampo", professionalTitle: "Backend Developer Senior",
    location: "Puebla", industry: "Tecnología", currentCompany: "Infraestructura Abierta", yearsOfExperience: 16,
    skills: ["Go", "PostgreSQL", "Kubernetes", "AWS", "Docker"],
    education: "Maestría en Ciencias de la Computación",
    languages: [{ name: "Español", level: "native" }, { name: "Inglés", level: "advanced" }],
    preferredModality: "remote", availability: "to_confirm",
    applications: [["backend-developer-senior", "submitted", "referral", "2026-03-16T11:45:00Z"]],
  },
];

/** Deterministic phone numbers: no clock, no randomness. */
const AREA_CODES = ["55", "33", "81", "222", "442", "999", "664", "477"] as const;

function phoneFor(index: number): string {
  const area = AREA_CODES[index % AREA_CODES.length];
  const first = 1000 + ((index * 37 + 13) % 9000);
  const second = 1000 + ((index * 91 + 7) % 9000);
  return `+52 ${area} ${first} ${second}`;
}

function toPerson(seed: TalentPersonSeed, index: number): TalentPerson {
  return {
    id: seed.id,
    fullName: seed.fullName,
    professionalTitle: seed.professionalTitle,
    email: `${seed.id}@ejemplo.mx`,
    phone: phoneFor(index),
    location: seed.location,
    industry: seed.industry,
    currentCompany: seed.currentCompany,
    yearsOfExperience: seed.yearsOfExperience,
    skills: seed.skills,
    education: seed.education,
    languages: seed.languages,
    preferredModality: seed.preferredModality,
    availability: seed.availability,
    applications: seed.applications.map(([vacancyId, stage, source, appliedAt], position) => ({
      id: `${seed.id}-postulacion-${position + 1}`,
      vacancyId,
      stage,
      source,
      appliedAt,
    })),
  };
}

/** Freezes a value and every plain object reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * The frozen Nexo Labs talent base: validated by `parseTalentPeople` at this
 * module boundary, then deeply frozen so no screen can mutate a fixture.
 */
export const TALENT_PEOPLE: readonly TalentPerson[] = deepFreeze(
  parseTalentPeople(TALENT_SEEDS.map(toPerson)),
);
