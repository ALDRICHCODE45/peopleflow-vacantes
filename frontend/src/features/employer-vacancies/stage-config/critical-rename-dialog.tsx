import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CriticalRename } from "@/features/jobs/drafts/pipeline/editor-model";

const explanations = {
  in_process: "Sigue siendo la etapa donde se registran los subestados del proceso.",
  placement: "Sigue siendo la etapa de contratación: mover a un candidato aquí cuenta como contratación.",
  discarded: "Sigue siendo la salida para descartar candidatos desde cualquier etapa.",
};
export function CriticalRenameDialog({ open, onOpenChange, renames, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; renames: CriticalRename[]; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar cambio de nombre</DialogTitle>
          <DialogDescription>El nombre cambia, pero la función de estas columnas se mantiene.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {renames.map(rename => <li key={rename.key} className="flex flex-col gap-1">
            <p className="break-words font-medium">{rename.previousName} → {rename.nextName}</p>
            <p className="text-sm text-muted-foreground">{explanations[rename.kind]}</p>
          </li>)}
        </ul>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="min-h-10" />}>Revisar</DialogClose>
          <Button type="button" className="min-h-10" onClick={onConfirm}>Guardar cambios</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
