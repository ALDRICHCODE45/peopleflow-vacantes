"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getBoard, getHistory, getParticipation, moveParticipation, type ClientResult, type MoveInput } from "./client";
import { movementFailure } from "./failure";
import type { Board, History, Move, ParticipationDetail, Result } from "./model";
async function authenticated<T>(call: (token: string) => Promise<ClientResult<T>>, write = false): Promise<Result<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await call(token);
    return result.ok ? result : movementFailure(result, write);
  } catch { return { ok: false, reason: write ? "uncertain" : "no_response", reference: {} }; }
}
export async function loadBoardAction(vacancyId: string): Promise<Result<Board>> {
  return authenticated(token => getBoard({ token, vacancyId }));
}
export async function loadParticipationAction(vacancyId: string, participationId: string): Promise<Result<ParticipationDetail>> {
  return authenticated(token => getParticipation({ token, vacancyId, participationId }));
}
export async function loadHistoryAction(vacancyId: string, participationId: string): Promise<Result<History>> {
  return authenticated(token => getHistory({ token, vacancyId, participationId }));
}
/** Caller reconciles uncertain/unrecognized/412/404 outcomes with a board GET, never a replay. */
export async function moveParticipationAction(input: Omit<MoveInput, "token">): Promise<Result<Move>> {
  return authenticated(token => moveParticipation({ ...input, token }), true);
}
