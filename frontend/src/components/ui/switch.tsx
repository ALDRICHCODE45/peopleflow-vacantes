"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "cn";

/**
 * Shared Base UI Switch primitive.
 *
 * The official `@base-ui/react/switch` root owns the switch semantics, the
 * checked state and the hidden form control; this module only supplies the
 * project paint and the `data-slot` hooks used by the rest of
 * `src/components/ui`. The root renders a native `<button>` through Base UI's
 * `nativeButton` + `render`, so the control keeps real button behaviour while
 * the primitive owns its accessible switch state — no ARIA semantics are
 * authored here. `h-10` keeps the independent hit area at or above 40px, and
 * every color comes from a semantic token.
 */
type SwitchProps = Omit<SwitchPrimitive.Root.Props, "nativeButton" | "render">;

function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      {...props}
      data-slot="switch"
      nativeButton
      render={<button />}
      className={cn(
        "peer inline-flex h-10 w-14 shrink-0 items-center rounded-full p-1 outline-none select-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-unchecked:bg-input motion-reduce:transition-none",
        className,
      )}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-8 rounded-full bg-background shadow-sm ring-1 ring-foreground/10 transition-transform duration-200 data-checked:translate-x-4 data-unchecked:translate-x-0 motion-reduce:transition-none dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
