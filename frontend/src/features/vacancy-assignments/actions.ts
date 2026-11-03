"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getHistory } from "./api-client";
import type { ReadResult } from "./client";

export async function loadAssignmentHistoryAction(cursor?: string): Promise<ReadResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, code: "unauthenticated", status: 401 };
    return await getHistory({ token, cursor });
  } catch { return { ok: false, code: "read_failed" }; }
}
