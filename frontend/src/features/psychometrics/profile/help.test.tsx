import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { COMPETENCY_IDS, type Profile } from "../model";
import { ProfileEditor } from "./editor";
// The anchored Base UI positioner loops in jsdom inside this screen, so only the popup shell is
// replaced (real Root, Trigger, Title and our open/close logic). Escape, outside click and focus
// return are Base UI behavior, verified in the browser (odd/tasks/psychometric-competency-clarity.md).
vi.mock("@/components/ui/popover", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/popover")>(),
  PopoverContent: ({ children, ...props }: { children?: ReactNode; "data-help-popover"?: string }) => props["data-help-popover"] !== undefined && children ? <div role="dialog" aria-label="Ayuda">{children}</div> : null,
}));
vi.mock("../actions", () => ({ loadProfileAction: vi.fn(), saveProfileAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const names = ["Planificación y seguimiento", "Seguimiento de acuerdos", "Coordinación del trabajo", "Colaboración en equipo", "Exploración de alternativas", "Revisión antes de decidir", "Manejo de presión laboral"];
const descriptions = [
  "Organizar recursos y seguir un plan hasta cerrar tareas; el cuestionario considera lo que la persona declara sobre su preferencia por el orden y por seguir planes. Úsalo como una hipótesis para conversar en la entrevista, no como una prueba de cómo trabaja.",
  "Acordar entregas, cumplir lo acordado y avisar si hace falta ajustar; el cuestionario considera lo que la persona declara sobre seguir compromisos y esforzarse por superar lo esperado. No demuestra su honestidad ni garantiza que cumpla: pide ejemplos de trabajo.",
  "Proponer un rumbo y acercarse a otras personas para repartir y revisar el trabajo; el cuestionario considera lo que la persona declara sobre tomar la iniciativa para dirigir y acercarse a otras personas. No demuestra que sepa dirigir: explóralo con ejemplos de trabajo.",
  "Ofrecer ayuda y resolver diferencias sin romper acuerdos de trabajo; el cuestionario considera lo que la persona declara sobre dedicar tiempo a ayudar y evitar la confrontación. Evitar desacuerdos no siempre ayuda al equipo: pregunta cómo plantea una diferencia necesaria.",
  "Considerar alternativas y comprender ideas antes de probar cambios en el trabajo; el cuestionario considera lo que la persona declara sobre preferir la variedad y explorar ideas abstractas. No mide su capacidad para innovar: pide ejemplos de cambios que haya probado.",
  "Revisar consecuencias y decidir cuánto comprobar antes de actuar; el cuestionario considera lo que la persona declara sobre reflexionar antes de actuar y buscar menos experiencias intensas. Comprobar de más puede retrasar una decisión: pregunta cómo decide cuándo avanzar.",
  "Mantener la calma y avanzar ante presión y contratiempos del trabajo; el cuestionario considera lo que la persona declara sobre anticipar dificultades, reaccionar ante contratiempos y mantener la calma bajo presión. No es un diagnóstico: pregunta qué acciones de trabajo le ayudan a avanzar.",
];
const footer = "La relación con esta competencia es una hipótesis. Confírmala con ejemplos de trabajo.";
const fields = [
  ["Importancia en el puesto", "Clave: el puesto lo requiere con frecuencia; pide banda, tarea concreta y justificación. Importante: es útil para una tarea, pero no central en cada entrega; pide banda y justificación, sin tarea concreta. No relevante: no se usa para comparar ni priorizar preguntas; queda sin banda, tarea ni justificación."],
  ["Banda deseada", "Elige el estilo que necesita el puesto: Bajo describe poca presencia de esa tendencia; Medio, presencia en parte o según la situación; Alto, presencia clara. Alto no siempre es mejor: en decisiones reversibles, una reflexión media puede ayudar a avanzar sin detener la operación."],
  ["Tarea concreta", "Solo se pide para Clave: escribe una tarea observable del puesto, de 1 a 300 caracteres. Se usa para preparar preguntas de entrevista relacionadas con el trabajo; es necesaria para confirmar, no para guardar un borrador."],
  ["Justificación laboral", "Explica por qué esta competencia importa para una tarea del puesto: la evaluación debe estar ligada al trabajo, no a una preferencia personal. Es obligatoria para confirmar competencias Clave o Importante, de 1 a 1000 caracteres; puedes dejarla pendiente en un borrador."],
  ["Confirmar perfil", "Sin confirmar, puedes evaluar y ver las bandas, sin comparación con el puesto. Al confirmar habilitas la comparación y la guía de entrevista vinculada al perfil; editar los requisitos quita la confirmación y debes confirmar de nuevo."],
];
function mount() {
  const profile: Profile = { version: "1", enabled: false, confirmed: false, confirmed_at: null, test: "ipip60-mx", competencies: COMPETENCY_IDS.map(competency_id => ({ competency_id, importance: "importance.clave", desired_band: "band.medium", rationale: "Trabajo concreto", task: "Cerrar entregas" })), auto_send_stage_ids: [], expires_in_days: 7 };
  return render(<ProfileEditor draftId="vacancy" profile={profile} etag={'"pp1"'} stages={[]} />);
}
afterEach(cleanup);
it.each(names.map((name, index) => [name, index] as const))("shows %s in the list with an independent help that reveals its exact copy only on demand", async (name, index) => {
  mount();
  const list = within(screen.getByRole("list", { name: "Seleccionar competencia" }));
  expect(screen.queryByText(footer)).not.toBeInTheDocument();
  expect(screen.queryByText(descriptions[index])).not.toBeInTheDocument();
  const trigger = list.getByRole("button", { name: `¿Qué es ${name}?` });
  expect(trigger).toHaveClass("size-10");
  expect(trigger.closest("button")).toBe(trigger);
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const popup = await screen.findByRole("dialog", { name: "Ayuda" });
  expect(within(popup).getByText(name)).toBeVisible();
  expect(within(popup).getByText(descriptions[index])).toBeVisible();
  expect(within(popup).getByText(footer)).toBeVisible();
  // Opening help never selects the row: the first competency stays selected.
  expect(screen.getByRole("heading", { name: names[0], level: 4 })).toBeVisible();
  expect(list.getByRole("button", { name: new RegExp(`^${names[0]} `) })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(popup).getByRole("button", { name: "Cerrar ayuda" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ayuda" })).not.toBeInTheDocument());
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(list.getByRole("button", { name: new RegExp(`^${name} `) }));
  expect(screen.getByRole("heading", { name, level: 4 })).toBeVisible();
});
it("offers the same help next to the detail heading", async () => {
  mount();
  const detail = document.querySelector("[data-profile-detail]") as HTMLElement;
  fireEvent.click(within(detail).getByRole("button", { name: `¿Qué es ${names[0]}?` }));
  expect(await screen.findByRole("dialog", { name: "Ayuda" })).toHaveTextContent(descriptions[0]);
});
it.each(fields)("reveals the exact %s field help without modifying captured values", async (name, text) => {
  mount();
  expect(screen.queryByText(text)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: `Ayuda: ${name}` }));
  const popup = await screen.findByRole("dialog", { name: "Ayuda" });
  expect(within(popup).getByText(name)).toBeVisible();
  expect(within(popup).getByText(text)).toBeVisible();
  expect(within(popup).queryByText(footer)).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /Tarea concreta de/ })).toHaveValue("Cerrar entregas");
  expect(screen.getByText("No hay cambios pendientes.")).toBeInTheDocument();
});
it("keeps only one help open: opening another replaces the first", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Ayuda: Importancia en el puesto" }));
  expect(within(await screen.findByRole("dialog", { name: "Ayuda" })).getByText("Importancia en el puesto")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ayuda: Banda deseada" }));
  await waitFor(() => expect(screen.getAllByRole("dialog", { name: "Ayuda" })).toHaveLength(1));
  expect(within(screen.getByRole("dialog", { name: "Ayuda" })).getByText("Banda deseada")).toBeVisible();
  expect(screen.getByRole("button", { name: "Ayuda: Importancia en el puesto" })).toHaveAttribute("aria-expanded", "false");
});
