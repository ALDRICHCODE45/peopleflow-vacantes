import { describeRange, mxToday } from "./date-range";
import { categoryLabel, eventLabel, isKnownEventType, KNOWN_EVENT_TYPES, vacancyTitleLabel, type AuditActor, type AuditOptions, type AuditType, type AuditVacancy } from "./model";
import type { AuditFilters } from "./url-state";

/** Accent- and case-insensitive key for the panels' search boxes. */
export const searchKey = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const actorName = (actor: AuditActor): string => actor.name ?? actor.email ?? "Usuario eliminado";
export const actorLabel = (actor: AuditActor): string => `${actorName(actor)}${actor.is_current_member ? "" : " (ex miembro)"}`;
/** An unknown type shows its code next to the generic label. */
export const actionName = (type: string): string => isKnownEventType(type) ? eventLabel(type) : `${eventLabel(type)} (${type})`;
/** A vacancy with no readable title is told apart by the start of its id. */
export const vacancyTag = (id: string): string => id.slice(0, 8);
export function vacancyLabel(vacancy: AuditVacancy): string {
  const { label, missing } = vacancyTitleLabel(vacancy.title);
  return missing ? `${label} · #${vacancyTag(vacancy.vacancy_id)}` : label;
}

/** Types keep the API's order; categories group them. A selected type the catalog lacks joins «other». */
export function actionGroups(types: readonly AuditType[], selected: readonly string[]): [string, AuditType[]][] {
  const all = [...types, ...selected.filter(type => !types.some(item => item.event_type === type)).map(type => ({ event_type: type, category: "other" }))];
  const groups = new Map<string, AuditType[]>();
  for (const type of all) groups.set(type.category, [...(groups.get(type.category) ?? []), type]);
  return [...groups];
}

export type Chip = { key: string; name: string; value: string; remove: AuditFilters };

/** One chip per active condition with its full value; a fully chosen category collapses into one chip. */
export function activeChips(filters: AuditFilters, options: AuditOptions | null, today: string = mxToday()): Chip[] {
  const selected = filters.event_type ?? [];
  const chips: Chip[] = [];
  if (filters.actor_id) {
    const actor = options?.actors.find(item => item.user_id === filters.actor_id);
    chips.push({ key: "actor_id", name: "Persona", value: actor ? actorLabel(actor) : "Persona seleccionada", remove: { actor_id: undefined } });
  }
  const collapsed = new Set<string>();
  for (const [category, types] of actionGroups(options?.types ?? KNOWN_EVENT_TYPES, selected)) {
    if (types.length < 2 || !types.every(type => selected.includes(type.event_type))) continue;
    for (const type of types) collapsed.add(type.event_type);
    chips.push({ key: `category:${category}`, name: "Categoría", value: `${categoryLabel(category)} (${types.length} acciones)`,
      remove: { event_type: selected.filter(type => !types.some(item => item.event_type === type)) } });
  }
  for (const type of selected.filter(value => !collapsed.has(value))) chips.push({ key: `event_type:${type}`, name: "Acción", value: actionName(type), remove: { event_type: selected.filter(value => value !== type) } });
  if (filters.vacancy_id) {
    const vacancy = options?.vacancies.find(item => item.vacancy_id === filters.vacancy_id);
    chips.push({ key: "vacancy_id", name: "Vacante", value: vacancy ? vacancyLabel(vacancy) : "Vacante seleccionada", remove: { vacancy_id: undefined } });
  }
  if (filters.category) chips.push({ key: "category", name: "Categoría", value: categoryLabel(filters.category), remove: { category: undefined } });
  if (filters.from || filters.to) chips.push({ key: "range", name: "Fecha", value: describeRange(filters, today), remove: { from: undefined, to: undefined } });
  return chips;
}
