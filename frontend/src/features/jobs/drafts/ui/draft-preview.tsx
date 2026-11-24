import { compensationSchema } from "../compensation";
import type { DraftCompensationState } from "./draft-form-state";
import { BASIS_OPTIONS, PAY_PERIOD_OPTIONS, type DraftOption } from "./draft-labels";

function labelOf(options: DraftOption[], value: string): string | null {
  return options.find(option => option.value === value)?.label ?? null;
}

/**
 * What keeps a salary the user marked «visible» from showing publicly. The backend publishes a salary only with
 * `public_visible` and a mode, a currency, a pay period and a basis (gross/net); anything else stays hidden.
 * Empty when the salary is not meant to be shown or nothing is missing.
 */
export function publicCompensationGaps(state: DraftCompensationState): string[] {
  if (!state.public_visible) return [];
  return [[state.mode, "el modo de compensación"], [state.currency, "la moneda"], [state.pay_period, "el periodo de pago"], [state.basis, "si el monto es bruto o neto"]]
    .flatMap(([value, label]) => value ? [] : [label]);
}

/** «El salario no se mostrará: falta la moneda y el periodo de pago.» */
export function publicCompensationGapsMessage(gaps: readonly string[]): string {
  const list = gaps.length > 1 ? `${gaps.slice(0, -1).join(", ")} y ${gaps[gaps.length - 1]}` : gaps[0];
  return `El salario no se mostrará: falta ${list}.`;
}

/** Internal-only exact money; never feed this projection to the public preview. */
export function internalCompensationView(state: DraftCompensationState) {
  const mode = state.mode || null;
  const parsed = compensationSchema.safeParse({
    mode, amount: mode === "fixed" ? state.amount || null : null,
    min: mode === "range" ? state.min || null : null, max: mode === "range" ? state.max || null : null,
    currency: state.currency || null, pay_period: state.pay_period || null,
    basis: state.basis || null, public_visible: state.public_visible,
  });
  if (!parsed.success) return null;
  const { amount, min, max, currency } = parsed.data;
  const money = (value: string) => {
    const [whole, fraction] = value.split(".");
    return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",")}${!fraction || fraction === "00" ? "" : `.${fraction}`}`;
  };
  const value = mode === "fixed" ? amount === null ? null : money(amount)
    : mode === "range" ? min !== null && max !== null ? `${money(min)} – ${money(max)}`
      : min !== null ? `Desde ${money(min)}` : max !== null ? `Hasta ${money(max)}` : null : null;
  return {
    amount: value === null ? "Sin definir" : `${value}${currency ? ` ${currency}` : " · Moneda sin definir"}`,
    meta: [labelOf(PAY_PERIOD_OPTIONS, state.pay_period) ?? "Periodicidad sin definir", labelOf(BASIS_OPTIONS, state.basis) ?? "Neto/bruto sin definir"].join(" · "),
  };
}
