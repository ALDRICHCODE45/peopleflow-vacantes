/** Loaded/loading geometry; native Card spacing owns all gutters. */
export const PUBLIC_VACANCY_CARD = "min-w-0 rounded-[18px] [--card-spacing:--spacing(6)] [overflow-wrap:anywhere]";
export const PUBLIC_VACANCY_HEADER = "min-w-0 grid-cols-[3rem_minmax(0,1fr)_auto] gap-x-4 has-data-[slot=card-action]:grid-cols-[3rem_minmax(0,1fr)_auto]";
export const PUBLIC_VACANCY_TITLE = "col-start-2 row-start-1 min-w-0";
export const PUBLIC_VACANCY_DESCRIPTION = "col-start-2 row-start-2 min-w-0 break-words";
export const PUBLIC_VACANCY_CONTENT = "flex min-w-0 flex-col gap-5";
export const PUBLIC_VACANCY_CHIPS = "flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 text-sm";
export const PUBLIC_VACANCY_RAIL = "min-w-0 rounded-b-[18px] justify-between gap-6 border-t bg-muted/40 -mb-(--card-spacing) pb-(--card-spacing) max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-5";
/**
 * An idle status slot (nothing in it, or only an empty persistent `role="status"`) gives its reserved height back, but it is never
 * `display:none`: it, and any live region inside, stay mounted in the accessibility tree so the next message is announced.
 */
export const IDLE_STATUS_SLOT_COLLAPSED = "[&_[data-pf-action-status-slot]:empty]:min-h-0 [&_[data-pf-action-status-slot]:has(>[role=status]:empty)]:min-h-0";
/** Below sm the save control and the CTA share one full row; an idle status slot also drops the row gap instead of vanishing. */
const PUBLIC_VACANCY_CTA_PHONE = "max-sm:[&_[data-pf-action-bar]]:flex-wrap max-sm:[&_[data-pf-action-bar-actions]]:basis-full max-sm:[&_[data-pf-action-bar-actions]]:flex-nowrap max-sm:[&_[data-pf-action-bar-actions]>a]:flex-1 max-sm:[&_[data-pf-action-bar:has([data-pf-action-status-slot]:empty)]]:gap-y-0 "+IDLE_STATUS_SLOT_COLLAPSED;
export const PUBLIC_VACANCY_CTA = `flex min-w-0 flex-col items-end gap-2 max-[480px]:items-stretch ${PUBLIC_VACANCY_CTA_PHONE}`;
export const PUBLIC_DETAIL_CARD = "min-w-0 rounded-[18px] [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(7)] [overflow-wrap:anywhere]";
export const PUBLIC_DETAIL_HERO = "min-w-0 rounded-[18px] [--card-spacing:--spacing(6)] sm:[--card-spacing:--spacing(8)] [overflow-wrap:anywhere]";
export const PUBLIC_DETAIL_HEADER = "min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-x-5";
export const PUBLIC_DETAIL_GRID = "grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]";
export const PUBLIC_DETAIL_ASIDE = "row-start-1 min-w-0 lg:col-start-2 lg:sticky lg:top-24 lg:self-start";
export const PUBLIC_DETAIL_FACTS = "grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3";
export const PUBLIC_DETAIL_BODY = "pf-job-body flex flex-col gap-8 text-[15px] leading-[1.65]";
export const PUBLIC_DETAIL_SECTION = "flex scroll-mt-6 flex-col gap-5";
export const PUBLIC_DETAIL_BENEFITS = "grid gap-x-5 gap-y-5 sm:grid-cols-2";
export const PUBLIC_ACTION_CARD = "min-w-0 rounded-[18px] [--card-spacing:--spacing(6)] [overflow-wrap:anywhere]";
export const PUBLIC_COMPANY_FOOTER = "gap-3 rounded-b-[18px] border-t bg-muted/40 -mb-(--card-spacing) pb-(--card-spacing)";
