"use client";

import * as React from "react";
import { ArrowRightIcon, BookmarkIcon, LinkIcon, MailIcon, Share2Icon } from "lucide-react";

import { cn } from "../../../lib/utils";

/** How long one momentary confirmation stays announced before it clears. */
const MOMENTARY_TIMEOUT_MS = 2500;

/** Lucide marks this island maps internally: no icon element crosses the boundary. */
const FEEDBACK_ICONS = {
  bookmark: BookmarkIcon,
  apply: ArrowRightIcon,
  copy: LinkIcon,
  share: Share2Icon,
  mail: MailIcon,
} as const;

/** Serializable icon enum: the caller never sends a component or an element. */
export type PrototypeFeedbackIcon = keyof typeof FEEDBACK_ICONS;

/** Every prop both modes share, all of them serializable primitives. */
type PrototypeFeedbackBase = {
  readonly icon: PrototypeFeedbackIcon;
  /** Accessible name while the control is inactive. */
  readonly label: string;
  /** Parent-owned classes, so the island keeps the shipped appearance. */
  readonly className: string;
  readonly iconClassName?: string;
  readonly iconPosition?: "start" | "end";
  /** Icon-only controls carry an accessible name and no visible text. */
  readonly iconOnly?: boolean;
  readonly text?: string;
  readonly title?: string;
  readonly describedBy?: string;
};

/** One activation replaces the announced text and, in `momentary` mode, re-arms the clear timer. */
export type PrototypeFeedbackButtonProps = PrototypeFeedbackBase &
  (
    | { readonly mode: "toggle"; readonly activeLabel: string; readonly activeFeedback: string; readonly inactiveFeedback: string }
    | { readonly mode: "momentary"; readonly feedback: string }
  );

/** Restrained press feedback, guarded for reduced motion, in the token layer. */
const PRESS_FEEDBACK = "transition-[scale,color,background-color,border-color] duration-150 ease-out motion-safe:active:scale-[0.96] motion-reduce:active:scale-100 motion-reduce:transition-none";

/** Inactive accessible name, or the active one once a toggle control is pressed. */
function accessibleNameFor(props: PrototypeFeedbackButtonProps, pressed: boolean): string {
  if (props.mode === "momentary") return props.label;
  return pressed ? props.activeLabel : props.label;
}

/**
 * The single client island every prototype feedback affordance uses. It owns
 * two local states and nothing else: a `toggle` control flips `aria-pressed`
 * and its accessible name, a `momentary` control stays unpressed and clears
 * its confirmation after about 2.5 seconds, and both announce honest
 * demonstration feedback — never a real save, application, copy, share,
 * e-mail, or request — through a visually hidden sibling `role="status"`
 * region, so only plain strings and enums ever cross the boundary.
 */
export function PrototypeFeedbackButton(props: PrototypeFeedbackButtonProps) {
  const [pressed, setPressed] = React.useState(false);
  const [announcement, setAnnouncement] = React.useState<{ message: string; sequence: number } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending clear must never outlive the island that scheduled it.
  React.useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  /** A fresh sequence re-keys the text node, so an identical message re-announces. */
  function announce(message: string) {
    setAnnouncement((current) => ({ message, sequence: (current?.sequence ?? 0) + 1 }));
  }

  function activate() {
    if (props.mode === "momentary") {
      announce(props.feedback);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => { timer.current = null; setAnnouncement(null); }, MOMENTARY_TIMEOUT_MS);
      return;
    }
    const next = !pressed;
    setPressed(next);
    announce(next ? props.activeFeedback : props.inactiveFeedback);
  }

  const Icon = FEEDBACK_ICONS[props.icon];
  const label = props.iconOnly === true ? null : props.text;
  const icon = <Icon aria-hidden="true" className={props.iconClassName ?? "size-4"} />;
  const [leading, trailing] = props.iconPosition === "end" ? [label, icon] : [icon, label];

  return (
    <>
      <button
        type="button"
        className={cn(props.className, PRESS_FEEDBACK)}
        aria-pressed={props.mode === "toggle" ? pressed : undefined}
        aria-label={accessibleNameFor(props, pressed)}
        aria-describedby={props.describedBy}
        title={props.title ?? accessibleNameFor(props, pressed)}
        onClick={activate}
      >
        {leading}
        {trailing}
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {announcement === null ? null : <span key={announcement.sequence}>{announcement.message}</span>}
      </span>
    </>
  );
}
