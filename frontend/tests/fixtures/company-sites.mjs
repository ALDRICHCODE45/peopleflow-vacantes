import { readFileSync } from "node:fs";
import { publicDetail } from "./public-jobs.mjs";

export const nexoCompanyId = "b478fb93-71b8-47bf-8eaa-b726d63e01a0";
const company = { id: nexoCompanyId, name: "Nexo Labs" };
export const nexoJobs = [
  ["Ingeniera de plataforma", "remote", "Monterrey, Nuevo León"],
  ["Diseñador de producto", "hybrid", "Guadalajara, Jalisco"],
  ["Especialista en datos", "onsite", "Monterrey, Nuevo León"],
  ["Ingeniero de calidad", "hybrid", "Guadalajara, Jalisco"],
  ["Desarrolladora backend", "remote", "Guadalajara, Jalisco"],
  ["Analista de operaciones", "onsite", "Guadalajara, Jalisco"],
  ["Líder de ingeniería", "hybrid", "Monterrey, Nuevo León"],
].map(([title, work_mode, location], index) => ({
  id: `b478fb93-71b8-47bf-8eaa-b726d63e02a${index}`,
  company, title, work_mode, location,
  description: "Crea productos que conectan a las personas con mejores oportunidades en México. Comparte tus ideas, aprende con tu equipo y construye tecnología accesible con impacto real.",
  employment_type: "full_time", seniority: index === 6 ? "lead" : "senior",
  salary_currency: "MXN", salary_min: 35000, salary_max: 60000,
  published_at: "2026-10-27T09:00:00Z",
}));

// Reuse the existing, product-validated vacancy rich-description fixture
// document/envelope rather than inventing another rich-text representation.
const storyBody = publicDetail(nexoJobs[0]).description;
// Existing committed, public-domain image. No runtime downloads. Its provenance
// lives alongside the source asset; all media roles deliberately reuse it.
const image = readFileSync(new URL("../../public/company/acme-cover.webp", import.meta.url));
const media = ["cover", "gallery", "gallery", "portrait", "story"].map((kind, index) => {
  const id = `b478fb93-71b8-47bf-8eaa-b726d63e03a${index}`;
  return { id, kind, url: `/v2/company-sites/media/${id}`, width: 1600, height: 900 };
});
const ref = index => ({ media_id: media[index].id });
const blocks = [
  ["hero", "split", { title: "Tu siguiente gran paso empieza aquí", subtitle: "En Nexo Labs creamos tecnología con propósito desde México. Trae tu curiosidad: aquí tus ideas sí cuentan.", cover: ref(0) }],
  ["story", "text_image", { title: "Conectamos talento, creamos oportunidades", body: storyBody, image: ref(4) }],
  ["values", "grid", { mission: "Queremos que encontrar una buena oportunidad sea más sencillo, cercano y justo para todas las personas.", items: [
    { icon: "handshake", title: "La confianza va primero", description: "Hablamos con claridad, escuchamos y cumplimos lo que acordamos." },
    { icon: "lightbulb", title: "Aprendemos haciendo", description: "Probamos ideas pequeñas, compartimos lo aprendido y mejoramos en equipo." },
    { icon: "users", title: "Nadie construye a solas", description: "Tu perspectiva importa. Diseñamos con personas, no solo para ellas." },
  ] }],
  ["benefits", "compact", { items: [
    { icon: "stethoscope", title: "Cuida de ti", description: "Seguro de gastos médicos mayores y acompañamiento para tu bienestar." },
    { icon: "graduation-cap", title: "Sigue creciendo", description: "Presupuesto anual para cursos, libros y conferencias que tú eliges." },
    { icon: "clock", title: "Tiempo para tu vida", description: "Horarios flexibles y vacaciones adicionales desde tu primer año." },
    { icon: "laptop", title: "Herramientas a tu medida", description: "Equipo de trabajo y apoyo para tu espacio en casa." },
  ] }],
  ["stats", "row", { items: [{ value: "85", label: "Personas en el equipo" }, { value: "2", label: "Ciudades: Monterrey y Guadalajara" }, { value: "40%", label: "Promociones internas este año" }] }],
  ["process", "timeline", { items: [
    { title: "Conozcámonos", description: "Platícanos qué buscas y resuelve tus dudas sobre el equipo.", duration: "30 minutos" },
    { title: "Comparte tu experiencia", description: "Trabaja en un caso breve relacionado con el rol, sin tareas interminables.", duration: "60 minutos" },
    { title: "Conoce a tu equipo", description: "Conversa con quienes colaborarás y recibe una respuesta clara.", duration: "45 minutos" },
  ] }],
  ["gallery", "mosaic", { items: [
    { image: ref(1), alt: "Personas trabajando entre suministros en un almacén", caption: "La colaboración mueve grandes proyectos. Imagen de referencia." },
    { image: ref(2), alt: "Vista de un almacén con personal y montacargas", caption: "Operaciones que inspiran productos útiles. Imagen de referencia." },
  ] }],
  ["testimonials", "quote", { items: [{ quote: "Llegué con ganas de aprender y encontré un equipo que escucha. Hoy lidero proyectos que antes me parecían lejanos.", name: "Mariana López", role: "Ingeniera de producto · 3 años en Nexo", photo: ref(3), consent: true }] }],
  ["video", "wide", { title: "Conoce el espíritu de Nexo", description: "Una pausa para conocernos mejor. Video de demostración; se carga solo si tú decides reproducirlo.", video: { provider: "youtube", video_id: "dQw4w9WgXcQ" } }],
  ["offices", "cards", { items: [
    { name: "Monterrey", location: { country: "MX", state: "19", municipality: "19039" }, address: "Av. Constitución 100, Centro, Monterrey, Nuevo León", map_url: "https://maps.google.com/?q=Monterrey+Nuevo+Leon" },
    { name: "Guadalajara", location: { country: "MX", state: "14", municipality: "14039" }, address: "Av. México 200, Guadalajara, Jalisco", map_url: "https://maps.google.com/?q=Guadalajara+Jalisco" },
  ] }],
  ["jobs", "cards", { title: "Encuentra tu lugar en Nexo", intro: "Explora nuestras vacantes y elige el reto que conecta contigo. Queremos conocerte." }],
  ["faq", "two_columns", { items: [
    { question: "¿Puedo trabajar desde otra ciudad de México?", answer: "Sí, en las vacantes remotas puedes trabajar desde cualquier ciudad del país. Revisa la modalidad de cada oportunidad." },
    { question: "¿Necesito cumplir todos los requisitos?", answer: "Si el reto te entusiasma y cuentas con las bases, postúlate. Nos interesa tu potencial y cómo aprendes." },
    { question: "¿Cuándo recibiré una respuesta?", answer: "Te compartimos avances durante el proceso. Nuestro objetivo es darte una primera respuesta en cinco días hábiles." },
  ] }],
  ["closing", "banner", { title: "Construye algo que importe", text: "Tu talento puede abrir nuevas puertas para miles de personas. Da el siguiente paso y encuentra tu equipo en Nexo Labs." }],
].map(([type, variant, content], index) => ({ id: `b478fb93-71b8-47bf-8eaa-b726d63e04${String(index).padStart(2, "0")}`, type, variant, hidden: false, content }));

export function createCompanySitesFixture() {
  let state;
  const reset = () => { state = { brand: "orange", font: "modern", jobs: "default" }; };
  reset();
  const colors = { orange: "#EA580C", green: "#15803D" };
  const handle = (request, response, url) => {
    const json = (status, payload, cache = "no-store") => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": cache });
      response.end(JSON.stringify(payload));
      return true;
    };
    if (url.pathname === "/__site") {
      const next = { ...state };
      for (const [key, allowed] of [["brand", Object.keys(colors)], ["font", ["modern", "editorial", "classic"]], ["jobs", ["default", "empty"]]]) {
        if (!url.searchParams.has(key)) continue;
        const value = url.searchParams.get(key);
        if (!allowed.includes(value)) return json(400, { error: `Invalid ${key}` });
        next[key] = value;
      }
      state = next;
      return json(200, { ok: true, ...state });
    }
    if (request.method !== "GET" || !url.pathname.startsWith("/v2/company-sites/")) return false;
    if (url.pathname.startsWith("/v2/company-sites/media/")) {
      if (!media.some(item => item.url === url.pathname)) return json(404, { error: "Imagen no encontrada", code: "media_not_found" });
      response.writeHead(200, { "content-type": "image/webp", "content-length": image.length, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
      response.end(image);
      return true;
    }
    if (!["/v2/company-sites/nexo-labs", "/v2/company-sites/nexo-equipo"].includes(url.pathname)) return json(404, { error: "Sitio no encontrado", code: "site_not_found" });
    return json(200, {
      company: { ...company, logo_url: `${url.origin}${media[0].url}`, description: "Somos un equipo de tecnología en México que conecta a las personas con mejores oportunidades.", website: "https://example.com", linkedin_url: "https://www.linkedin.com/company/nexo-labs", instagram_url: "https://www.instagram.com/nexo.labs", facebook_url: "https://www.facebook.com/nexo.labs", twitter_url: "https://x.com/nexo_labs", location: publicDetail(nexoJobs[0]).location },
      site: { theme: { brand_color: colors[state.brand], font_pair: state.font }, seo: { title: "Trabaja en Nexo Labs | Tu siguiente gran paso", description: "Construye tecnología con propósito desde México. Conoce nuestra cultura, beneficios y vacantes remotas, híbridas y presenciales. Encuentra tu lugar en Nexo." }, blocks },
      slug: "nexo-labs", published_at: "2026-10-27T09:00:00Z", media,
    }, "public, max-age=60");
  };
  return { handle, reset, jobsEmpty: () => state.jobs === "empty" };
}
