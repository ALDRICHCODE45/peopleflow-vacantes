"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { postCandidateContacts } from "./contacts-client";
import { CONTACTS_CHUNK_SIZE, contactSelectionSchema, type CandidateContact, type ContactsResult } from "./contacts-model";

/** All-or-nothing export. Only validated contact crosses the session boundary. */
export async function getCandidateContactsAction(candidates: unknown): Promise<ContactsResult> {
 try {
  const selection = contactSelectionSchema.safeParse(candidates);
  if (!selection.success) return { ok: false };
  const token = await getActionAccessToken();
  if (!token?.trim()) return { ok: false };
  const items: CandidateContact[] = [];
  for (let offset = 0; offset < selection.data.length; offset += CONTACTS_CHUNK_SIZE) {
   const result = await postCandidateContacts({ token, candidates: selection.data.slice(offset, offset + CONTACTS_CHUNK_SIZE) });
   if (!result.ok) return { ok: false };
   items.push(...result.data.items);
  }
  return { ok: true, data: { items } };
 } catch { return { ok: false }; }
}
