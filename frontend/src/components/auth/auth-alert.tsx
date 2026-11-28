import * as React from "react";
import { CircleAlertIcon, CircleCheckIcon, HourglassIcon, InfoIcon, WifiOffIcon } from "lucide-react";
import styles from "./login-screen.module.css";
import type { AlertTone } from "./sign-in/copy";

const TONE_CLASS = { danger: styles.alertDanger, review: styles.alertReview, info: styles.alertInfo, success: styles.alertSuccess } as const;
const TONE_ICON = { danger: CircleAlertIcon, review: HourglassIcon, info: InfoIcon, success: CircleCheckIcon } as const;

export const AUTH_FOCUS_RING = "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
export const AUTH_LINK_CLASS = `${styles.accentText} ${styles.accentText} inline-flex min-h-11 items-center text-[13px] font-semibold underline-offset-4 hover:underline ${AUTH_FOCUS_RING}`;

export type AuthAlertProps = {
  id: string;
  tone: AlertTone;
  title: string;
  body?: string;
  /** The network failure uses the «sin conexión» icon instead of the tone's. */
  offline?: boolean;
  children?: React.ReactNode;
  ref?: React.Ref<HTMLDivElement>;
};

/**
 * The artboard `.al` card above a form: `status` for info/success, `alert`
 * otherwise; focusable (tabindex=-1) so an error summary can take the focus.
 */
export function AuthAlert({ id, tone, title, body, offline = false, children, ref }: AuthAlertProps) {
  const Icon = offline ? WifiOffIcon : TONE_ICON[tone];
  return (
    <div
      ref={ref}
      id={id}
      role={tone === "info" || tone === "success" ? "status" : "alert"}
      tabIndex={-1}
      className={`${styles.alert} ${styles.alert} ${TONE_CLASS[tone]} mb-5 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-foreground`}
    >
      <Icon aria-hidden="true" className={`${styles.alertIcon} mt-0.5 size-[18px] shrink-0`} />
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-5">{title}</p>
        {body && <p className="mt-0.5 text-[13px] leading-[18px] [overflow-wrap:anywhere]">{body}</p>}
        {children}
      </div>
    </div>
  );
}
