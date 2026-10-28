"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { notifyActionResult } from "@/components/feedback/notify";
import { clearChecklistMarkAction, loadChecklistAction, loadChecklistMarksAction, setChecklistMarkAction } from "../actions";
import type { Checklist, Mark, MarkBody } from "../model";

function useChecklist(vacancyId: string, readOnly: boolean) {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const marksRef = useRef(marks);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reading, setReading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [pending, setPending] = useState(new Set<string>());
  const locks = useRef(new Set<string>());
  const live = useRef(true);
  const [selection, setSelection] = useState<string[]>([]);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setReading(true);
    async function load() {
      try {
        const [list, allMarks] = await Promise.all([loadChecklistAction(vacancyId), loadChecklistMarksAction(vacancyId)]);
        if (!current) return;
        if (!list.ok || !allMarks.ok) { setFailed(true); return; }
        setChecklist(list.data); setMarks(allMarks.data.items); marksRef.current = allMarks.data.items; setFailed(false);
      } catch { if (current) setFailed(true); }
      finally { if (current) setReading(false); }
    }
    void load(); return () => { current = false; };
  }, [vacancyId, attempt]);
  async function update(participationId: string, criterionId: string, body: MarkBody | null) {
    const key = `${participationId}:${criterionId}`;
    if (readOnly || finished || locks.current.has(key)) return;
    locks.current.add(key); setPending(new Set(locks.current)); setNotice(null);
    const matches = (mark: Mark) => mark.participation_id === participationId && mark.criterion_id === criterionId;
    const previous = marksRef.current.find(matches);
    const replace = (mark?: Mark) => {
      marksRef.current = [...marksRef.current.filter(value => !matches(value)), ...(mark ? [mark] : [])];
      setMarks(marksRef.current);
    };
    replace(body ? { participation_id: participationId, criterion_id: criterionId, ...body, marked_by: previous?.marked_by ?? { id: "", full_name: "Tú (guardando…)" }, marked_at: new Date().toISOString() } : undefined);
    try {
      const target = { vacancyId, participationId, criterionId };
      const result = body ? await setChecklistMarkAction({ ...target, body }) : await clearChecklistMarkAction(target);
      if (!live.current) return;
      if (result.ok) replace(result.data ?? undefined);
      else {
        replace(previous);
        const ended = result.reason === "process_finished";
        if (ended) setFinished(true);
        const text = ended ? "El proceso finalizó. Las marcas están en solo lectura." : "No se guardó la marca. Se restauró el resultado anterior.";
        setNotice({ tone: ended ? "info" : "error", text });
        notifyActionResult({ key: "checklist-mark", type: "error", title: "No se guardó la marca", description: `${text} Puedes actualizar el tablero antes de volver a intentar.`, reference: { ...result.reference, at: new Date().toISOString() } });
      }
    } catch {
      if (!live.current) return;
      replace(previous);
      setNotice({ tone: "error", text: "No se guardó la marca. Se restauró el resultado anterior." });
      notifyActionResult({ key: "checklist-mark", type: "error", title: "No se guardó la marca", description: "Se restauró el resultado anterior. Actualiza el tablero antes de volver a intentar.", reference: { code: "no_response", at: new Date().toISOString() } });
    } finally {
      locks.current.delete(key); if (live.current) setPending(new Set(locks.current));
    }
  }
  return { checklist, marks, failed, reading, retry: () => setAttempt(value => value + 1), disabled: readOnly || finished, notice, pending, update, selection,
    select: (id: string) => setSelection(values => values.includes(id) ? values.filter(value => value !== id) : values.length < 5 ? [...values, id] : values) };
}
export type BoardChecklist = ReturnType<typeof useChecklist>;
const Context = createContext<BoardChecklist | null>(null);
export const useBoardChecklist = () => useContext(Context);
export function ChecklistProvider({ vacancyId, readOnly = false, children }: { vacancyId: string; readOnly?: boolean; children: ReactNode }) {
  const value = useChecklist(vacancyId, readOnly);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
