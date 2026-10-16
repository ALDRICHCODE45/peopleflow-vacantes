export type MissingGroup = "editor" | "solicitud" | "entrega";
export type MissingItem = { label: string; group: MissingGroup; href: (draftId: string) => string };
const editor = (label: string): MissingItem => ({ label, group: "editor", href: id => `/empresa/vacantes/borradores/${id}` });
const solicitud = (label: string): MissingItem => ({ label, group: "solicitud", href: id => `/empresa/vacantes/${id}/configuracion/solicitud` });
const entrega = (label: string): MissingItem => ({ label, group: "entrega", href: id => `/empresa/vacantes/${id}/configuracion/entrega` });
export const MISSING_ITEMS = {
  title_missing: editor("Título"), description_missing: editor("Descripción"), location_missing: editor("Ubicación"),
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
  return `No puedes dejarla sin: ${codes.map(code => missingItem(code).label).join(", ")}. Tus cambios siguen aquí.`;
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
export function formatPublicationDate(value: string) { return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value)); }
