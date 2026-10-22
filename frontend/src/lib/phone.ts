import { z } from "zod";

/** Exact backend phone contract; only the editable national number is normalized. */
export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/).refine(value => !value.startsWith("+52") || value.length === 13);

export function phoneValue(dial: string, phone: string): string | null {
  if (!phone.trim()) return null;
  const digits = phone.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{0,2}$/.test(dial) || !/^\d+$/.test(digits) || !phoneSchema.safeParse(dial + digits).success) return null;
  return dial + digits;
}

export const phoneError = (dial: string): string => dial === "+52"
  ? "Escribe los 10 dígitos del teléfono en México."
  : "Escribe una lada y un número válidos, de 8 a 15 dígitos en total.";

/**
 * Prefer known dials, longest first. Unknown dials use the longest generic
 * prefix (three digits); this is deterministic, not a country-code catalog.
 * Legacy text is first read without spaces, dashes or parentheses (the same
 * separators the editor strips); ten bare digits are the Mexican national
 * format, so they load under the visible +52 dial. Anything else stays verbatim
 * with no assumed dial: the user must choose a dial and correct it, or clear it.
 */
export function phoneToDraft(value: string | null): { dial: string; phone: string } {
  if (value === null || value === "") return { dial: "+52", phone: "" };
  const compact = value.replace(/[\s()-]/g, "");
  if (/^\d{10}$/.test(compact)) return { dial: "+52", phone: compact };
  if (!phoneSchema.safeParse(compact).success) return { dial: "", phone: value };
  const dial = ["+52", "+1"].find(prefix => compact.startsWith(prefix)) ?? compact.slice(0, 4);
  return { dial, phone: compact.slice(dial.length) };
}
