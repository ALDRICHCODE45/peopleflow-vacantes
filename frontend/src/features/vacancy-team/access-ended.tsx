import { LogOut } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
export function TeamAccessEnded() {
  return <StateCard icon={LogOut} tone="info" title="Ya no formas parte del equipo de esta vacante" description="Tu trabajo en esta vacante sigue a tu nombre. Si necesitas volver, pídeselo al responsable o al dueño de la empresa." primaryAction={{ label: "Volver a vacantes", href: "/empresa/vacantes" }} />;
}
