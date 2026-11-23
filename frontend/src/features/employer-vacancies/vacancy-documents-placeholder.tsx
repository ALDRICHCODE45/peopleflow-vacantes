import { FileText } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Placeholder of the Documentos tab (S9): the tab and its route exist now; the documents table (artboard 03) replaces this later. */
export function VacancyDocumentsPlaceholder() {
  return <section aria-labelledby="vacancy-documents-heading" className="flex min-h-0 flex-1 flex-col gap-4">
    <h2 id="vacancy-documents-heading" className="font-heading text-xl font-semibold text-foreground">Documentos</h2>
    <Empty className="border py-10">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon"><FileText aria-hidden="true" /></EmptyMedia>
        <EmptyTitle role="heading" aria-level={3} className="text-xl font-semibold">Próximamente</EmptyTitle>
        <EmptyDescription>Aquí podrás consultar y administrar los documentos de esta vacante.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  </section>;
}
