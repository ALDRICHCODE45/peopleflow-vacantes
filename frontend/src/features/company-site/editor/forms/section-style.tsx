"use client";

import { useId, type ReactNode } from "react";
import { AlignCenter, AlignLeft, ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { contrastRatio } from "../../brand";
import { SECTION_STYLE_LABELS } from "../../defaults";
import type { MappedFieldError } from "../../editor-state";
import { SECTION_ALIGNS, SECTION_BACKGROUNDS, SECTION_OVERLAYS, SECTION_SPACINGS, type SectionStyle } from "../../model";
import { SCRIM_ALPHA, SITE_SCRIM } from "../../public/section-style";
import { mediaUrl } from "../../public/media";
import { siteBrandTokens, siteTintTokens } from "../../public/theme-tokens";
import { ImageField } from "../media";
import { CompleteTarget, fieldMessage } from "./fields";

type Overlay = keyof typeof SCRIM_ALPHA;
type Tone = "success" | "review" | "destructive";
/**
 * Worst case for white text over the image: its lightest (white) pixel under the
 * public page's scrim (same ink and opacity as the presentation, sRGB blending).
 */
export function veilContrast(overlay: Overlay): { ratio: number; label: string; tone: Tone } | null {
  if (!/^#[\da-f]{6}$/i.test(SITE_SCRIM)) return null;
  const alpha = SCRIM_ALPHA[overlay];
  const channel = (offset: number) => Math.round(parseInt(SITE_SCRIM.slice(offset, offset + 2), 16) * alpha + 255 * (1 - alpha)).toString(16).padStart(2, "0");
  const ratio = contrastRatio("#FFFFFF", `#${channel(1)}${channel(3)}${channel(5)}`);
  return { ratio, ...(ratio >= 7 ? { label: "AAA", tone: "success" as const } : ratio >= 4.5 ? { label: "AA", tone: "success" as const } : ratio >= 3 ? { label: "AA en títulos", tone: "review" as const } : { label: "Bajo", tone: "destructive" as const }) };
}
const formatRatio = (ratio: number) => `${ratio.toLocaleString("es-MX", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}:1`;

function Choice<T extends string>({ label, options, value, onChange, labels, icons, description, columns }: { label: string; options: readonly T[]; value: T; onChange: (value: T) => void; labels: Record<T, string>; icons?: Partial<Record<T, ReactNode>>; description?: ReactNode; columns?: boolean }) {
  const id = useId();
  return <Field>
    <FieldLabel id={id}>{label}</FieldLabel>
    {/* Short exclusive choices side by side (rules §24); the selected one is marked with the brand ring. */}
    <ToggleGroup aria-labelledby={id} aria-describedby={description ? `${id}-help` : undefined} variant="outline" value={[value]} onValueChange={values => { if (values[0]) onChange(values[0] as T); }}
      className={columns ? "grid w-full grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] items-stretch" : "grid w-full auto-cols-fr grid-flow-col items-stretch"}>
      {options.map(option => <ToggleGroupItem key={option} value={option} aria-label={labels[option]} className="h-auto min-h-10 min-w-0 flex-col gap-1 py-2 whitespace-normal aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">
        {icons?.[option]}<span className="min-w-0 text-center text-xs leading-tight">{labels[option]}</span>
      </ToggleGroupItem>)}
    </ToggleGroup>
    {description && <div id={`${id}-help`}>{description}</div>}
  </Field>;
}
function Swatch({ color, children }: { color?: string; children?: ReactNode }) {
  // Company brand data, not product paint: the swatch shows the company's own colors.
  return <span aria-hidden="true" data-style-swatch="" className="flex h-6 w-full items-center justify-center rounded-lg border border-border bg-background text-muted-foreground" style={color ? { backgroundColor: color } : undefined}>{children}</span>;
}

/** The layout decides the alignment: say how it renders instead of offering a dead choice. */
function FixedAlign({ align }: { align: SectionStyle["align"] }) {
  const Icon = align === "center" ? AlignCenter : AlignLeft;
  return <Field>
    <FieldTitle>Alineación</FieldTitle>
    <FieldDescription className="flex items-center gap-2"><Icon className="size-4 shrink-0" aria-hidden="true" />{align === "center" ? "Este diseño siempre va centrado." : "Este diseño siempre va alineado a la izquierda."}</FieldDescription>
  </Field>;
}
export type SectionStyleControlsProps = {
  blockId: string; style: SectionStyle;
  /** Set when the chosen layout always renders with this alignment (`fixedSectionAlign`). */
  fixedAlign?: SectionStyle["align"] | null; theme: { brand_color: string; accent_color: string | null; background_color: string | null }; fieldErrors: MappedFieldError[];
  onChange: (style: SectionStyle) => void;
};
/** «Estilo de sección» (S3): curated background, veil, spacing and alignment. */
export function SectionStyleControls({ blockId, style, theme, fieldErrors, onChange, fixedAlign = null }: SectionStyleControlsProps) {
  // The same tokens the public page paints with, so the swatches match the site.
  const tokens = /^#[\da-f]{6}$/i.test(theme.brand_color) ? siteBrandTokens(theme.brand_color, theme.accent_color, theme.background_color) : null;
  const tint = tokens ? siteTintTokens(theme.brand_color, theme.accent_color, theme.background_color) : null;
  const set = (patch: Partial<SectionStyle>) => onChange({ ...style, ...patch });
  const error = (path: string) => fieldMessage(fieldErrors, blockId, path);
  const contrast = style.overlay ? veilContrast(style.overlay) : null;
  return <FieldGroup data-section-style="">
    <FieldDescription>Opciones curadas: siempre respetan tu paleta y el contraste.</FieldDescription>
    {error("style") && <FieldError>{error("style")}</FieldError>}
    <Choice label="Fondo" columns options={SECTION_BACKGROUNDS} value={style.background} labels={SECTION_STYLE_LABELS.background} onChange={background => set({ background })} icons={{
      default: <Swatch />, tint: <Swatch color={tint?.["--site-tint-light"]} />, brand: <Swatch color={tokens?.["--site-brand-light"]} />,
      image: <Swatch><ImageIcon className="size-4" aria-hidden="true" /></Swatch>,
    }} />
    {style.background === "image" && <>
      <CompleteTarget name="style-image"><ImageField kind="cover" label="Imagen de fondo" description="Se ve detrás del contenido de la sección. Es necesaria para publicar." value={style.image} onChange={image => set({ image })} previewUrl={mediaUrl} error={error("style.image")} /></CompleteTarget>
      <Choice label="Intensidad del velo" options={SECTION_OVERLAYS} value={style.overlay ?? "medium"} labels={SECTION_STYLE_LABELS.overlay} onChange={overlay => set({ overlay })}
        description={<p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{contrast ? <><Badge variant={contrast.tone}>{contrast.label}</Badge><span className="min-w-0">Contraste {formatRatio(contrast.ratio)} si la foto es muy clara.</span></> : <span>Un velo más fuerte hace que el texto se lea mejor sobre la foto.</span>}</p>} />
      {error("style.overlay") && <FieldError>{error("style.overlay")}</FieldError>}
    </>}
    <Choice label="Espaciado" options={SECTION_SPACINGS} value={style.spacing} labels={SECTION_STYLE_LABELS.spacing} onChange={spacing => set({ spacing })} />
    {fixedAlign ? <FixedAlign align={fixedAlign} /> : <Choice label="Alineación" options={[...SECTION_ALIGNS].reverse() as typeof SECTION_ALIGNS[number][]} value={style.align} labels={SECTION_STYLE_LABELS.align} onChange={align => set({ align })}
      icons={{ start: <AlignLeft className="size-4" aria-hidden="true" />, center: <AlignCenter className="size-4" aria-hidden="true" /> }} />}
  </FieldGroup>;
}
