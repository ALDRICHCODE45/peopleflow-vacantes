import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export default function VacanteDetailNotFound() {
  return <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon"><SearchXIcon aria-hidden="true" /></EmptyMedia>
      <EmptyTitle><h1>Esta vacante no está disponible</h1></EmptyTitle>
      <EmptyDescription>La vacante que buscas no existe o ya no está publicada. Explora otras vacantes disponibles.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent><Link href="/vacantes" className={cn(buttonVariants(), "min-h-10")}>Explorar vacantes</Link></EmptyContent>
  </Empty>;
}
