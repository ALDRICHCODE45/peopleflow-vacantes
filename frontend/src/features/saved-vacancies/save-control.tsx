"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { BookmarkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import { useIdentity } from "@/features/identity/identity-session";
import type { Identity } from "@/features/identity/model";
import { candidateAuthHref } from "@/features/identity/return-to";
import { cn } from "@/lib/utils";
import { loadSavedJobIdsAction, removeSavedJobAction, saveJobAction } from "./actions";
import { savedJobErrorCopy } from "./feedback";
import { savedJobIdsKey, savedJobsQueryClient, updateSavedJobIds } from "./queries";
import { jobIdSchema, type SavedJobsFailure } from "./model";
import { VisitorSavePrompt } from "./visitor/save-prompt";

type Props = { jobId: string; title: string; placement?: "card" | "detail"; children?: ReactNode;
  /** Optional host override for the visitor prompt. */
  onVisitorSaveT3?: (jobId: string, returnTo: string) => void };
function size(placement: Props["placement"]) { return placement === "detail" ? "size-12" : "size-10"; }

/** Only this island resolves identity. Its children remain server-rendered public content. */
export function SavedJobControl(props: Props) {
  const identity = useIdentity();
  return <><ReturnIntent /> <ResolvedControl {...props} identityState={identity} /></>;
}

// Shared across islands and StrictMode effect replays, not across page reloads.
// Reloads retain the URL intent and may safely replay the idempotent PUT.
const returnSavesInFlight = new Set<string>();

function ReturnIntent() {
  const identity = useIdentity();
  const router = useRouter();
  const params = useSearchParams();
  const [claimed, setClaimed] = useState<{ jobId: string; identity: Identity; settled: () => void }>();
  useEffect(() => {
    if (identity.status === "loading") return;
    // Read live location, not a stale render snapshot.
    const search = new URLSearchParams(window.location.search);
    if (!search.has("guardar")) return;
    const values = search.getAll("guardar");
    const pathname = window.location.pathname;
    function clearIntent() {
      // Do not erase a newer navigation or a different save intent.
      const current = new URLSearchParams(window.location.search);
      if (window.location.pathname !== pathname || current.getAll("guardar").join("\0") !== values.join("\0")) return;
      current.delete("guardar");
      const clean = `${pathname}${current.size ? `?${current}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", clean);
      router.replace(clean, { scroll: false });
    }
    if (identity.status === "ready" && identity.result?.ok && identity.result.data.role === "candidate"
      && values.length === 1 && jobIdSchema.safeParse(values[0]).success) {
      const jobId = values[0];
      if (returnSavesInFlight.has(jobId)) return;
      returnSavesInFlight.add(jobId);
      setClaimed({ jobId, identity: identity.result.data, settled: () => {
        clearIntent();
        returnSavesInFlight.delete(jobId);
      } });
    } else clearIntent();
  }, [identity, params, router]);
  return claimed && identity.status === "ready" && identity.result?.ok && identity.result.data === claimed.identity
    ? <CandidateControl jobId={claimed.jobId} title="vacante" identity={claimed.identity} returnIntent={claimed.settled} /> : null;
}

function ResolvedControl(props: Props & { identityState: ReturnType<typeof useIdentity> }) {
  const identity = props.identityState;
  if (identity.status === "loading") return <Layout {...props} control={<span aria-hidden="true" className={cn("block shrink-0", size(props.placement))} />} />;
  if (identity.result?.ok && identity.result.data.role === "recruiter") return props.children ?? null;
  if (identity.status === "ready" && identity.result?.ok && identity.result.data.role === "candidate")
    return <CandidateControl key={identity.result.data.user.id} {...props} identity={identity.result.data} />;
  return <VisitorControl {...props} />;
}

function Layout({ placement, children, control, status }: Props & { control: ReactNode; status?: ReactNode }) {
  // Direction 03 explicitly joins the detail actions and places the status below
  // this split pair. The listing uses the standard compact ActionBar (§12).
  if (placement === "detail") return <div className="flex min-w-0 flex-col">
    <div className="flex min-w-0 items-start [&>div>a]:rounded-r-none [&>button]:rounded-l-none">
      {children && <div className="min-w-0 flex-1">{children}</div>}{control}
    </div>
    <ActionStatusSlot>{status}</ActionStatusSlot>
  </div>;
  return <ActionBar status={status}>{children}{control}</ActionBar>;
}

function VisitorControl(props: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const returnTo = `${pathname ?? `/vacantes/${props.jobId}`}${params?.toString() ? `?${params}` : ""}`;
  const trigger = <Button type="button" variant={props.placement === "detail" ? "outline" : "ghost"} size="icon" className={size(props.placement)}
    aria-pressed={false} aria-label={`Guardar ${props.title}`}>
    <BookmarkIcon aria-hidden="true" />
  </Button>;
  return <Layout {...props} control={props.onVisitorSaveT3
    ? <Button type="button" variant={props.placement === "detail" ? "outline" : "ghost"} size="icon" className={size(props.placement)}
      aria-pressed={false} aria-label={`Guardar ${props.title}`} onClick={() => props.onVisitorSaveT3!(props.jobId, returnTo)}><BookmarkIcon aria-hidden="true" /></Button>
    : <VisitorSavePrompt jobId={props.jobId} returnTo={returnTo} trigger={trigger} />} />;
}

type ResultLine = { tone: "success" | "error"; text: string; action?: { title: string; onClick: () => void } | "saved" };
function CandidateControl(props: Props & { identity: Identity; returnIntent?: () => void }) {
  const { jobId, title, identity } = props;
  const router = useRouter();
  const statusId = useId();
  const client = savedJobsQueryClient(identity);
  const key = `saved-job:${jobId}`;
  const mutationKey = ["saved-jobs", "toggle", jobId];
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [line, setLine] = useState<ResultLine>();
  const ids = useQuery({ queryKey: savedJobIdsKey, queryFn: async () => {
    const result = await loadSavedJobIdsAction();
    if (!result.ok) throw result;
    return result.data;
  } }, client);
  const saved = ids.data?.job_ids.includes(jobId) ?? false;
  const pending = useMutationState({ filters: { mutationKey, status: "pending" }, select: mutation => mutation.state.status }, client).length > 0;
  const mutation = useMutation({ mutationKey, mutationFn: async (remove: boolean) => {
    dismissActionResult(key); setLine(undefined);
    const result = await (remove ? removeSavedJobAction(jobId) : saveJobAction(jobId)).catch((): SavedJobsFailure => ({ ok: false, reason: "no_response", reference: {} }));
    props.returnIntent?.();
    if (!active.current) return;
    if (result.ok) {
      updateSavedJobIds(client, jobId, !remove);
      const title = remove ? "Quitaste la vacante" : "Vacante guardada";
      const description = remove ? "Ya no aparece en tus vacantes guardadas." : "La encontrarás en Vacantes guardadas.";
      const action = remove ? { title: "Deshacer", onClick: () => run(false) } : { title: "Ver guardadas", onClick: () => router.push("/candidato/guardadas") };
      setLine({ tone: "success", text: title, action: remove ? action : "saved" });
      notifyActionResult({ key, type: "success", title, description, action });
    } else {
      const copy = savedJobErrorCopy(result, remove);
      const action = result.reason === "unauthenticated" ? { title: "Iniciar sesión", onClick: () => router.push(candidateAuthHref("login", `${window.location.pathname}${window.location.search}`)) }
        : copy.retry ? { title: "Reintentar", onClick: () => run(remove) } : undefined;
      setLine({ tone: "error", text: copy.title, action });
      notifyActionResult({ key, type: "error", title: copy.title, description: copy.description, action, reference: { ...result.reference, at: new Date().toISOString() } });
    }
  } }, client);
  function run(remove: boolean) {
    // One lock across every appearance of this vacancy; never queue double clicks.
    if (!active.current || client.isMutating({ mutationKey }) > 0) return;
    mutation.mutate(remove);
  }
  const started = useRef(false);
  useEffect(() => {
    if (!props.returnIntent || started.current) return;
    started.current = true;
    run(false);
  });
  const readError = ids.isError && !ids.data;
  const status = line ? <ActionStatus id={statusId} tone={line.tone} text={line.text} action={line.action === "saved"
    ? <Link href="/candidato/guardadas" className="inline-flex min-h-10 items-center underline underline-offset-4">Ver guardadas</Link>
    : line.action && <Button type="button" variant="link" className="min-h-10" disabled={pending} onClick={line.action.onClick}>{line.action.title}</Button>} />
    : readError ? <ActionStatus id={statusId} tone="error" text="No pudimos cargar tus guardadas" action={<Button type="button" variant="link" className="min-h-10" disabled={ids.isFetching} onClick={() => void ids.refetch()}>Reintentar</Button>} /> : null;
  if (props.returnIntent) return <ActionStatusSlot>{pending
    ? <span className="inline-flex items-center gap-2" role="status"><Spinner aria-hidden="true" />Guardando vacante…</span> : status}</ActionStatusSlot>;
  return <Layout {...props} status={status} control={<Button type="button" variant={props.placement === "detail" ? "outline" : "ghost"} size="icon"
    className={cn(size(props.placement), saved && "text-primary")} aria-label={saved ? `Quitar ${title} de guardadas` : `Guardar ${title}`}
    aria-pressed={saved} aria-busy={pending} aria-describedby={status ? statusId : undefined}
    disabled={pending || !ids.data} onClick={() => run(saved)}>
    {pending ? <Spinner aria-hidden="true" /> : <BookmarkIcon aria-hidden="true" className={saved ? "fill-current" : undefined} />}
  </Button>} />;
}
