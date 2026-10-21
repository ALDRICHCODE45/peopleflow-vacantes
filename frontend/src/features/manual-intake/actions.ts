"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { checkDuplicates } from "./client";
import { intakeFailure } from "./failure";
export async function checkDuplicatesAction(vacancyId: string, body: { email: string | null; phone: string | null }) {
  try {
    const token = await getActionAccessToken();
    if (!token) return intakeFailure(401, { error: "unauthenticated", code: "unauthenticated" });
    return await checkDuplicates(token, vacancyId, body);
  } catch { return intakeFailure(); }
}
