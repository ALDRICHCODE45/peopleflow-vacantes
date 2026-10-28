import { Building2 } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { CompanySiteStateFrame } from "./state-frame";

export default function NotFound() {
  return (
    <CompanySiteStateFrame>
      <StateCard
        icon={Building2}
        tone="empty"
        headingLevel={1}
        title="Este sitio no está disponible"
        description="La empresa todavía no publicó su sitio o ya no está disponible."
        primaryAction={{ label: "Explorar vacantes", href: "/vacantes" }}
      />
    </CompanySiteStateFrame>
  );
}
