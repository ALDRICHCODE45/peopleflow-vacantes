"use client";

import { useId, useState } from "react";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PROFESSIONAL_AREA_OPTIONS } from "@/features/jobs/drafts/ui/draft-labels";
import { BLOCK_LIBRARY_V2 } from "../../defaults";
import type { MappedFieldError } from "../../editor-state";
import { HERO_COLLAGE_MAX, HERO_COLLAGE_MIN_TO_PUBLISH, type SiteBlockV2 } from "../../model";
import { mediaUrl } from "../../public/media";
import { IconPicker } from "../icon-picker/icon-picker";
import { ImageField } from "../media";
import { CompleteTarget, fieldMessage, TextField } from "./fields";
import { ItemList } from "./item-list";

type Hero = Extract<SiteBlockV2, { type: "hero" }>;
type Areas = Extract<SiteBlockV2, { type: "areas" }>;
/** Select value for the automatic target (null): the public site links to «Historia»
 * when it's visible and hides the button otherwise (today's published behaviour). */
const FIRST_AFTER_HERO = "__first";

/** Sections a Portada button can point at, labelled like the list (repeats numbered). */
export function sectionOptions(blocks: readonly SiteBlockV2[], exclude?: string) {
  const seen = new Map<string, number>();
  return blocks.flatMap(block => {
    const label = BLOCK_LIBRARY_V2[block.type].label;
    const count = (seen.get(label) ?? 0) + 1; seen.set(label, count);
    const total = blocks.filter(other => BLOCK_LIBRARY_V2[other.type].label === label).length;
    return block.id === exclude ? [] : [{ value: block.id, label: total > 1 ? `${label} (${count})` : label, hidden: block.hidden }];
  });
}

/** «Botones» group (Portada): both texts, show/hide the secondary one and where it leads. */
export function HeroButtons({ block, blocks, fieldErrors, onChange }: { block: Hero; blocks: readonly SiteBlockV2[]; fieldErrors: MappedFieldError[]; onChange: (content: Hero["content"]) => void }) {
  const id = useId();
  const content = block.content;
  const change = (patch: Partial<Hero["content"]>) => onChange({ ...content, ...patch });
  const error = (path: string) => fieldMessage(fieldErrors, block.id, `content.${path}`);
  const options = sectionOptions(blocks, block.id);
  const items = [{ value: FIRST_AFTER_HERO, label: "Automático (Historia)" }, ...options.map(option => ({ value: option.value, label: option.hidden ? `${option.label} · oculta` : option.label }))];
  const target = options.find(option => option.value === content.secondary_target);
  const targetError = error("secondary_target") ?? (target?.hidden ? "Esta sección está oculta. Muéstrala o elige otra para publicar." : undefined);
  return <FieldGroup data-hero-buttons="">
    <TextField label="Botón principal" value={content.primary_label} onChange={primary_label => change({ primary_label })} max={24} description="Lleva a las vacantes de este sitio." error={error("primary_label")} />
    <Field orientation="horizontal"><FieldContent><FieldLabel htmlFor={`${id}-secondary`}>Mostrar botón secundario</FieldLabel></FieldContent><Switch id={`${id}-secondary`} checked={content.secondary_visible} onCheckedChange={secondary_visible => change({ secondary_visible })} /></Field>
    {content.secondary_visible && <>
      <TextField label="Botón secundario" value={content.secondary_label} onChange={secondary_label => change({ secondary_label })} max={24} description="Invita a conocer más de tu empresa." error={error("secondary_label")} />
      <CompleteTarget name="secondary-target"><Field data-invalid={!!targetError}>
        <FieldLabel htmlFor={`${id}-target`}>Lleva a</FieldLabel>
        <Select items={items} value={content.secondary_target ?? FIRST_AFTER_HERO} onValueChange={value => change({ secondary_target: !value || value === FIRST_AFTER_HERO ? null : String(value) })}>
          <SelectTrigger id={`${id}-target`} className="min-h-10 w-full min-w-0" aria-invalid={!!targetError} aria-describedby={`${id}-target-help${targetError ? ` ${id}-target-error` : ""}`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <FieldDescription id={`${id}-target-help`}>Al tocarlo, la página baja hasta esa sección.</FieldDescription>
        {targetError && <FieldError id={`${id}-target-error`}>{targetError}</FieldError>}
      </Field></CompleteTarget>
    </>}
  </FieldGroup>;
}

/** Collage layout: up to three photos, each in its own slot; empty slots are never stored. */
export function CollageField({ block, fieldErrors, onChange }: { block: Hero; fieldErrors: MappedFieldError[]; onChange: (images: Hero["content"]["images"]) => void }) {
  const images = block.content.images;
  const slots = Math.min(HERO_COLLAGE_MAX, images.length + 1);
  const error = fieldMessage(fieldErrors, block.id, "content.images");
  return <Field data-invalid={!!error}>
    <FieldDescription>Fotos del collage: para publicar, al menos {HERO_COLLAGE_MIN_TO_PUBLISH} de {HERO_COLLAGE_MAX}.</FieldDescription>
    {/* The first empty slot is what «Completar sección» focuses. */}
    {Array.from({ length: slots }, (_, index) => <CompleteTarget key={index} name={index === images.length ? "collage" : `collage-${index}`}><ImageField kind="gallery" label={`Foto ${index + 1} del collage`} value={images[index] ?? null}
      onChange={value => onChange(value ? images.length > index ? images.map((image, i) => i === index ? value : image) : [...images, value] : images.filter((_, i) => i !== index))}
      previewUrl={mediaUrl} error={fieldMessage(fieldErrors, block.id, `content.images[${index}]`)} /></CompleteTarget>)}
    {error && <FieldError>{error}</FieldError>}
  </Field>;
}

type Override = Areas["content"]["overrides"][number];
/** «Foto» is a local choice until a photo is uploaded: the stored override keeps its
 * icon meanwhile, so autosave never holds an override with neither (a save error). */
function AreaOverrideFields({ item, index, overrides, error, onChange }: { item: Override; index: number; overrides: Override[]; error: (path: string) => string | undefined; onChange: (overrides: Override[]) => void }) {
  const id = useId();
  const [mode, setMode] = useState<"icon" | "photo">(item.photo !== null ? "photo" : "icon");
  const update = (patch: Partial<Override>) => onChange(overrides.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  const items = PROFESSIONAL_AREA_OPTIONS.filter(option => option.value === item.key || !overrides.some(override => override.key === option.value));
  const keyError = error(`[${index}].key`);
  const look = item.photo !== null ? "photo" : mode;
  return <>
    <Field data-invalid={!!keyError}>
      <FieldLabel htmlFor={`${id}-key`}>Área</FieldLabel>
      <Select items={items} value={item.key} onValueChange={key => { if (key) update({ key: key as Override["key"] }); }}>
        <SelectTrigger id={`${id}-key`} className="min-h-10 w-full min-w-0" aria-invalid={!!keyError}><SelectValue /></SelectTrigger>
        <SelectContent><SelectGroup>{items.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      {keyError && <FieldError>{keyError}</FieldError>}
    </Field>
    <Field>
      <FieldLabel id={`${id}-look`}>Mostrar con</FieldLabel>
      <ToggleGroup aria-labelledby={`${id}-look`} variant="outline" className="grid w-full grid-cols-2" value={[look]}
        onValueChange={values => {
          if (values[0] === "icon") { setMode("icon"); if (item.photo !== null || item.icon === null) update({ icon: item.icon ?? "briefcase", photo: null }); }
          else if (values[0] === "photo") setMode("photo");
        }}>
        <ToggleGroupItem value="icon" className="min-h-10 min-w-0 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">Ícono</ToggleGroupItem>
        <ToggleGroupItem value="photo" className="min-h-10 min-w-0 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">Foto</ToggleGroupItem>
      </ToggleGroup>
    </Field>
    {look === "icon"
      ? <IconPicker allowEmoji={false} label="Ícono" value={{ icon: item.icon ?? "briefcase", emoji: null }} onChange={value => update({ icon: value.icon, photo: null })} error={error(`[${index}].icon`)} />
      : <ImageField kind="gallery" label="Foto del área" description="Mientras no subas una foto, se muestra su ícono." value={item.photo}
          onChange={photo => update(photo ? { photo, icon: null } : { photo: null, icon: item.icon ?? "briefcase" })} previewUrl={mediaUrl} error={error(`[${index}].photo`) ?? error(`[${index}].icon`)} />}
  </>;
}
const areaLabel = (key: string) => PROFESSIONAL_AREA_OPTIONS.find(option => option.value === key)?.label ?? key;
/** Optional per-area look; the areas themselves come from the published vacancies. */
export function AreaOverrides({ block, fieldErrors, onChange }: { block: Areas; fieldErrors: MappedFieldError[]; onChange: (overrides: Override[]) => void }) {
  const overrides = block.content.overrides;
  const error = (path: string) => fieldMessage(fieldErrors, block.id, `content.overrides${path}`);
  const unused = () => PROFESSIONAL_AREA_OPTIONS.find(option => !overrides.some(override => override.key === option.value))?.value;
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-col gap-1"><h3 className="text-sm font-medium">Personalizar áreas</h3><p className="text-sm text-muted-foreground">Las áreas salen de tus vacantes publicadas. Si quieres, cambia el ícono o usa una foto para alguna.</p></div>
    <ItemList countHint="Opcional: personaliza solo las áreas que quieras." items={overrides} min={0} max={PROFESSIONAL_AREA_OPTIONS.length} error={error("")} onChange={onChange}
      create={(): Override => ({ key: (unused() ?? PROFESSIONAL_AREA_OPTIONS[0].value) as Override["key"], icon: "briefcase", photo: null })}
      summary={item => areaLabel(item.key)}>
      {(item, index) => <AreaOverrideFields item={item} index={index} overrides={overrides} error={error} onChange={onChange} />}
    </ItemList>
  </div>;
}
