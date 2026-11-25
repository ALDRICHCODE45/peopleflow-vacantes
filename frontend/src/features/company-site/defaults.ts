import { DEFAULT_SECTION_STYLE, HERO_BUTTON_DEFAULTS, type BlockType, type BlockTypeV2, type SectionStyle, type SiteBlock, type SiteBlockV2, type SiteDraft } from "./model";

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
  { icon: "stethoscope", emoji: null, title: "Seguro de gastos médicos", description: null },
  { icon: "laptop", emoji: null, title: "Equipo de cómputo", description: null },
  { icon: "clock", emoji: null, title: "Horario flexible", description: null },
  { icon: "home", emoji: null, title: "Apoyo para trabajo remoto", description: null },
  { icon: "graduation-cap", emoji: null, title: "Presupuesto de capacitación", description: null },
  { icon: "calendar", emoji: null, title: "Días libres adicionales", description: null },
  { icon: "heart", emoji: null, title: "Bienestar", description: null },
  { icon: "gift", emoji: null, title: "Bono anual", description: null },
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

// ---------------------------------------------------------------------------
// Sections v2, slice A. Not offered by today's editor (it reads BLOCK_LIBRARY /
// defaultBlock); the v2 editor switches to these behind SECTIONS_V2_ENABLED.
// ---------------------------------------------------------------------------

export const BLOCK_LIBRARY_V2 = {
  ...BLOCK_LIBRARY,
  team: { label: "Equipo / Líderes", description: "Presenta a las personas que lideran tu equipo." },
  logos: { label: "Logos / Reconocimientos", description: "Muestra premios, certificaciones y aliados." },
  areas: { label: "Áreas de trabajo", description: "Ayuda a encontrar vacantes por área." },
  // Its CV form needs slice C; until then the editor must not offer it.
  talent_cta: { label: "Llamado a talento", description: "Invita a dejar su CV aunque no haya una vacante para su perfil." },
} as const satisfies Record<BlockTypeV2, { label: string; description: string }>;

/** Labels for the variants slice A adds. TODO(editor writer): merge into VARIANT_LABELS in editor/variant-picker.tsx
 * (existing keys such as carousel, grid, split and banner already have labels there). */
export const NEW_VARIANT_LABELS = {
  background_loop: "Fondo en movimiento", photo_jobs: "Foto con vacantes recientes", collage: "Collage de fotos",
  bento: "Bento", big_icons: "Íconos grandes", brand_band: "Banda de marca", photo_strip: "Tira de fotos",
  portraits: "Retratos", strip: "Franja", icon_cards: "Tarjetas con ícono", photo_cards: "Tarjetas con foto",
} as const;

/** «Estilo de sección» choices (S3), curated values only. */
export const SECTION_STYLE_LABELS = {
  background: { default: "Normal", tint: "Tinte suave", brand: "Color de marca", image: "Imagen" },
  spacing: { compact: "Compacto", airy: "Amplio" },
  align: { center: "Centrado", start: "Izquierda" },
  overlay: { soft: "Suave", medium: "Media", strong: "Fuerte" },
} as const satisfies { [K in Exclude<keyof SectionStyle, "image">]: Record<NonNullable<SectionStyle[K]>, string> };

/** v2 templates: incomplete but saveable, each call owns its arrays, style and UUID. */
export function defaultBlockV2(type: BlockTypeV2): SiteBlockV2 {
  const style: SectionStyle = { ...DEFAULT_SECTION_STYLE };
  const common = { id: crypto.randomUUID(), hidden: false, style };
  switch (type) {
    case "hero": return { ...common, type, variant: "photo", content: { title: null, subtitle: null, cover: null, images: [], ...HERO_BUTTON_DEFAULTS } };
    case "team": return { ...common, type, variant: "grid", content: { title: null, intro: null, items: [] } };
    case "logos": return { ...common, type, variant: "strip", content: { title: null, items: [] } };
    case "areas": return { ...common, type, variant: "icon_cards", content: { title: null, intro: null, overrides: [] } };
    case "talent_cta": return { ...common, type, variant: "banner", content: { title: null, text: null, button_label: "Dejar mi CV" } };
    case "testimonials": return { ...common, type, variant: "cards", content: { items: [] } };
    default: return { ...defaultBlock(type), ...common } as SiteBlockV2;
  }
}
