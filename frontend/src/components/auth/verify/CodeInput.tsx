"use client";

import * as React from "react";
import { CODE_LENGTH } from "@/lib/auth/sign-up/contract";

export { CODE_LENGTH };

export function emptyCode(): string[] {
  return Array.from({ length: CODE_LENGTH }, () => "");
}

export type CodeInputHandle = { focus(index?: number): void };

export type CodeInputProps = {
  digits: readonly string[];
  onDigitsChange(next: string[]): void;
  /** Every box has a digit (typed, pasted or autofilled): the screen moves the focus to «Verificar». */
  onFilled?(): void;
  hint: string;
  invalid?: boolean;
  readOnly?: boolean;
  /** Ids of messages about the whole code (an alert, an error), cited by the fieldset. */
  describedBy?: string;
  ref?: React.Ref<CodeInputHandle>;
};

const BOX_CLASS = "h-14 w-full min-w-0 rounded-xl border border-border bg-background text-center font-mono text-[22px] font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-status-danger read-only:text-muted-foreground";

const digitsOf = (value: string) => value.replace(/[^0-9]/g, "");

/**
 * Six one-digit boxes in a «Código de verificación» fieldset (artboard
 * «Verifica tu correo»): typing advances, Backspace clears and goes back,
 * ← → move, a pasted or autofilled code fills the boxes (spaces and dashes
 * dropped). It never submits by itself.
 */
export function CodeInput({ digits, onDigitsChange, onFilled, hint, invalid = false, readOnly = false, describedBy, ref }: CodeInputProps) {
  const boxes = React.useRef<(HTMLInputElement | null)[]>([]);
  const hintId = React.useId();
  const focusBox = (index: number) => boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))]?.focus();

  React.useImperativeHandle(ref, () => ({
    focus(index = 0) { focusBox(index); },
  }), []);

  /** Writes `incoming` from box `start` on; moves the focus to the next empty box or reports filled. */
  function fill(start: number, incoming: string) {
    const next = [...digits];
    const from = incoming.length >= CODE_LENGTH ? 0 : start;
    for (let offset = 0; offset < incoming.length && from + offset < CODE_LENGTH; offset += 1) next[from + offset] = incoming[offset]!;
    onDigitsChange(next);
    const written = Math.min(CODE_LENGTH, from + incoming.length);
    if (next.every((digit) => digit !== "")) onFilled?.();
    else focusBox(written < CODE_LENGTH ? written : next.findIndex((digit) => digit === ""));
  }

  function onChange(index: number, value: string) {
    if (readOnly) return;
    const typed = digitsOf(value);
    if (typed === "") {
      // A cleared box (or only non-digits typed): keep what the box had unless it was emptied.
      if (value === "") onDigitsChange(digits.map((digit, position) => (position === index ? "" : digit)));
      return;
    }
    const previous = digits[index] ?? "";
    // A digit typed into a filled box: keep the new one, wherever the caret was.
    if (typed.length === 2 && previous !== "") return fill(index, typed[0] === previous ? typed[1]! : typed[0]!);
    fill(index, typed);
  }

  function onPaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    if (readOnly) return;
    const pasted = digitsOf(event.clipboardData.getData("text"));
    if (pasted !== "") fill(index, pasted.slice(0, CODE_LENGTH));
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowLeft") { event.preventDefault(); focusBox(index - 1); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); focusBox(index + 1); return; }
    if (event.key !== "Backspace" || readOnly) return;
    event.preventDefault();
    if (digits[index]) {
      onDigitsChange(digits.map((digit, position) => (position === index ? "" : digit)));
      return;
    }
    if (index === 0) return;
    onDigitsChange(digits.map((digit, position) => (position === index - 1 ? "" : digit)));
    focusBox(index - 1);
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}>
      <legend className="mb-1.5 text-[13px] font-medium text-foreground">Código de verificación</legend>
      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_0.5rem_repeat(3,minmax(0,1fr))] gap-2">
        {digits.map((digit, index) => (
          <React.Fragment key={index}>
            {index === CODE_LENGTH / 2 && <span aria-hidden="true" />}
            <input
              ref={(element) => { boxes.current[index] = element; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              aria-label={`Dígito ${index + 1} de ${CODE_LENGTH}`}
              value={digit}
              readOnly={readOnly}
              aria-invalid={invalid || undefined}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => onChange(index, event.target.value)}
              onPaste={(event) => onPaste(index, event)}
              onKeyDown={(event) => onKeyDown(index, event)}
              className={BOX_CLASS}
            />
          </React.Fragment>
        ))}
      </div>
      <p id={hintId} className="text-[13px] leading-[18px] text-muted-foreground">{hint}</p>
    </fieldset>
  );
}
