import { placementTotal, type RecruiterCard } from "./model";

/** Sorting arranges rows on demand; it never assigns positions (D11: no score, no rank). */
export const SORT_KEYS = ["name", "assigned", "on_time", "median", "delivered", "placements", "conversion", "reassignments", "business_days"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type RecruiterSort = { key: SortKey; direction: "ascending" | "descending" };
export const DEFAULT_SORT: RecruiterSort = { key: "name", direction: "ascending" };

const VALUE: Record<Exclude<SortKey, "name">, (card: RecruiterCard) => number | null> = {
  assigned: card => card.vacancies.assigned,
  on_time: card => card.delivery.on_time,
  median: card => card.delivery.median_business_days_to_target,
  delivered: card => card.delivery.delivered_in_tramo,
  placements: card => placementTotal(card.placements),
  conversion: card => card.placements.conversion?.value ?? null,
  reassignments: card => card.reassignments.received,
  business_days: card => card.business_days_in_tramos,
};
const SORT_NAME: Record<SortKey, string> = {
  name: "nombre", assigned: "asignadas", on_time: "entregas a tiempo", median: "mediana a la meta", delivered: "entregados en su tramo",
  placements: "placements", conversion: "conversión", reassignments: "reasignaciones recibidas", business_days: "días en tramos",
};

/**
 * The backend already orders the cards by lowercase name with null names last (§3.7.11): «nombre A–Z» keeps that
 * order and «Z–A» reverses the named ones, nulls still last. Other columns put values without a sample last in either
 * direction and break ties by that same name order.
 */
export function sortRecruiters(items: readonly RecruiterCard[], { key, direction }: RecruiterSort): RecruiterCard[] {
  const sign = direction === "ascending" ? 1 : -1;
  if (key === "name") {
    if (direction === "ascending") return [...items];
    return [...items.filter(item => item.name !== null).reverse(), ...items.filter(item => item.name === null)];
  }
  const position = new Map(items.map((item, index) => [item, index]));
  const byName = (a: RecruiterCard, b: RecruiterCard) => position.get(a)! - position.get(b)!;
  const value = VALUE[key];
  return [...items].sort((a, b) => {
    const left = value(a); const right = value(b);
    if (left === null || right === null) return left === right ? byName(a, b) : left === null ? 1 : -1;
    return left === right ? byName(a, b) : sign * (left - right);
  });
}
export const nextSort = (current: RecruiterSort, key: SortKey): RecruiterSort =>
  current.key === key && current.direction === "ascending" ? { key, direction: "descending" } : { key, direction: "ascending" };
export const sortLabel = ({ key, direction }: RecruiterSort) =>
  `Orden: ${SORT_NAME[key]} (${key === "name" ? direction === "ascending" ? "A–Z" : "Z–A" : direction === "ascending" ? "menor a mayor" : "mayor a menor"})`;
