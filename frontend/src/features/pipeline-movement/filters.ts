/** Local multi-select dimensions: OR within a group, AND across active groups. */
export type FilterDimension<Item> = {
  key: string;
  label: string;
  options: { value: string; label: string; group?: string }[];
  match: (item: Item, selected: ReadonlySet<string>) => boolean;
};
export type FilterSelection = Record<string, Set<string>>;
export function applyFilters<Item>(items: readonly Item[], dimensions: readonly FilterDimension<Item>[], selection: FilterSelection): Item[] {
  return items.filter(item => dimensions.every(dimension => !selection[dimension.key]?.size || dimension.match(item, selection[dimension.key])));
}
export function activeFilterCount(selection: FilterSelection): number {
  return Object.values(selection).reduce((count, values) => count + values.size, 0);
}
export function toggleFilter(selection: FilterSelection, key: string, value: string): FilterSelection {
  const values = new Set(selection[key]);
  if (values.has(value)) values.delete(value); else values.add(value);
  return { ...selection, [key]: values };
}
export function clearFilters(selection: FilterSelection, key?: string): FilterSelection {
  if (key === undefined) return {};
  return Object.fromEntries(Object.entries(selection).filter(([dimension]) => dimension !== key));
}
export function filterChips<Item>(dimensions: readonly FilterDimension<Item>[], selection: FilterSelection) {
  return dimensions.flatMap(dimension => dimension.options.filter(option => selection[dimension.key]?.has(option.value)).map(option => ({ key: dimension.key, value: option.value, label: `${dimension.label}: ${option.group ? `${option.group} · ` : ""}${option.label}` })));
}
/** Counts always describe the full current board, not the filtered subset. */
export function optionCount<Item>(items: readonly Item[], dimension: FilterDimension<Item>, value: string): number {
  return items.filter(item => dimension.match(item, new Set([value]))).length;
}
