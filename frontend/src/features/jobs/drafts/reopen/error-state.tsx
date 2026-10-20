import { CircleAlert } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import type { DraftEditFailureReason } from "./load";

const back = {href:"/empresa/vacantes",label:"Volver a Vacantes"};
const missing = {
  title:"No encontramos este borrador",
  description:"Puede que ya no exista o que no esté disponible para tu cuenta. Revisa los borradores a los que tienes acceso.",
  action:back,
};
const company = {
  title:"Falta configurar tu empresa",
  description:"Tu empresa debe estar activa para abrir este borrador. Revisa su configuración; no se modificó el borrador.",
  action:{href:"/empresa/configuracion",label:"Revisar empresa"},
};
const messages = {
  invalid_id:missing,
  not_found:missing,
  unauthenticated:{title:"Tu sesión expiró",description:"Inicia sesión para abrir el borrador guardado en tu cuenta. No se modificó su contenido.",action:{href:"/empresa/login",label:"Iniciar sesión"}},
  forbidden:{title:"No tienes permiso para abrirlo",description:"Abre este borrador con la cuenta del reclutador responsable o de la persona propietaria de la empresa.",action:back},
  company_inactive:company,
  company_not_active:company,
  server_error:{title:"El servidor tuvo un problema",description:"No pudimos cargar el borrador. No se modificó su contenido. Vuelve al listado y ábrelo de nuevo; es seguro intentarlo.",action:back},
  no_response:{title:"No hubo respuesta del servidor",description:"No pudimos cargar el borrador. Revisa tu conexión y ábrelo de nuevo desde el listado; es seguro intentarlo y no se modificó su contenido.",action:back},
  unrecognized_response:{title:"No pudimos confirmar el resultado",description:"No pudimos leer el borrador guardado. No se modificó su contenido. Vuelve al listado y ábrelo de nuevo; es seguro intentarlo.",action:back},
} satisfies Record<DraftEditFailureReason,{title:string;description:string;action:{href:string;label:string}}>;

/** Page-load failures are Empty states, not action toasts or raw backend errors. */
export function DraftEditErrorState({reason,onRetry}:{reason:DraftEditFailureReason;onRetry?:()=>void}) {
  const {title,description,action} = messages[reason];
  const isBack = action.href === back.href;
  const retryFirst = onRetry && isBack && reason !== "forbidden";
  return <StateCard icon={CircleAlert}
    tone={reason === "forbidden" ? "forbidden" : reason === "not_found" || reason === "invalid_id" ? "empty" : "error"}
    title={title} description={description}
    primaryAction={retryFirst ? { label: "Reintentar", onClick: onRetry } : action}
    secondaryAction={retryFirst ? back : onRetry ? { label: "Reintentar", onClick: onRetry } : !isBack ? back : undefined} />;
}
