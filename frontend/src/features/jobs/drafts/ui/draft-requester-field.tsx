"use client";

import { PublicationRequired } from "./publication-required";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Field, FieldDescription, FieldError, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, ComboboxInput, ComboboxList, ComboboxItem, ComboboxEmpty, ComboboxContent } from "@/components/ui/combobox";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { searchRequestersAction, createRequesterAction, type RequesterActionFailure } from "../requesters/actions";
import type { Requester } from "../requesters/client";
import type { DraftRequesterKind, DraftRequesterState } from "./draft-form-state";
import { REQUESTER_CREATE_WARNING } from "./draft-messages";
import { REQUESTER_KIND_OPTIONS } from "./draft-labels";

export type DraftRequesterFieldProps = {
  requester: DraftRequesterState;
  error?: string;
  publicationRequired?: boolean;
  onChangeKind: (kind: DraftRequesterKind) => void;
  onSelect: (entry: Requester | null) => void;
};

const titles = {
  unauthenticated: "Tu sesión expiró",
  forbidden: "No tienes permiso para esta acción",
  company_inactive: "Falta configurar tu empresa",
  company_not_active: "Falta configurar tu empresa",
  server_error: "El servidor tuvo un problema",
  no_response: "No hubo respuesta del servidor",
  unrecognized_response: "No pudimos confirmar el resultado",
  invalid_name: "Revisa el nombre",
  already_exists: "Este solicitante ya existe",
};
const disconnected = (): RequesterActionFailure =>
  ({ ok: false, reason: "no_response", reference: {} });

type Status = {
  tone: "success" | "error";
  text: string;
  reason?: RequesterActionFailure["reason"];
};

/** The catalog is independent of the draft. Only explicit selection changes draft state. */
export function DraftRequesterField({ requester, error, publicationRequired = false, onChangeKind, onSelect }: DraftRequesterFieldProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(false);
  const [items, setItems] = useState<Requester[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [existing, setExisting] = useState<Requester | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [status, setStatus] = useState<Status | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const kind = requester.kind;

  function report(result: RequesterActionFailure, mutation: boolean) {
    const title = titles[result.reason];
    let description = mutation
      ? "Tu selección anterior se conserva. Busca el nombre en el catálogo antes de volver a crear: la entrada podría haberse agregado."
      : "Tu selección se conserva. Intenta buscar de nuevo.";
    if (result.reason === "unauthenticated") {
      description = "Tu selección se conserva. Inicia sesión en otra pestaña y vuelve a intentarlo.";
    } else if (result.reason === "forbidden") {
      description = "Tu selección se conserva. Esta acción requiere una cuenta de reclutamiento de la empresa.";
    } else if (result.reason === "company_inactive" || result.reason === "company_not_active") {
      description = "Tu selección se conserva. Revisa el estado de tu empresa en Configuración.";
    }
    setStatus({ tone: "error", text: `${title}. ${description}`, reason: result.reason });
    notifyActionResult({
      key: "requester", type: "error", title, description,
      reference: { ...result.reference, at: new Date().toISOString() },
    });
  }

  useEffect(() => {
    // Never request or toast on mount: a search starts only after interaction.
    if (!active) return;
    const current = ++generation.current;
    setItems([]);
    setCursor(null);
    setLoading(false);
    const timer = setTimeout(async () => {
      setLoading(true);
      const result = await searchRequestersAction({ kind, q: query }).catch(disconnected);
      if (generation.current !== current) return;
      setLoading(false);
      if (result.ok) {
        setItems(result.items);
        setCursor(result.nextCursor);
      } else {
        report(result, false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      generation.current = current + 1;
    };
  }, [kind, query, active]);

  async function more() {
    if (!cursor || loading) return;
    const current = generation.current;
    setLoading(true);
    const result = await searchRequestersAction({ kind, q: query, cursor }).catch(disconnected);
    if (current !== generation.current) return;
    setLoading(false);
    if (result.ok) {
      setItems(previous => [...new Map([...previous, ...result.items].map(item => [item.id, item])).values()]);
      setCursor(result.nextCursor);
    } else {
      report(result, false);
    }
  }

  async function create() {
    if (confirm === null || busy.current) return;
    busy.current = true;
    setCreating(true);
    setFieldError(undefined);
    setStatus(null);
    const current = generation.current;
    const result = await createRequesterAction({ kind, name: confirm }).catch(disconnected);
    busy.current = false;
    setCreating(false);
    if (current !== generation.current) return;
    if (result.ok) {
      onSelect(result.requester);
      setConfirm(null);
      setQuery("");
      setStatus({ tone: "success", text: "Solicitante creado y seleccionado" });
      notifyActionResult({
        key: "requester", type: "success", title: "Solicitante creado",
        description: "Se agregó al catálogo y se seleccionó para este borrador.",
      });
    } else if (result.reason === "invalid_name") {
      setFieldError(result.message);
    } else if (result.reason === "already_exists" && result.existing) {
      setExisting(result.existing);
      setConfirm(null);
    } else {
      report(result, true);
    }
  }

  const text = query.trim();
  const canCreate = text !== "" && !loading && !items.some(item =>
    item.name.toLocaleLowerCase("es") === text.toLocaleLowerCase("es"),
  );
  const nameError = fieldError ?? error;
  const companyIssue = status?.reason === "company_inactive" || status?.reason === "company_not_active";
  const action = status?.reason === "unauthenticated"
    ? <Link className={cn(buttonVariants({ variant: "outline" }), "min-h-10")} href="/empresa/login" target="_blank" rel="noopener noreferrer">Iniciar sesión</Link>
    : companyIssue
      ? <Link className={cn(buttonVariants({ variant: "outline" }), "min-h-10")} href="/empresa/configuracion" target="_blank" rel="noopener noreferrer">Revisar empresa</Link>
      : undefined;

  return (
    <FieldGroup className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
      <Field>
        <FieldTitle id="draft-requester-kind-label">Tipo de solicitante</FieldTitle>
        <Select
          value={kind} items={REQUESTER_KIND_OPTIONS} disabled={creating}
          onValueChange={value => {
            if (!value || value === kind) return;
            setQuery("");
            setConfirm(null);
            setExisting(null);
            setFieldError(undefined);
            setStatus(null);
            onChangeKind(value as DraftRequesterKind);
          }}
        >
          <SelectTrigger aria-labelledby="draft-requester-kind-label" className="h-10 w-full">
            <SelectValue placeholder="Elige un tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {REQUESTER_KIND_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field data-invalid={nameError !== undefined}>
        <FieldTitle id="draft-requester-name-label">Área o cliente <PublicationRequired required={publicationRequired} /></FieldTitle>
        <Combobox
          key={kind} value={requester.id} inputValue={query} filter={null}
          onInputValueChange={(value, details) => {
            if (details.reason !== "input-change") return;
            setActive(true);
            setQuery(value);
            setConfirm(null);
            setExisting(null);
            setFieldError(undefined);
          }}
          onValueChange={value => {
            if (value === "__create") { setConfirm(text); return; }
            const item = items.find(item => item.id === value);
            if (item) { onSelect(item); setQuery(""); }
          }}
        >
          <ComboboxInput
            onFocus={() => setActive(true)}
            aria-labelledby="draft-requester-name-label" aria-invalid={nameError !== undefined}
            aria-describedby="draft-requester-error draft-requester-status"
            placeholder={requester.name ?? "Busca un área o cliente"} disabled={creating}
            className="min-h-10 [&_input]:min-h-10"
          />
          <ComboboxContent>
            <ComboboxEmpty>{loading ? "Buscando…" : "Sin resultados"}</ComboboxEmpty>
            <ComboboxList>
              {items.map(item => <ComboboxItem className="min-h-10" key={item.id} value={item.id}>{item.name}</ComboboxItem>)}
              {canCreate && <ComboboxItem className="min-h-10" value="__create">{`Crear "${text}"`}</ComboboxItem>}
            </ComboboxList>
            {loading && <Spinner aria-label="Buscando solicitantes" />}
            {cursor && <Button type="button" variant="outline" className="min-h-10" disabled={loading} onClick={more}>Cargar más</Button>}
          </ComboboxContent>
        </Combobox>
        {requester.name && <FieldDescription>Seleccionado: {requester.name}</FieldDescription>}
        <FieldError id="draft-requester-error">{nameError}</FieldError>
        {requester.id && <Button type="button" variant="ghost" className="min-h-10" onClick={() => { onSelect(null); setQuery(""); }} disabled={creating}>Quitar selección</Button>}
        {confirm !== null && (
          <FieldGroup>
            <FieldDescription>{REQUESTER_CREATE_WARNING}</FieldDescription>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="min-h-10" disabled={creating} aria-describedby="draft-requester-status" onClick={create}>
                {creating && <Spinner aria-hidden="true" />}Crear y seleccionar
              </Button>
              <Button type="button" variant="outline" className="min-h-10" disabled={creating} onClick={() => setConfirm(null)}>Cancelar</Button>
            </div>
          </FieldGroup>
        )}
        {existing && (
          <FieldGroup>
            <FieldDescription>Ya existe: {existing.name}. No se cambió tu selección.</FieldDescription>
            <Button type="button" variant="outline" className="min-h-10" onClick={() => { onSelect(existing); setExisting(null); setQuery(""); }}>Seleccionar existente</Button>
          </FieldGroup>
        )}
        {status && <ActionStatus id="draft-requester-status" tone={status.tone} text={status.text} action={action} />}
      </Field>
      {requester.notice && <p role="status" data-pf-requester-notice="" className="text-sm text-muted-foreground sm:col-span-2">{requester.notice}</p>}
    </FieldGroup>
  );
}
