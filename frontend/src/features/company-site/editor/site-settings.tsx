"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Check, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { FONT_PAIRS } from "../brand";
import { PALETTE_PRESETS } from "../palettes";
import { SITE_THEME_SURFACES, siteBrandTokens } from "../public/theme-tokens";
import { slugAvailabilityAction } from "../api/actions";
import type { FieldError as SiteFieldError } from "../api/model";
import type { SiteDraft } from "../model";
import type { PublicSite } from "../public/schema";
import { editorial, modern } from "../public/fonts";
import { slugFromName, validateSlug } from "../slug";
import styles from "./site-settings.module.css";

export const COMPANY_SETTINGS_HREF = "/empresa/configuracion";
function ColorChip({ color, palette = false }: { color: string; palette?: boolean }) {
  return <span aria-hidden="true" data-palette-swatch={palette ? "" : undefined} className={cn("block size-6 shrink-0 rounded-md ring-1 ring-border", styles.chip)} style={{ "--sample-brand": color } as CSSProperties} />;
}
const COLOR_FIELDS = [
  { key: "brand_color", label: "Principal", role: "brand-text", description: "Identifica tu marca en franjas, títulos y enlaces." },
  { key: "accent_color", label: "Acento/CTA", role: "accent", description: "Destaca acciones como Ver vacantes. Vacío usa el principal." },
  { key: "background_color", label: "Fondo", role: "page", description: "Define el fondo claro. Vacío conserva el fondo original." },
] as const;
type ColorField = typeof COLOR_FIELDS[number];
function BrandColorField({ field, value, sample, tokens, onEdit, onChange }: { field: ColorField; value: string | null; sample: string; tokens: Record<string, string>; onEdit: () => void; onChange: (value: string | null) => void }) {
  const [hex, setHex] = useState(value ?? "");
  useEffect(() => setHex(value ?? ""), [value]);
  const valid = /^#[\da-f]{6}$/i.test(hex) || hex === "" && field.key !== "brand_color";
  const id = `brand-${field.key}`;
  const adjustments = value === null ? [] : (["light", "dark"] as const).flatMap(mode => {
    const roles = field.key === "accent_color" ? ["accent", "banner-accent"] : field.key === "brand_color" ? ["brand", "brand-text"] : ["page"];
    const colors = [...new Set(roles.map(role => tokens[`--site-${role}-${mode}`]).filter((color): color is string => Boolean(color) && color !== value))];
    return colors.map(color => ({ mode, color }));
  });
  return <Field data-invalid={!valid || undefined}>
    <FieldLabel htmlFor={id}>{field.label}</FieldLabel>
    <InputGroup className="min-h-10"><InputGroupInput id={id} value={hex} placeholder={`Automático (${sample})`} maxLength={7} spellCheck={false} aria-invalid={!valid} aria-describedby={`${id}-note${!valid ? ` ${id}-error` : ""}`} onChange={event => {
      const next = event.target.value.toUpperCase(); setHex(next); onEdit();
      if (/^#[\da-f]{6}$/i.test(next)) onChange(next);
      else if (next === "" && field.key !== "brand_color") onChange(null);
    }} /><InputGroupAddon><ColorChip color={sample} /></InputGroupAddon></InputGroup>
    {!valid && <FieldError id={`${id}-error`}>Usa un color hexadecimal de seis dígitos.</FieldError>}
    <FieldDescription id={`${id}-note`}>{field.description}</FieldDescription>
    {adjustments.length > 0 && <div role="status" aria-label={`Ajustes de ${field.label}`} className="flex gap-2 text-sm text-muted-foreground"><TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" /><div className="flex min-w-0 flex-col gap-2"><p>Ajustamos el tono para que el texto se lea bien</p>{adjustments.map(result => <div key={`${result.mode}-${result.color}`} className="flex flex-wrap items-center gap-2"><ColorChip color={value!} /><span>{value} → {result.color}</span><ColorChip color={result.color} /><span className="text-xs">Tema {result.mode === "light" ? "claro" : "oscuro"}</span></div>)}</div></div>}
  </Field>;
}
export function BrandSettings({ theme, onChange }: { theme: SiteDraft["theme"]; onChange: (theme: SiteDraft["theme"]) => void }) {
  const [custom, setCustom] = useState(false);
  const [reset, setReset] = useState(0);
  const preset = PALETTE_PRESETS.find(p => p.brand_color === theme.brand_color && p.accent_color === theme.accent_color && p.background_color === theme.background_color);
  const selected = custom ? "custom" : preset?.name ?? "custom";
  const tokens = siteBrandTokens(theme.brand_color, theme.accent_color, theme.background_color);
  return <FieldGroup>
    <div className="flex flex-col gap-1"><h2 className="text-base font-semibold">Tu marca, tu identidad</h2><p className="text-sm text-muted-foreground">Elige una paleta o personaliza tus colores. El texto se ajusta para que se lea bien.</p></div>
    <FieldSet><FieldLegend id="palette-label" variant="label">Paletas</FieldLegend>
      {/* Official Field choice-card pattern: the whole label selects its radio. */}
      <RadioGroup aria-labelledby="palette-label" value={selected} onValueChange={value => {
        const next = PALETTE_PRESETS.find(p => p.name === value);
        setCustom(!next); setReset(current => current + 1);
        if (next) onChange({ ...theme, brand_color: next.brand_color, accent_color: next.accent_color, background_color: next.background_color });
      }} className={styles.paletteGrid}>
        {PALETTE_PRESETS.map(p => <FieldLabel key={p.name} className="has-data-checked:ring-2 has-data-checked:ring-primary" htmlFor={`palette-${p.name}`}><Field orientation="horizontal"><FieldContent><FieldTitle>{p.name}</FieldTitle><span className="flex flex-wrap gap-1" aria-hidden="true">{[p.brand_color, p.accent_color, p.background_color].map((color, index) => <ColorChip key={index} color={color} palette />)}</span></FieldContent><RadioGroupItem id={`palette-${p.name}`} value={p.name} /></Field></FieldLabel>)}
        <FieldLabel htmlFor="palette-custom" className="col-span-full has-data-checked:ring-2 has-data-checked:ring-primary"><Field orientation="horizontal"><FieldContent><FieldTitle>Personalizado</FieldTitle></FieldContent><RadioGroupItem id="palette-custom" value="custom" /></Field></FieldLabel>
      </RadioGroup>
    </FieldSet>
    <FieldSet><FieldLegend>Personalizar</FieldLegend><FieldDescription>Conservamos tus colores originales. El sitio adapta los tonos en claro y oscuro sin cambiar lo que guardas.</FieldDescription><FieldGroup>
      {COLOR_FIELDS.map(field => <BrandColorField key={`${field.key}-${reset}`} field={field} value={theme[field.key]} sample={theme[field.key] ?? (field.key === "accent_color" ? theme.brand_color : SITE_THEME_SURFACES.light.page)} tokens={tokens} onEdit={() => setCustom(true)} onChange={value => onChange({ ...theme, [field.key]: value })} />)}
    </FieldGroup></FieldSet>
    <Separator />
    <Field><FieldLabel id="font-pair">Tipografía</FieldLabel><FieldDescription>Tres combinaciones pensadas para leerse bien en cualquier pantalla.</FieldDescription>
      <ToggleGroup aria-labelledby="font-pair" value={[theme.font_pair]} onValueChange={values => { const pair = values[0]; if (pair && Object.hasOwn(FONT_PAIRS, pair)) onChange({ ...theme, font_pair: pair as SiteDraft["theme"]["font_pair"] }); }} orientation="vertical" className="w-full items-stretch" variant="outline">
        {Object.entries(FONT_PAIRS).map(([pair, fonts]) => <ToggleGroupItem key={pair} value={pair} aria-label={fonts.label} data-font-pair={pair} className="h-auto w-full min-w-0 flex-col items-stretch whitespace-normal text-left data-pressed:ring-2 data-pressed:ring-ring">
          <span className={cn("flex flex-col gap-3 py-3", editorial.variable, modern.variable, styles.fontSample)} data-font-pair={pair}><span className="flex items-center justify-between gap-2 text-xs font-medium">{fonts.label}{theme.font_pair === pair && <Check aria-hidden="true" className="size-4" />}</span><span className={cn("text-xl font-semibold", styles.heading)}>Tu próximo gran paso</span><span className="text-sm font-normal">Un equipo donde puedes crecer y dejar huella.</span><span className="text-xs font-normal text-muted-foreground">{fonts.heading}{fonts.heading !== fonts.body ? ` + ${fonts.body}` : ""}</span></span>
        </ToggleGroupItem>)}
      </ToggleGroup>
    </Field>
  </FieldGroup>;
}

type Availability = "empty" | "checking" | "available" | "taken" | "reserved" | "invalid" | "error";
const AVAILABILITY_LABELS: Record<Availability, string> = { empty: "Elige una dirección para tu sitio", checking: "Verificando…", available: "Disponible", taken: "En uso", reserved: "Reservada", invalid: "Inválida", error: "No pudimos verificar. Vuelve a editar la dirección para reintentar." };
export function SiteSettings({ draft, company, onSlug, onSeo, savedSlug = null, slugError }: { draft: SiteDraft; company: PublicSite["company"]; onSlug: (slug: string | null) => void; onSeo: (seo: SiteDraft["seo"]) => void; savedSlug?: string | null; slugError?: SiteFieldError }) {
  const [slugInput, setSlugInput] = useState(draft.slug ?? "");
  const [availability, setAvailability] = useState<Availability>("empty");
  const acceptSlug = useRef(onSlug);
  const draftSlug = useRef(draft.slug);
  useEffect(() => { acceptSlug.current = onSlug; draftSlug.current = draft.slug; }, [onSlug, draft.slug]);
  useEffect(() => setSlugInput(current => slugFromName(current) === (draft.slug ?? "") ? current : draft.slug ?? ""), [draft.slug]);
  const normalized = slugFromName(slugInput);
  useEffect(() => {
    let active = true;
    const invalid = validateSlug(normalized);
    if (!normalized) { setAvailability("empty"); return; }
    if (invalid) { setAvailability(invalid); return; }
    if (normalized === savedSlug) {
      setAvailability("available");
      if (normalized !== draftSlug.current) acceptSlug.current(normalized);
      return;
    }
    setAvailability("checking");
    const timer = setTimeout(() => {
      void slugAvailabilityAction(normalized).then(result => {
        if (!active) return;
        if (result.kind !== "success" || result.data.slug !== normalized) setAvailability("error");
        else {
          const available = result.data.available && result.data.reason === null;
          setAvailability(available ? "available" : result.data.reason ?? "error");
          if (available && normalized !== draftSlug.current) acceptSlug.current(normalized);
        }
      }).catch(() => { if (active) setAvailability("error"); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [normalized, savedSlug]);
  // Unverified input never enters the document: a taken/reserved address must
  // not poison unrelated content autosaves or change the header's real URL.
  const fieldAvailability: Availability = normalized === draft.slug && slugError
    ? slugError.code === "duplicate" ? "taken" : slugError.code === "not_allowed" ? "reserved" : "invalid"
    : availability;
  const slugInvalid = ["invalid", "reserved", "taken"].includes(fieldAvailability);
  const socials = [["LinkedIn", company.linkedin_url], ["Instagram", company.instagram_url], ["Facebook", company.facebook_url], ["X", company.twitter_url]] as const;
  return <FieldGroup>
    <div className="flex flex-col gap-1"><h2 className="text-base font-semibold">Configuración del sitio</h2><p className="text-sm text-muted-foreground">Define cómo te encuentran y qué ven al buscarte.</p></div>
    <Field data-invalid={slugInvalid || undefined}><FieldLabel htmlFor="site-slug">Dirección pública</FieldLabel><InputGroup className="min-h-10"><InputGroupInput id="site-slug" value={slugInput} spellCheck={false} aria-describedby="slug-availability slug-note slug-error" aria-invalid={slugInvalid} onChange={event => setSlugInput(event.target.value)} onBlur={() => setSlugInput(normalized)} /><InputGroupAddon><InputGroupText>/empresas/</InputGroupText></InputGroupAddon></InputGroup>
      <p id="slug-availability" role="status" aria-label="Disponibilidad de dirección" aria-live="polite" className="text-sm text-muted-foreground">{AVAILABILITY_LABELS[fieldAvailability]}</p>
      {slugInvalid && <FieldError id="slug-error">{fieldAvailability === "invalid" ? "Usa entre 3 y 60 caracteres: letras minúsculas, números y guiones." : fieldAvailability === "reserved" ? "Esta dirección está reservada. Elige otra." : "Otra empresa ya usa esta dirección. Elige otra."}</FieldError>}
      <FieldDescription id="slug-note">Al publicar con otra dirección, tu URL pública cambia y la dirección anterior redirige a la nueva.</FieldDescription>
    </Field><Separator />
    <h3 className="text-sm font-semibold">Apariencia en buscadores</h3>
    <Field><FieldLabel htmlFor="seo-title">Título SEO</FieldLabel><Input id="seo-title" className="min-h-10" value={draft.seo.title ?? ""} aria-describedby="seo-title-count" onChange={event => { if ([...event.target.value].length <= 60) onSeo({ ...draft.seo, title: event.target.value || null }); }} /><FieldDescription id="seo-title-count">{[...(draft.seo.title ?? "")].length}/60 caracteres</FieldDescription></Field>
    <Field><FieldLabel htmlFor="seo-description">Descripción SEO</FieldLabel><Textarea id="seo-description" value={draft.seo.description ?? ""} aria-describedby="seo-description-count" onChange={event => { if ([...event.target.value].length <= 160) onSeo({ ...draft.seo, description: event.target.value || null }); }} /><FieldDescription id="seo-description-count">{[...(draft.seo.description ?? "")].length}/160 caracteres</FieldDescription></Field>
    <Card size="sm" role="region" aria-label="Vista previa en Google"><CardHeader><CardDescription className="break-all">/empresas/{draft.slug || "tu-empresa"}</CardDescription><CardTitle><h4 className="text-base font-medium text-primary">{draft.seo.title || `Trabaja en ${company.name}`}</h4></CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{draft.seo.description || company.description || "Agrega una descripción para presentar a tu equipo."}</p></CardContent></Card>
    <Separator />
    <section role="region" aria-label="Datos de la empresa" className="flex flex-col gap-4"><h3 className="text-sm font-semibold">Datos de la empresa</h3><p className="text-sm text-muted-foreground">El sitio lee estos datos del perfil de la empresa. Se actualizan desde la configuración, no desde este editor.</p>
      <div className="flex items-center gap-3"><Avatar className="size-10"><AvatarImage src={company.logo_url ?? undefined} alt={`Logo de ${company.name}`} /><AvatarFallback>{company.name.slice(0, 1)}</AvatarFallback></Avatar><p className="font-medium">{company.name}</p></div>
      <p className="text-sm text-muted-foreground">{company.description || "Sin descripción"}</p>
      {company.website ? <a className="min-h-10 break-all text-sm underline underline-offset-4" href={company.website} target="_blank" rel="noopener noreferrer">{company.website}</a> : <p className="text-sm text-muted-foreground">Sin sitio web</p>}
      {!socials.some(([, url]) => url) && <p className="text-sm text-muted-foreground">Sin redes sociales</p>}
      <div className="flex flex-wrap gap-3">{socials.filter(([, url]) => url).map(([label, url]) => <a key={label} href={url!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">{label}</a>)}</div>
      <Button nativeButton={false} role="link" render={<Link href={COMPANY_SETTINGS_HREF} />} variant="outline" className="min-h-10 whitespace-normal text-left">Editar en Configuración de la empresa<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button>
    </section>
  </FieldGroup>;
}
