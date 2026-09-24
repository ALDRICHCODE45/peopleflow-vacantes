import { ArrowRightIcon, BookmarkIcon, LinkIcon, MailIcon, Share2Icon } from "lucide-react";

import { cn } from "../../../lib/utils";

/** Lucide marks this renderer maps internally: no icon element crosses an API boundary. */
const FEEDBACK_ICONS = {
  bookmark: BookmarkIcon,
  apply: ArrowRightIcon,
  copy: LinkIcon,
  share: Share2Icon,
  mail: MailIcon,
} as const;

/** Serializable icon enum: the caller never sends a component or an element. */
export type PrototypeFeedbackIcon = keyof typeof FEEDBACK_ICONS;

/** Every prop the renderer accepts, all of them serializable primitives. */
export type PrototypeFeedbackButtonProps = {
  readonly icon: PrototypeFeedbackIcon;
  /** Accessible name of the control. */
  readonly label: string;
  /** Parent-owned classes, so the control keeps the shipped appearance. */
  readonly className: string;
  readonly iconClassName?: string;
  readonly iconPosition?: "start" | "end";
  /** Icon-only controls carry an accessible name and no visible text. */
  readonly iconOnly?: boolean;
  readonly text?: string;
  readonly title?: string;
  readonly describedBy?: string;
};

/** Restrained press feedback, guarded for reduced motion, in the token layer. */
const PRESS_FEEDBACK = "transition-[scale,color,background-color,border-color] duration-150 ease-out motion-safe:active:scale-[0.96] motion-reduce:active:scale-100 motion-reduce:transition-none";

/**
 * A plain placeholder action renderer shared by the public vacancy card and the
 * canonical detail. It is a real, enabled `type="button"` element so it stays
 * visible, focusable, and activatable by pointer and keyboard, but it carries
 * no handler, state, timer, live region, pressed state, or feedback text: an
 * activation never navigates, writes, emits a request, or changes a label.
 * Only plain strings and enums cross into it, and it owns no browser API.
 */
export function PrototypeFeedbackButton(props: PrototypeFeedbackButtonProps) {
  const Icon = FEEDBACK_ICONS[props.icon];
  const label = props.iconOnly === true ? null : props.text;
  const icon = <Icon aria-hidden="true" className={props.iconClassName ?? "size-4"} />;
  const [leading, trailing] = props.iconPosition === "end" ? [label, icon] : [icon, label];

  return (
    <button
      type="button"
      className={cn(props.className, PRESS_FEEDBACK)}
      aria-label={props.label}
      aria-describedby={props.describedBy}
      title={props.title ?? props.label}
    >
      {leading}
      {trailing}
    </button>
  );
}
