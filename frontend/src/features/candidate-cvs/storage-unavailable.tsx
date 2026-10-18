"use client";
import { ActionBar } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { storageUnavailableCopy } from "./feedback";

export function CvStorageUnavailable({ retry, pending = false, status, statusId }: {
  retry: () => void; pending?: boolean; status?: React.ReactNode; statusId?: string;
}) {
  return <Empty className="bg-card px-4 py-8 sm:p-12">
    <EmptyHeader className="max-w-md"><EmptyTitle className="text-xl font-semibold"><h3>{storageUnavailableCopy.title}</h3></EmptyTitle><EmptyDescription>{storageUnavailableCopy.description}</EmptyDescription></EmptyHeader>
    <EmptyContent className="max-w-md [&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink [&_[data-pf-action-bar-actions]]:max-sm:flex-1"><ActionBar status={status}><Button type="button" className="min-h-10 w-full sm:w-auto" disabled={pending} aria-describedby={statusId} onClick={retry}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Reintentar</Button></ActionBar></EmptyContent>
  </Empty>;
}
