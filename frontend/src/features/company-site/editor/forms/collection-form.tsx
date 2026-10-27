"use client";

import { useId } from "react";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { LocationField } from "@/features/geo/location-field";
import { locationValueToWrite } from "@/features/geo/model";
import type { ReactNode } from "react";
import type { SiteBlock } from "../../model";
import { mediaUrl } from "../../public/media";
import { ImageField } from "../media";
import { fieldMessage, IconField, TextField } from "./fields";
import { ItemList } from "./item-list";
import type { FormProps } from "./section-form";

function ConsentField({ value, onChange, error }: { value: boolean; onChange: (value: boolean) => void; error?: string }) {
  const id = useId();
  return <Field data-invalid={!!error} orientation="horizontal"><FieldContent><FieldLabel htmlFor={id}>Tengo permiso para publicar este testimonio</FieldLabel><FieldDescription id={`${id}-help`}>Confirma que la persona autorizó publicar su nombre, testimonio y foto. Es necesario para publicar.</FieldDescription>{error && <FieldError id={`${id}-error`}>{error}</FieldError>}</FieldContent><Switch id={id} checked={value} onCheckedChange={onChange} aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`} /></Field>;
}
export function CollectionForm({ block, dispatch, fieldErrors }: FormProps) {
  const error = (path: string) => fieldMessage(fieldErrors, block.id, `content.${path}`);
  function list<T>(items: T[], blank: () => T, min: number, max: number, summary: (item: T) => string | null, fields: (item: T, index: number, update: (patch: Partial<T>) => void) => ReactNode) {
    // Each switch branch supplies its own item type and complete blank template.
    const set = (next: T[]) => dispatch({ type: "content", id: block.id, content: { ...block.content, items: next } as SiteBlock["content"] });
    return <ItemList items={items} create={blank} min={min} max={max} onChange={set} error={error("items")} summary={(item, i) => summary(item)?.trim() || `Elemento ${i + 1}`}>
      {(item, i) => fields(item, i, patch => set(items.map((entry, j) => j === i ? { ...entry, ...patch } : entry)))}
    </ItemList>;
  }
  const itemError = (i: number, key: string) => error(`items[${i}].${key}`);
  switch (block.type) {
    case "values": return <>
      <TextField label="Misión" value={block.content.mission} onChange={mission => dispatch({ type: "content", id: block.id, content: { ...block.content, mission } })} max={300} description="Comparte lo que guía a tu empresa. Es opcional." error={error("mission")} multiline />
      {list(block.content.items, () => ({ icon: "heart" as const, title: null, description: null }), 1, 8, item => item.title, (item, i, update) => <>
        <IconField value={item.icon} onChange={icon => update({ icon })} error={itemError(i, "icon")} />
        <TextField label="Título" value={item.title} onChange={title => update({ title })} max={60} description="Nombra este valor. Es necesario para publicar." error={itemError(i, "title")} />
        <TextField label="Descripción" value={item.description} onChange={description => update({ description })} max={240} description="Cuenta cómo lo viven en tu equipo. Es opcional." error={itemError(i, "description")} multiline />
      </>)}
    </>;
    case "benefits": return list(block.content.items, () => ({ icon: "gift" as const, title: null, description: null }), 1, 24, item => item.title, (item, i, update) => <>
      <IconField value={item.icon} onChange={icon => update({ icon })} error={itemError(i, "icon")} />
      <TextField label="Título" value={item.title} onChange={title => update({ title })} max={60} description="Nombra este beneficio. Es necesario para publicar." error={itemError(i, "title")} />
      <TextField label="Descripción" value={item.description} onChange={description => update({ description })} max={160} description="Explica qué incluye. Es opcional." error={itemError(i, "description")} multiline />
    </>);
    case "stats": return list(block.content.items, () => ({ value: null, label: null }), 1, 6, item => item.label || item.value, (item, i, update) => <>
      <TextField label="Valor" value={item.value} onChange={value => update({ value })} max={12} description="Escribe una cifra real, por ejemplo «120+». Es necesaria para publicar." error={itemError(i, "value")} />
      <TextField label="Etiqueta" value={item.label} onChange={label => update({ label })} max={60} description="Explica qué representa la cifra. Es necesaria para publicar." error={itemError(i, "label")} />
    </>);
    case "process": return list(block.content.items, () => ({ title: null, description: null, duration: null }), 2, 8, item => item.title, (item, i, update) => <>
      <TextField label="Título" value={item.title} onChange={title => update({ title })} max={60} description="Nombra este paso. Es necesario para publicar." error={itemError(i, "title")} />
      <TextField label="Descripción" value={item.description} onChange={description => update({ description })} max={200} description="Explica qué puede esperar la persona. Es opcional." error={itemError(i, "description")} multiline />
      <TextField label="Duración" value={item.duration} onChange={duration => update({ duration })} max={30} description="Indica un tiempo aproximado. Es opcional." error={itemError(i, "duration")} />
    </>);
    case "gallery": return list(block.content.items, () => ({ image: null, alt: null, caption: null }), 2, 12, item => item.caption || item.alt, (item, i, update) => <>
      <ImageField kind="gallery" label="Imagen" description="Comparte una foto de tu cultura. Es necesaria para publicar." value={item.image} onChange={image => update({ image })} previewUrl={mediaUrl} error={itemError(i, "image")} />
      <TextField label="Texto alternativo" value={item.alt} onChange={alt => update({ alt })} max={160} description="Describe lo que aparece para quienes no pueden ver la imagen. Es necesario para publicar." error={itemError(i, "alt")} />
      <TextField label="Pie de foto" value={item.caption} onChange={caption => update({ caption })} max={120} description="Agrega contexto a la foto. Es opcional." error={itemError(i, "caption")} />
    </>);
    case "testimonials": return list(block.content.items, () => ({ quote: null, name: null, role: null, photo: null, consent: false }), 1, 6, item => item.name, (item, i, update) => <>
      <TextField label="Testimonio" value={item.quote} onChange={quote => update({ quote })} max={400} description="Comparte las palabras de esta persona. Es necesario para publicar." error={itemError(i, "quote")} multiline />
      <TextField label="Nombre" value={item.name} onChange={name => update({ name })} max={80} description="Indica quién comparte el testimonio. Es necesario para publicar." error={itemError(i, "name")} />
      <TextField label="Puesto" value={item.role} onChange={role => update({ role })} max={80} description="Agrega su puesto o área. Es opcional." error={itemError(i, "role")} />
      <ImageField kind="portrait" label="Foto" description="Agrega un retrato autorizado. Es opcional." value={item.photo} onChange={photo => update({ photo })} previewUrl={mediaUrl} error={itemError(i, "photo")} />
      <ConsentField value={item.consent} onChange={consent => update({ consent })} error={itemError(i, "consent")} />
    </>);
    case "offices": return list(block.content.items, () => ({ name: null, location: null, address: null, map_url: null }), 1, 20, item => item.name, (item, i, update) => <>
      <TextField label="Nombre de la oficina" value={item.name} onChange={name => update({ name })} max={80} description="Identifica esta sede. Es necesario para publicar." error={itemError(i, "name")} />
      <LocationField label="Ubicación" depth="municipality" postalCode defaultCountry={null} value={{ country: item.location?.country ?? null, state: item.location?.state ?? null, municipality: item.location?.municipality ?? null, postal_code: item.location?.postal_code ?? null }} onChange={value => update({ location: locationValueToWrite(value) })} required={["country"]} description="Elige el país para publicar esta oficina. En México puedes detallar estado y municipio." errors={(["country", "state", "municipality", "postal_code"] as const).flatMap(field => { const message = itemError(i, `location.${field}`) ?? (field === "country" ? itemError(i, "location") : undefined); return message ? [{ field, reason: "unknown" as const, message }] : []; })} />
      <TextField label="Dirección" value={item.address} onChange={address => update({ address })} max={200} description="Agrega calle y referencias. Es opcional." error={itemError(i, "address")} multiline />
      <TextField label="Enlace del mapa" value={item.map_url} onChange={map_url => update({ map_url })} max={500} description="Usa un enlace que empiece con https://. Es opcional." error={itemError(i, "map_url") ?? (item.map_url && !/^https:\/\/[^\s]+$/.test(item.map_url) ? "Usa un enlace que empiece con https://." : undefined)} url />
    </>);
    case "faq": return list(block.content.items, () => ({ question: null, answer: null }), 1, 20, item => item.question, (item, i, update) => <>
      <TextField label="Pregunta" value={item.question} onChange={question => update({ question })} max={160} description="Escribe una duda frecuente. Es necesaria para publicar." error={itemError(i, "question")} />
      <TextField label="Respuesta" value={item.answer} onChange={answer => update({ answer })} max={1000} description="Da una respuesta clara y útil. Es necesaria para publicar." error={itemError(i, "answer")} multiline />
    </>);
    default: return null;
  }
}
