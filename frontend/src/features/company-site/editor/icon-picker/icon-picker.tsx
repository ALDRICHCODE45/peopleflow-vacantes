"use client";

import { useId, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { emojiError } from "../../model";
import { SITE_ICONS } from "../../public/site-icons";
import { EMOJI_GROUPS, ICON_GROUPS, ICON_LABELS, searchText, type IconName } from "./catalog";

export type Decoration = { icon: IconName | null; emoji: string | null };
type Choice = { key: string; label: string; glyph: ReactNode; selected: boolean; choose: () => void };
function ChoiceGroup({ label, choices }: { label: string; choices: Choice[] }) {
  const [active, setActive] = useState<string | null>(null);
  const id = useId();
  const tabStop = choices.find(choice => choice.key === active)?.key ?? choices.find(choice => choice.selected)?.key ?? choices[0]?.key;
  if (!choices.length) return null;
  return <section className="flex flex-col gap-2" aria-labelledby={id}>
    <h3 id={id} className="text-sm font-medium">{label}</h3>
    <div role="listbox" aria-labelledby={id} className="grid grid-cols-6 gap-1" onKeyDown={event => {
      const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      const index = options.indexOf(event.target as HTMLButtonElement);
      const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[event.key];
      if (index < 0 || (delta === undefined && event.key !== "Home" && event.key !== "End")) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + delta!));
      options[next]?.focus();
    }}>
      {choices.map(choice => <Tooltip key={choice.key}><TooltipTrigger render={<Button type="button" variant="ghost" role="option" aria-label={choice.label} aria-selected={choice.selected} tabIndex={choice.key === tabStop ? 0 : -1} onFocus={() => setActive(choice.key)} onClick={choice.choose} className="aspect-square h-auto min-h-10 w-full justify-center p-0 aria-selected:ring-2 aria-selected:ring-inset aria-selected:ring-primary data-[highlighted]:bg-accent" />}>{choice.glyph}</TooltipTrigger><TooltipContent>{choice.label}</TooltipContent></Tooltip>)}
    </div>
  </section>;
}
export function IconPicker({ value, onChange, error }: { value: Decoration; onChange: (value: Decoration) => void; error?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string>(value.emoji ? "emojis" : "icons");
  const [iconsQuery, setIconsQuery] = useState("");
  const [emojisQuery, setEmojisQuery] = useState("");
  const [paste, setPaste] = useState("");
  const Current = value.icon ? SITE_ICONS[value.icon] : null;
  const emojiLabel = EMOJI_GROUPS.flatMap(group => group.items).find(item => item.emoji === value.emoji)?.label ?? "Emoji personalizado";
  const label = value.emoji ? emojiLabel : value.icon ? ICON_LABELS[value.icon] : "Elige un símbolo";
  const pasteError = paste ? emojiError(paste) : null;
  const pasteMessage = pasteError === "too_long" ? "El emoji que tú elijas debe ocupar hasta 32 bytes." : pasteError ? "Pega un solo emoji; tú puedes incluir su tono de piel." : undefined;
  const choose = (next: Decoration) => { onChange(next); setOpen(false); };
  const iconGroups = ICON_GROUPS.map(group => ({ ...group, icons: group.icons.filter(icon => searchText(`${ICON_LABELS[icon]} ${group.label}`).includes(searchText(iconsQuery))) }));
  const emojiGroups = EMOJI_GROUPS.map(group => ({ ...group, items: group.items.filter(item => searchText(item.keywords).includes(searchText(emojisQuery))) }));
  return <Field data-invalid={!!error}>
    <FieldLabel htmlFor={id}>Ícono o emoji</FieldLabel>
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setTab(value.emoji ? "emojis" : "icons"); setPaste(""); setIconsQuery(""); setEmojisQuery(""); } }}>
      <PopoverTrigger id={id} render={<Button type="button" variant="outline" className="min-h-10 w-full justify-start" />} aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}>
        {value.emoji ? <span aria-hidden="true" className="inline-flex size-4 items-center justify-center text-base leading-none">{value.emoji}</span> : Current && <Current aria-hidden="true" data-icon="inline-start" />}<span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[min(36rem,80dvh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain motion-reduce:animate-none motion-reduce:transition-none">
        <PopoverHeader><PopoverTitle>Ícono o emoji</PopoverTitle></PopoverHeader>
        <TooltipProvider><Tabs value={tab} onValueChange={next => setTab(String(next))} className="flex-col">
          <TabsList className="w-full"><TabsTrigger value="icons">Íconos</TabsTrigger><TabsTrigger value="emojis">Emojis</TabsTrigger></TabsList>
          <TabsContent value="icons" className="flex flex-col gap-4">
            <Field><FieldLabel htmlFor={`${id}-icons`}>Buscar íconos</FieldLabel><InputGroup><InputGroupInput id={`${id}-icons`} value={iconsQuery} onChange={event => setIconsQuery(event.target.value)} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup></Field>
            {iconGroups.every(group => !group.icons.length) && <p role="status">No encontramos íconos. Prueba con otra palabra.</p>}
            {iconGroups.map(group => <ChoiceGroup key={group.label} label={group.label} choices={group.icons.map(icon => {
              const Icon = SITE_ICONS[icon];
              return { key: icon, label: ICON_LABELS[icon], glyph: <Icon aria-hidden="true" />, selected: value.icon === icon, choose: () => choose({ icon, emoji: null }) };
            })} />)}
          </TabsContent>
          <TabsContent value="emojis" className="flex flex-col gap-4">
            <FieldGroup>
              <Field><FieldLabel htmlFor={`${id}-emojis`}>Buscar emojis</FieldLabel><InputGroup><InputGroupInput id={`${id}-emojis`} value={emojisQuery} onChange={event => setEmojisQuery(event.target.value)} /><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon></InputGroup></Field>
              <Field data-invalid={!!pasteError}><FieldLabel htmlFor={`${id}-paste`}>Pega tu emoji</FieldLabel><InputGroup><InputGroupInput id={`${id}-paste`} value={paste} onChange={event => setPaste(event.target.value)} aria-invalid={!!pasteError} aria-describedby={pasteMessage ? `${id}-paste-error` : undefined} /></InputGroup>{pasteMessage && <FieldError id={`${id}-paste-error`}>{pasteMessage}</FieldError>}<Button type="button" variant="outline" disabled={!paste || !!pasteError} onClick={() => choose({ icon: null, emoji: paste })}>Usar emoji</Button></Field>
            </FieldGroup>
            {emojiGroups.every(group => !group.items.length) && <p role="status">No encontramos emojis. Pega el que tú prefieras.</p>}
            {emojiGroups.map(group => <ChoiceGroup key={group.label} label={group.label} choices={group.items.map(item => ({ key: item.emoji, label: item.label, glyph: <span aria-hidden="true" className="text-xl leading-none">{item.emoji}</span>, selected: value.emoji === item.emoji, choose: () => choose({ icon: null, emoji: item.emoji }) }))} />)}
          </TabsContent>
        </Tabs></TooltipProvider>
      </PopoverContent>
    </Popover>
    <FieldDescription id={`${id}-help`}>Elige un ícono o un emoji para representar esta idea.</FieldDescription>
    {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
  </Field>;
}
