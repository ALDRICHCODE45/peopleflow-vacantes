"use client";

import { useId, type ReactNode } from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "cn";
import { AlertCircle, Check, Lock, Minus } from "lucide-react";

/**
 * Choose among options as list rows (artboard `design/choice-and-file-controls/03`): a `divide-y` list, the whole row is the target, a 3 px
 * selection bar on the left and a trailing check (circle = one, square = many). Replaces the bare radio / option checkbox
 * (`design/system.md` «Component rules»). Single = radiogroup (arrow keys move and select); multiple = a group of checkboxes, with a first
 * «Seleccionar todo» row (indeterminate + count) from 3 options.
 */
export type ChoiceOption = {
  value: string;
  title: ReactNode;
  description?: ReactNode;
  /** A quiet line under the title (dates, a badge). */
  meta?: ReactNode;
  /** Icon or avatar before the text. */
  leading?: ReactNode;
  disabled?: boolean;
  /** Why it cannot be chosen; shown in the row and announced as the description. */
  disabledReason?: ReactNode;
  /** A problem with this option alone (server validation). */
  error?: ReactNode;
};

type Common = {
  legend: ReactNode;
  /** Keep the legend for assistive technology only when a visible heading already names the list. */
  hideLegend?: boolean;
  options: ChoiceOption[];
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
};
type Single = Common & { multiple?: false; value: string | null; onValueChange: (value: string) => void };
type Multiple = Common & {
  multiple: true; value: string[]; onValueChange: (value: string[]) => void;
  /** «Seleccionar todo» first row. Default: from 3 selectable options. */
  selectAll?: boolean;
  countLabel?: (selected: number, total: number) => string;
};
export type ChoiceListProps = Single | Multiple;

const defaultCount = (selected: number, total: number) => selected === 0 ? "Ninguna elegida" : `${selected} de ${total} elegidas`;

// `group/row` carries the Base UI state (`data-checked`, `data-indeterminate`, `data-disabled`) down to the bar and the trailing mark.
const ROW = cn(
  "group/row relative flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left outline-none select-none",
  "not-first:border-t not-first:border-border/60 hover:bg-muted/70 motion-reduce:transition-none",
  "data-checked:bg-primary/7 data-indeterminate:bg-primary/7",
  // The 3 px selection bar; the keyboard focus is a separate 2 px outline inside the row (`outline-solid` is explicit: `outline-none` sets the style to none in Tailwind v4), so focus never looks like selection.
  "before:pointer-events-none before:absolute before:inset-y-3.5 before:left-0 before:w-[3px] before:rounded-full before:bg-selection before:opacity-0 data-checked:before:opacity-100 data-indeterminate:before:opacity-100",
  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-primary-text",
  "data-disabled:cursor-not-allowed data-disabled:bg-muted data-disabled:hover:bg-muted",
);
const MARK = "ml-auto grid size-6 shrink-0 place-items-center bg-card text-selection-foreground shadow-[inset_0_0_0_1.5px_var(--control-edge)] group-data-checked/row:bg-selection group-data-checked/row:shadow-none group-data-indeterminate/row:bg-selection group-data-indeterminate/row:shadow-none group-data-disabled/row:bg-transparent group-data-disabled/row:shadow-[inset_0_0_0_1.5px_var(--border)] [&>svg]:size-3.5 [&>svg]:opacity-0 [&>svg]:stroke-[3] group-data-checked/row:[&>svg]:opacity-100 group-data-indeterminate/row:[&>svg]:opacity-100 group-data-disabled/row:[&>svg]:opacity-0";

function Body({ option, ids }: { option: ChoiceOption; ids: { title: string; text: string } }) {
  return <>
    {option.leading && <span aria-hidden="true" className="flex shrink-0 items-center text-muted-foreground group-data-checked/row:text-primary-text [&>svg]:size-5">{option.leading}</span>}
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span id={ids.title} className={cn("text-sm leading-5 font-medium [overflow-wrap:anywhere]", option.disabled && "font-normal text-muted-foreground")}>{option.title}</span>
      <span id={ids.text} className="flex flex-col gap-0.5">
        {option.disabled && option.disabledReason
          ? <span className="flex items-start gap-1.5 text-xs leading-4 text-muted-foreground"><Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" /><span>{option.disabledReason}</span></span>
          : <>{option.description && <span className="text-xs leading-4 text-muted-foreground">{option.description}</span>}
            {option.meta && <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-muted-foreground">{option.meta}</span>}</>}
      </span>
      {option.error && <span id={`${ids.text}-error`} role="alert" className="flex items-start gap-1.5 text-xs leading-4 text-status-danger"><AlertCircle aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{option.error}</span>}
    </span>
  </>;
}

function describedBy(option: ChoiceOption, textId: string) {
  const hasText = option.disabled ? Boolean(option.disabledReason) : Boolean(option.description || option.meta);
  return [hasText ? textId : null, option.error ? `${textId}-error` : null].filter(Boolean).join(" ") || undefined;
}

/** Choice rows: see the file header. Validation and what the choice means stay with the caller. */
export function ChoiceList(props: ChoiceListProps) {
  const { legend, hideLegend, options, error, disabled, className } = props;
  const base = useId();
  const legendId = `${base}-legend`;
  const errorId = `${base}-error`;
  const row = (option: ChoiceOption) => {
    const ids = { title: `${base}-${option.value}-title`, text: `${base}-${option.value}-text` };
    return { ids, aria: { "aria-labelledby": ids.title, "aria-describedby": describedBy(option, ids.text), "aria-invalid": option.error ? true : undefined } as const };
  };
  const frame = cn("flex flex-col overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_var(--border)]", error && "shadow-[0_0_0_1.5px_var(--destructive)]");
  const errorLine = error && <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-status-danger"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{error}</p>;
  const shell = { "data-slot": "choice-list", "aria-labelledby": legendId, "aria-describedby": error ? errorId : undefined, "aria-invalid": error ? true : undefined } as const;

  if (!props.multiple) {
    return <div className={cn("flex flex-col gap-2.5", className)}>
      <span id={legendId} className={cn("text-sm font-medium", hideLegend && "sr-only")}>{legend}</span>
      <RadioGroupPrimitive {...shell} value={props.value ?? ""} disabled={disabled} onValueChange={next => props.onValueChange(String(next))} className={frame}>
        {options.map(option => {
          const { ids, aria } = row(option);
          return <RadioPrimitive.Root key={option.value} value={option.value} disabled={option.disabled} render={<div />} className={ROW} {...aria}>
            <Body option={option} ids={ids} />
            <span aria-hidden="true" className={cn(MARK, "rounded-full")}><Check /></span>
          </RadioPrimitive.Root>;
        })}
      </RadioGroupPrimitive>
      {errorLine}
    </div>;
  }

  const { value, onValueChange } = props;
  const enabled = options.filter(option => !option.disabled);
  const chosen = enabled.filter(option => value.includes(option.value)).length;
  const showAll = props.selectAll ?? enabled.length >= 3;
  const count = (props.countLabel ?? defaultCount)(chosen, enabled.length);
  const toggle = (option: ChoiceOption, on: boolean) => onValueChange(on ? [...value.filter(entry => entry !== option.value), option.value] : value.filter(entry => entry !== option.value));
  function toggleAll(on: boolean) {
    const rest = value.filter(entry => !enabled.some(option => option.value === entry));
    // Order of the list, disabled options that were already chosen keep their place.
    onValueChange(on ? [...rest, ...enabled.map(option => option.value)] : rest);
  }
  return <div className={cn("flex flex-col gap-2.5", className)}>
    <span id={legendId} className={cn("text-sm font-medium", hideLegend && "sr-only")}>{legend}</span>
    <div role="group" {...shell} className={frame}>
      {showAll && enabled.length > 0 && <CheckboxPrimitive.Root render={<div />} className={cn(ROW, "min-h-12 bg-muted/55")} disabled={disabled} aria-labelledby={`${base}-all`}
        checked={chosen === enabled.length} indeterminate={chosen > 0 && chosen < enabled.length} onCheckedChange={next => toggleAll(next)}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span id={`${base}-all`} className="text-sm leading-5 font-medium">Seleccionar todo</span>
          <span aria-hidden="true" className="text-xs leading-4 text-muted-foreground tabular-nums">{count}</span></span>
        <span aria-hidden="true" className={cn(MARK, "rounded-[7px]")}>{chosen > 0 && chosen < enabled.length ? <Minus /> : <Check />}</span>
      </CheckboxPrimitive.Root>}
      {options.map(option => {
        const { ids, aria } = row(option);
        return <CheckboxPrimitive.Root key={option.value} render={<div />} className={ROW} disabled={disabled || option.disabled} checked={value.includes(option.value)} onCheckedChange={next => toggle(option, next)} {...aria}>
          <Body option={option} ids={ids} />
          <span aria-hidden="true" className={cn(MARK, "rounded-[7px]")}><Check /></span>
        </CheckboxPrimitive.Root>;
      })}
    </div>
    {showAll && <span role="status" className="sr-only">{count}</span>}
    {errorLine}
  </div>;
}
