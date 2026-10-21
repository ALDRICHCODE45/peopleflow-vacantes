"use client";

import * as React from "react";
import { signOut } from "next-auth/react";
import { IconFileCv, IconSettings, IconUserCircle } from "@tabler/icons-react";
import { NavUser } from "@/components/company-dashboard/nav-user";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { useIdentity } from "@/features/identity/identity-session";

export const candidateAccountMenu = [
  { title: "Mi perfil", href: "/candidato/perfil", icon: <IconUserCircle /> },
  { title: "Mis CVs", href: "/candidato/cvs", icon: <IconFileCv /> },
  { title: "Configuración", href: "/candidato/configuracion", icon: <IconSettings /> },
] as const;

export function CandidateNavUser() {
  const { result } = useIdentity();
  const user = result?.ok ? result.data.user : null;
  const role = result?.ok && result.data.role === "recruiter" ? "Empresa" : "Candidato";
  const [pending, setPending] = React.useState(false);
  const lock = React.useRef(false);
  const [failed, setFailed] = React.useState(false);
  const statusId = React.useId();
  async function logout() {
    if (lock.current) return;
    lock.current = true; setPending(true); setFailed(false);
    try { await signOut({ callbackUrl: "/api/auth/cognito/logout?to=candidato" }); }
    catch {
      setFailed(true);
      notifyActionResult({ key: "candidate-logout", type: "error", title: "No pudimos cerrar la sesión", description: "Tu sesión puede seguir activa. Vuelve a intentarlo desde el menú.", reference: { at: new Date().toISOString() } });
    } finally { lock.current = false; setPending(false); }
  }
  return <>
    <NavUser user={{ name: user?.full_name ?? "Mi cuenta", email: user?.email ?? "", role, company: role === "Empresa" ? "Empresa" : "Espacio personal" }} secondaryText={user?.email ?? ""} menuItems={candidateAccountMenu} onLogout={() => void logout()} logoutPending={pending} logoutStatusId={failed ? statusId : undefined} />
    <ActionStatusSlot>{failed && <ActionStatus id={statusId} tone="error" text="No se cerró la sesión. Intenta nuevamente desde el menú." />}</ActionStatusSlot>
  </>;
}
