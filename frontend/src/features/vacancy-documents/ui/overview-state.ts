import type { DocumentItem, DocumentLink, DocumentOverview, DocumentOwner, Scope } from "../model";

/**
 * Local updates from a write response. Every write answers with the `scope` of the space it touched, so the vacancy flags and counts, or
 * the participation's `scope_allowed_actions` and `upload_blocked_reason`, follow without reading the list again. `participationId` null = vacancy.
 */
function ownerOf(overview: DocumentOverview, participationId: string | null): DocumentOwner | undefined {
  if (participationId === null) return { kind: "vacancy" };
  const found = overview.participations.find(entry => entry.participation_id === participationId);
  return found ? { kind: "participation", participation_id: participationId, candidate: found.candidate, discarded: found.discarded } : undefined;
}

export function withScope(overview: DocumentOverview, participationId: string | null, scope: Scope): DocumentOverview {
  if (participationId === null) return { ...overview, scope };
  return {
    ...overview,
    participations: overview.participations.map(entry => entry.participation_id === participationId
      ? { ...entry, scope_allowed_actions: scope.allowed_actions, upload_blocked_reason: scope.upload_blocked_reason } : entry),
  };
}

/** `undefined` when the owner is not in the list (the caller then reads the overview again). */
export function withItem(overview: DocumentOverview, item: DocumentItem, participationId: string | null, scope: Scope): DocumentOverview | undefined {
  const owner = ownerOf(overview, participationId);
  if (!owner) return undefined;
  const next = { ...item, owner };
  const exists = overview.items.some(entry => entry.id === item.id);
  const items = exists ? overview.items.map(entry => entry.id === item.id ? next : entry) : [next, ...overview.items];
  return withScope({ ...overview, items }, participationId, scope);
}

export function withLink(overview: DocumentOverview, link: DocumentLink, participationId: string | null, scope: Scope): DocumentOverview | undefined {
  const owner = ownerOf(overview, participationId);
  if (!owner) return undefined;
  const links = overview.links.some(entry => entry.id === link.id) ? overview.links : [{ ...link, owner }, ...overview.links];
  return withScope({ ...overview, links }, participationId, scope);
}

export function withoutRow(overview: DocumentOverview, row: { kind: "item" | "link"; id: string }, participationId: string | null, scope: Scope): DocumentOverview {
  const next = row.kind === "item"
    ? { ...overview, items: overview.items.filter(entry => entry.id !== row.id) }
    : { ...overview, links: overview.links.filter(entry => entry.id !== row.id) };
  return withScope(next, participationId, scope);
}

export const participationIdOf = (owner: DocumentOwner): string | null => owner.kind === "participation" ? owner.participation_id : null;
