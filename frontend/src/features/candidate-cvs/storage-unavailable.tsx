"use client";
import { CircleAlert } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { Spinner } from "@/components/ui/spinner";
import { storageUnavailableCopy } from "./feedback";

export function CvStorageUnavailable({ retry, pending = false, status, statusId }: {
  retry: () => void; pending?: boolean; status?: React.ReactNode; statusId?: string;
}) {
  return <StateCard icon={CircleAlert} tone="error" title={storageUnavailableCopy.title} description={storageUnavailableCopy.description}
    primaryAction={{ label: <>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Reintentar</>, onClick: retry, disabled: pending, "aria-describedby": statusId }}>
    {status}
  </StateCard>;
}
