import type { BlockType, SiteBlock, SiteDraft } from "./model";

export const BLOCK_LIBRARY = {
  hero: { label: "Portada", description: "Da la bienvenida con un título y una imagen de tu empresa." },
  story: { label: "Historia", description: "Cuenta cómo empezó tu empresa y qué la hace especial." },
  values: { label: "Misión y valores", description: "Comparte lo que guía a tu equipo." },
  benefits: { label: "Beneficios", description: "Muestra lo que ofreces a quienes se suman." },
  stats: { label: "Cifras", description: "Destaca datos reales de tu empresa." },
  process: { label: "Proceso de selección", description: "Explica los pasos para formar parte del equipo." },
  gallery: { label: "Galería de cultura", description: "Comparte fotos de la vida en tu empresa." },
  testimonials: { label: "Testimonios", description: "Dale voz a tu equipo con su autorización." },
  video: { label: "Video", description: "Presenta tu empresa con un video de YouTube o Vimeo." },
  offices: { label: "Oficinas", description: "Muestra dónde trabaja tu equipo." },
  jobs: { label: "Vacantes abiertas", description: "Conecta a las personas con tus vacantes publicadas." },
  faq: { label: "Preguntas frecuentes", description: "Resuelve las dudas de quienes quieren postularse." },
  closing: { label: "Cierre", description: "Invita a conocer las oportunidades de tu empresa." },
} as const satisfies Record<BlockType, { label: string; description: string }>;

export const STANDARD_BENEFITS = [
  { icon: "stethoscope", title: "Seguro de gastos médicos", description: null },
  { icon: "laptop", title: "Equipo de cómputo", description: null },
  { icon: "clock", title: "Horario flexible", description: null },
  { icon: "home", title: "Apoyo para trabajo remoto", description: null },
  { icon: "graduation-cap", title: "Presupuesto de capacitación", description: null },
  { icon: "calendar", title: "Días libres adicionales", description: null },
  { icon: "heart", title: "Bienestar", description: null },
  { icon: "gift", title: "Bono anual", description: null },
] as const;

/** All templates are incomplete but saveable; each call owns its arrays and UUID. */
export function defaultBlock(type: BlockType): SiteBlock {
  const common = { id: crypto.randomUUID(), hidden: false };
  switch (type) {
    case "hero": return { ...common, type, variant: "photo", content: { title: null, subtitle: null, cover: null } };
    case "story": return { ...common, type, variant: "text", content: { title: null, body: null, image: null } };
    case "values": return { ...common, type, variant: "grid", content: { mission: null, items: [] } };
    case "benefits": return { ...common, type, variant: "grid", content: { items: [] } };
    case "stats": return { ...common, type, variant: "row", content: { items: [] } };
    case "process": return { ...common, type, variant: "steps", content: { items: [] } };
    case "gallery": return { ...common, type, variant: "grid", content: { items: [] } };
    case "testimonials": return { ...common, type, variant: "cards", content: { items: [] } };
    case "video": return { ...common, type, variant: "wide", content: { video: null, title: null, description: null } };
    case "offices": return { ...common, type, variant: "list", content: { items: [] } };
    case "jobs": return { ...common, type, variant: "list", content: { title: null, intro: null } };
    case "faq": return { ...common, type, variant: "accordion", content: { items: [] } };
    case "closing": return { ...common, type, variant: "banner", content: { title: null, text: null } };
  }
}
export function defaultSiteDraft(): SiteDraft {
  return {
    slug: null,
    theme: { brand_color: "#7835DB", accent_color: null, background_color: null, font_pair: "classic" },
    seo: { title: null, description: null },
    blocks: [defaultBlock("hero"), defaultBlock("jobs")],
  };
}
