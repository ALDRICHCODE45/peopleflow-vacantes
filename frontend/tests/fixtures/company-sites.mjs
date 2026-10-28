import { readFileSync } from "node:fs";
import { publicDetail } from "./public-jobs.mjs";
import product from "./site-product-model.cjs";
import { receiveSiteMedia } from "./site-media.mjs";
const { siteDraftSchema, defaultSiteDraft, publishIssues, validateSlug } = product;
const initialTime = "2026-10-27T09:00:00Z";
const colors = { orange: "#EA580C", green: "#15803D" };
const referencedMedia = (document, available) => {
  const ids = new Set([...JSON.stringify(document).matchAll(/"media_id":"([^"]+)"/g)].map(match => match[1]));
  return available.filter(item => ids.has(item.id));
};
const fieldPath = path => path.reduce((text, part) => typeof part === "number" ? `${text}[${part}]` : text ? `${text}.${part}` : part, "");

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
// Visual reviews may point COMPANY_SITE_FIXTURE_IMAGES at local, uncommitted
// photos (colon-separated paths, assigned to media in order, round-robin).
const reviewImages = (process.env.COMPANY_SITE_FIXTURE_IMAGES ?? "").split(":").filter(Boolean).map(path => ({
  bytes: readFileSync(path),
  type: path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg",
}));
const imageFor = index => reviewImages.length ? reviewImages[index % reviewImages.length] : { bytes: image, type: "image/webp" };
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
  let state, draft, version, published, snapshot, updatedAt, controls, history, uploads;
  const reset = () => {
    state = { brand: "orange", font: "modern", jobs: "default" };
    draft = siteDraftSchema.parse({ slug: "nexo-labs", theme: { brand_color: colors.orange, font_pair: "modern" }, seo: { title: "Trabaja en Nexo Labs | Tu siguiente gran paso", description: "Construye tecnología con propósito desde México. Conoce nuestra cultura, beneficios y vacantes remotas, híbridas y presenciales. Encuentra tu lugar en Nexo." }, blocks: structuredClone(blocks) });
    version = 1;
    published = { version, slug: draft.slug, published_at: initialTime };
    snapshot = structuredClone(draft);
    updatedAt = initialTime;
    controls = { role: "owner", gate: "none", conflict: null, offline: null };
    history = new Set(["nexo-equipo"]);
    uploads = new Map();
  };
  reset();
  const allMedia = () => [...media, ...[...uploads.values()].map(item => item.media)];
  const current = () => ({ draft, draft_version: version, published, has_unpublished_changes: !published || published.version !== version, media: referencedMedia(draft, allMedia()), updated_at: updatedAt });
  const changed = () => { version++; updatedAt = new Date().toISOString(); };
  const privatePath = "/v2/me/company/site";
  const mutate = async (request, suffix, json) => {
    const fail = (status, code, extra = {}) => json(status, { error: code, code, ...extra });
    const conflict = () => fail(412, "version_conflict", { current: current() });
    if (suffix === "/draft" && controls.offline) { controls.offline = null; request.socket.destroy(); return; }
    if (suffix === "/draft" && controls.conflict) {
      controls.conflict = null;
      draft = { ...draft, seo: { ...draft.seo, title: "Actualizado por otra persona" } };
      changed();
      return conflict();
    }
    if (suffix !== "/unpublish") {
      const tag = request.headers["if-match"];
      if (tag === undefined) return fail(428, "precondition_required");
      if (!/^"[1-9]\d*"$/.test(tag)) return fail(400, "invalid_request");
      if (tag !== `"${version}"`) return conflict();
    }
    if (suffix === "/draft") {
      let body;
      try {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 1024 * 1024) return fail(413, "payload_too_large");
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch { return fail(400, "invalid_request"); }
      // Reading a streamed body yields to other writers. Compare again at the
      // synchronous validation/write boundary so only one can win this version.
      if (request.headers["if-match"] !== `"${version}"`) return conflict();
      if (typeof body?.slug === "string" && validateSlug(body.slug.trim()) === "reserved") return fail(422, "slug_reserved", { field: "slug" });
      if (typeof body?.slug === "string" && body.slug.trim() === "otra-empresa") return fail(409, "slug_taken", { field: "slug" });
      const parsed = siteDraftSchema.safeParse(body);
      if (!parsed.success) return fail(400, "validation_error", { fields: parsed.error.issues.map(issue => ({ field: fieldPath(issue.path) || "draft", code: issue.code === "unrecognized_keys" ? "unknown_key" : issue.code === "too_big" || issue.message.startsWith("Maximum") ? "too_long" : issue.message.includes("Duplicate") ? "duplicate" : "invalid" })) });
      const refs = [...JSON.stringify(parsed.data).matchAll(/"media_id":"([^"]+)"/g)].map(match => match[1]);
      if (refs.some(id => !allMedia().some(item => item.id === id))) return fail(400, "validation_error", { fields: [{ field: "blocks", code: "invalid" }] });
      if (JSON.stringify(parsed.data) !== JSON.stringify(draft)) { draft = parsed.data; changed(); }
    } else if (suffix === "/publish") {
      const issues = publishIssues(draft, { name: company.name, logo_url: media[0].url });
      if (issues.length) return fail(422, "publish_blocked", { issues });
      if (published && published.slug !== draft.slug) history.add(published.slug);
      published = { version, slug: draft.slug, published_at: new Date().toISOString() };
      snapshot = structuredClone(draft);
    } else { published = null; snapshot = null; }
    return json(200, current());
  };
  const publicIdentity = origin => ({ ...company, logo_url: `${origin}${media[0].url}`, description: "Somos un equipo de tecnología en México que conecta a las personas con mejores oportunidades.", website: "https://example.com", linkedin_url: "https://www.linkedin.com/company/nexo-labs", instagram_url: "https://www.instagram.com/nexo.labs", facebook_url: "https://www.facebook.com/nexo.labs", twitter_url: "https://x.com/nexo_labs", location: publicDetail(nexoJobs[0]).location });
  const handle = (request, response, url) => {
    const json = (status, payload, cache = "no-store") => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": cache, ...(url.pathname.startsWith(privatePath) && (status === 200 || status === 412) ? { etag: `"${version}"` } : {}) });
      response.end(JSON.stringify(payload));
      return true;
    };
    if (url.pathname === "/__site-draft") {
      const next = { ...controls };
      for (const [key, allowed] of [["role", ["owner", "recruiter"]], ["gate", ["none", "forbidden", "company_inactive"]], ["conflict", ["next"]], ["offline", ["next"]], ["mode", ["new"]]]) {
        if (!url.searchParams.has(key)) continue;
        const value = url.searchParams.get(key);
        if (!allowed.includes(value)) return json(400, { error: `Invalid ${key}` });
        if (key !== "mode") next[key] = value;
      }
      if (url.searchParams.get("mode") === "new") {
        draft = defaultSiteDraft(); version = 1; published = null; snapshot = null;
        updatedAt = initialTime; uploads = new Map(); history = new Set();
      }
      controls = next;
      return json(200, { ok: true, ...controls });
    }
    // Employer membership read by the (empresa) layout check and the editor
    // loader; the role follows the /__site-draft role control.
    if (url.pathname === "/v2/me" && request.method === "GET") {
      if (!request.headers.authorization?.startsWith("Bearer ")) return json(401, { error: "unauthenticated", code: "unauthenticated" });
      return json(200, { role: "recruiter", user: { id: "b478fb93-71b8-47bf-8eaa-b726d63e05a0", email: "mariana@nexolabs.example", full_name: "Mariana Cruz" } });
    }
    // Anonymous public company profile (backend companyPublicResponse) read by
    // the careers editor for the preview identity.
    if (url.pathname.startsWith("/companies/") && request.method === "GET") {
      if (url.pathname !== `/companies/${company.id}`) return json(404, { error: "not found", code: "not_found" });
      return json(200, { ...publicIdentity(url.origin), industry_id: "tecnologia" });
    }
    if (url.pathname === "/me/company" && request.method === "GET") {
      if (!request.headers.authorization?.startsWith("Bearer ")) return json(401, { error: "unauthenticated", code: "unauthenticated" });
      return json(200, { company_id: company.id, role: controls.role, company: { ...company, rfc: "NLA200101AB1", industry_id: "tecnologia", status: "active", location: publicDetail(nexoJobs[0]).location, updated_at: initialTime } });
    }
    if (url.pathname === privatePath || url.pathname.startsWith(`${privatePath}/`)) {
      if (!request.headers.authorization?.startsWith("Bearer ")) return json(401, { error: "unauthenticated", code: "unauthenticated" });
      if (controls.gate !== "none") return json(403, { error: controls.gate, code: controls.gate });
      const suffix = url.pathname.slice(privatePath.length);
      if (["/publish", "/unpublish"].includes(suffix) && controls.role !== "owner") return json(403, { error: "forbidden", code: "forbidden" });
      if (!suffix && request.method === "GET") return json(200, current());
      if (suffix === "/slug-availability" && request.method === "GET") {
        const slug = url.searchParams.get("slug") ?? "";
        const reason = validateSlug(slug) ?? (slug === "otra-empresa" ? "taken" : null);
        return json(200, { slug, available: reason === null, reason });
      }
      const action = suffix === "/media" && request.method === "POST" ? () => receiveSiteMedia(request, uploads, json)
        : (suffix === "/draft" && request.method === "PUT") || (["/publish", "/unpublish"].includes(suffix) && request.method === "POST") ? () => mutate(request, suffix, json) : null;
      if (!action) return json(405, { error: "invalid_request", code: "invalid_request" });
      // Own asynchronous body consumption here; the outer jobs router must not
      // continue while multipart/JSON is being read.
      action().catch(() => { if (!response.headersSent && !response.destroyed) json(400, { error: "invalid_request", code: "invalid_request" }); });
      return true;
    }
    if (url.pathname === "/__site") {
      const next = { ...state };
      for (const [key, allowed] of [["brand", Object.keys(colors)], ["font", ["modern", "editorial", "classic"]], ["jobs", ["default", "empty"]]]) {
        if (!url.searchParams.has(key)) continue;
        const value = url.searchParams.get(key);
        if (!allowed.includes(value)) return json(400, { error: `Invalid ${key}` });
        next[key] = value;
      }
      if (next.brand !== state.brand || next.font !== state.font) {
        const theme = { brand_color: colors[next.brand], font_pair: next.font };
        draft = { ...draft, theme };
        if (snapshot) snapshot = { ...snapshot, theme: { ...theme } };
      }
      state = next;
      return json(200, { ok: true, ...state });
    }
    if (request.method !== "GET" || !url.pathname.startsWith("/v2/company-sites/")) return false;
    if (url.pathname.startsWith("/v2/company-sites/media/")) {
      const mediaIndex = media.findIndex(item => item.url === url.pathname);
      const uploaded = uploads.get(url.pathname.split("/").at(-1));
      if (mediaIndex < 0 && !uploaded) return json(404, { error: "Imagen no encontrada", code: "media_not_found" });
      const served = uploaded ? { bytes: uploaded.bytes, type: uploaded.media.content_type } : imageFor(mediaIndex);
      response.writeHead(200, { "content-type": served.type, "content-length": served.bytes.length, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
      response.end(served.bytes);
      return true;
    }
    const slug = url.pathname.slice("/v2/company-sites/".length);
    if (!published || !snapshot || (slug !== published.slug && !history.has(slug))) return json(404, { error: "Sitio no encontrado", code: "site_not_found" });
    const visible = { theme: snapshot.theme, seo: snapshot.seo, blocks: snapshot.blocks.filter(block => !block.hidden) };
    return json(200, {
      company: publicIdentity(url.origin),
      site: visible,
      slug: published.slug, published_at: published.published_at, media: referencedMedia(visible, allMedia()),
    }, "public, max-age=60");
  };
  return { handle, reset, jobsEmpty: () => state.jobs === "empty" };
}
