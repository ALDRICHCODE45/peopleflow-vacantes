import { z } from "zod";
import { isCivilDate } from "./delivery-model";
const uuid = z.string().uuid();
const text = z.string().refine(value => !!value.trim());
const timestamp = z.string().datetime({ offset: true });
const date = z.string().refine(isCivilDate);
const count = z.number().int().nonnegative().safe();
const target = count.positive();
// Date.parse loses PostgreSQL's sub-millisecond precision; preserve it for ties.
function compareInstants(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right);
  if (milliseconds) return milliseconds;
  const fraction = (value: string) => value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] ?? "";
  const a = fraction(left), b = fraction(right), width = Math.max(a.length, b.length);
  return a.padEnd(width, "0").localeCompare(b.padEnd(width, "0"));
}
const candidate = z.object({ participation_id: uuid, candidate: z.object({ id: uuid, full_name: text }).strict(), reached_at: timestamp }).strict();
const candidates = z.array(candidate).refine(items => new Set(items.map(item => item.participation_id)).size === items.length && items.every((item, index) => {
  if (!index) return true;
  const previous = items[index - 1];
  const order = compareInstants(previous.reached_at, item.reached_at);
  return order < 0 || (order === 0 && previous.participation_id < item.participation_id);
}));
export const deliverySummarySchema = z.object({ state: z.enum(["pending", "fulfilled"]), delivered: count, target }).strict()
  .refine(value => value.state !== "fulfilled" || value.delivered >= value.target);
export const fulfillmentSchema = z.object({ fulfilled_at: timestamp, result: z.enum(["on_time", "late"]), business_days_delta: z.number().int().safe(), target, cutoff_stage_id: uuid, cutoff_stage_name: text, commitment_date: date, candidates }).strict()
  .refine(value => value.candidates.length === value.target && (value.result === "on_time" ? value.business_days_delta >= 0 : value.business_days_delta <= 0) && value.candidates.every(item => compareInstants(item.reached_at, value.fulfilled_at) <= 0));
export const deliveryStatusSchema = z.object({ state: z.enum(["pending", "fulfilled"]), delivered: count, target, cutoff_stage_id: uuid, commitment_date: date, business_days_remaining: z.number().int().safe().nullable(), fulfillment: fulfillmentSchema.nullable() }).strict().refine(value => {
  if (value.state === "pending") return value.fulfillment === null && value.business_days_remaining !== null;
  const frozen = value.fulfillment;
  return frozen !== null && value.business_days_remaining === null && value.delivered >= value.target && frozen.target === value.target && frozen.cutoff_stage_id === value.cutoff_stage_id && frozen.commitment_date === value.commitment_date;
});
// Draft configurations may be incomplete; their preview is rejected by the server.
export const deliveryPreviewSchema = z.object({ would_fulfill: z.boolean(), delivered: count, target, candidates }).strict()
  .refine(value => value.delivered === value.candidates.length && value.would_fulfill === (value.delivered >= value.target));
export type DeliverySummary = z.infer<typeof deliverySummarySchema>;
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;
export type DeliveryPreview = z.infer<typeof deliveryPreviewSchema>;
export type Fulfillment = z.infer<typeof fulfillmentSchema>;
const days = (value: number) => `${Math.abs(value)} ${Math.abs(value) === 1 ? "día hábil" : "días hábiles"}`;
export function remainingCopy(value: number) { return value === 0 ? "Vence hoy" : value < 0 ? `Venció hace ${days(value)}` : `${value === 1 ? "Falta" : "Faltan"} ${days(value)}`; }
export function fulfillmentCopy(value: Fulfillment) {
  return value.result === "late" ? `Entregada con ${days(value.business_days_delta)} de retraso` : value.business_days_delta > 0 ? `Entregada ${days(value.business_days_delta)} antes` : "Entregada a tiempo";
}
export function fulfillmentToast(value: Fulfillment | null) {
  return value ? `${value.target} de ${value.target} candidatos llegaron a «${value.cutoff_stage_name}» · ${value.result === "late" ? `${days(value.business_days_delta)} de retraso` : `a tiempo${value.business_days_delta > 0 ? ` (${days(value.business_days_delta)} antes)` : ""}`}` : "Se alcanzó el objetivo de entrega.";
}
