import type { DraftFormState } from "../ui/draft-form-state";
import { deriveDraftDescriptionPlain } from "../rich/plain";

export type MissingGroup = "editor" | "solicitud" | "entrega";
export type MissingItem = { label: string; group: MissingGroup; href: (draftId: string) => string };
const editor = (label: string, anchor = ""): MissingItem => ({ label, group: "editor", href: id => `/empresa/vacantes/borradores/${id}${anchor}` });
const solicitud = (label: string): MissingItem => ({ label, group: "solicitud", href: id => `/empresa/vacantes/${id}/configuracion/solicitud` });
const entrega = (label: string): MissingItem => ({ label, group: "entrega", href: id => `/empresa/vacantes/${id}/configuracion/entrega` });
export const MISSING_ITEMS = {
  title_missing: editor("Título"), description_missing: editor("Descripción"),
  location_missing: editor("Agrega la ubicación de la vacante.", "#draft-location"),
  location_incomplete: editor("Completa estado y municipio.", "#draft-location"),
  remote_scope_missing: editor("Indica desde dónde pueden postular.", "#draft-remote-scope"),
  work_mode_missing: editor("Modalidad"), work_schedule_missing: editor("Jornada"), contract_type_missing: editor("Tipo de contrato"),
  professional_area_missing: editor("Área profesional"), requester_missing: editor("Solicitante"),
  request_date_missing: solicitud("Fecha de solicitud"), hiring_headcount_missing: solicitud("Plazas a cubrir"),
  delivery_cutoff_missing: entrega("Columna de corte"), delivery_target_missing: entrega("Objetivo de entrega"),
  commitment_date_missing: entrega("Fecha compromiso"), commitment_date_past: entrega("La fecha compromiso ya pasó"),
} satisfies Record<string, MissingItem>;
export const MISSING_GROUP_LABELS: Record<MissingGroup, string> = { editor: "Editor de la vacante", solicitud: "Solicitud", entrega: "Entrega" };
function missingItem(code: string): MissingItem {
  return Object.hasOwn(MISSING_ITEMS, code) ? MISSING_ITEMS[code as keyof typeof MISSING_ITEMS] : editor("Otro requisito pendiente");
}
/** Identical consequence copy for all three published-vacancy save screens. */
export function formatPublishedSaveMissing(codes: readonly string[]): string {
  const label = (code: string) => code === "location_missing" ? "Ubicación" : code === "location_incomplete" ? "Estado y municipio" : code === "remote_scope_missing" ? "Países desde donde pueden postular" : missingItem(code).label;
  return `No puedes dejarla sin: ${codes.map(label).join(", ")}. Tus cambios siguen aquí.`;
}
/** Groups follow first server occurrence; items within each group keep server order. */
export function groupMissing(codes: readonly string[]) {
  const groups: { group: MissingGroup; items: (MissingItem & { code: string })[] }[] = [];
  for (const code of codes) {
    const item = missingItem(code);
    let group = groups.find(group => group.group === item.group);
    if (!group) { group = { group: item.group, items: [] }; groups.push(group); }
    group.items.push({ ...item, code });
  }
  return groups;
}
const REQUIRED_SCALARS = ["title", "work_mode", "work_schedule", "contract_type", "professional_area"] as const;
/** Same requirements drive completeness and publication-only field markers. */
export function editorPublicationRequirements(state: Pick<DraftFormState, "work_mode" | "location">) {
  return {
    scalarFields: REQUIRED_SCALARS,
    description: true,
    requester: true,
    location: state.work_mode === "remote" ? [] as const : state.location.country === "MX" ? ["country", "state", "municipality"] as const : ["country"] as const,
    remoteScope: state.work_mode === "remote",
  } as const;
}

/** Editor projection of the publication checklist, never a replacement for server authorization.
 * Alternatives occupy one requirement slot; optional compensation/questions earn no invented marks.
 */
export function editorReadiness(state: DraftFormState, serverMissing: readonly string[] | null) {
  const missing: string[] = [];
  const required = editorPublicationRequirements(state);
  for (const key of required.scalarFields) {
    if (!state[key].trim()) missing.push(`${key}_missing`);
  }
  if (!state.requester.id) missing.push("requester_missing");
  let description = "";
  try { description = deriveDraftDescriptionPlain(state.description) ?? ""; } catch { /* Invalid local documents are not complete. */ }
  if (!description.trim()) missing.push("description_missing");
  if (required.remoteScope) {
    if (!state.remote_scope || (state.remote_scope.kind === "countries" && !state.remote_scope.countries.length)) missing.push("remote_scope_missing");
  } else if (!state.location.country) missing.push("location_missing");
  else if (state.location.country === "MX" && (!state.location.state || !state.location.municipality)) missing.push("location_incomplete");
  const editorMissing = [...missing];
  // The server reports missing requirements, not values. An empty loaded list is known;
  // null means not loaded, and must not silently award five completed requirements.
  const external = serverMissing === null ? [] : [...new Set(serverMissing)].filter(code => !Object.hasOwn(MISSING_ITEMS, code) || MISSING_ITEMS[code as keyof typeof MISSING_ITEMS].group !== "editor");
  missing.push(...external);
  const unknown = external.filter(code => !Object.hasOwn(MISSING_ITEMS, code)).length;
  const total = 8 + (serverMissing === null ? 0 : 5 + unknown);
  const pending = missing.length - (missing.includes("commitment_date_missing") && missing.includes("commitment_date_past") ? 1 : 0);
  return { missing, pending, total, percent: Math.round((total - pending) / total * 100), serverKnown: serverMissing !== null,
    sectionComplete: [!editorMissing.some(code => code !== "description_missing"), !editorMissing.includes("description_missing"), null, null, serverMissing !== null && pending === 0] as const };
}

export function formatPublicationDate(value: string) { return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value)); }
