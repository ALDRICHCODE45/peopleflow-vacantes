import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Product copy uses tuteo; the developer bootstrap panel kept voseo strings.
const source = readFileSync(
  join(process.cwd(), "src/app/(auth)/empresa/bootstrap-local/bootstrap-local-panel.tsx"),
  "utf8",
).replace(/\s+/g, " ");

it.each([
  "Tu sesión no está disponible. Vuelve a ingresar con tu cuenta de empresa.",
  "Ya existe una operación pendiente. Complétala o espera a que expire antes de preparar otra.",
  "Existe un registro local incompatible. Detén la operación y revísalo manualmente.",
  "El código expiró. Prepara una operación nueva.",
  "No se pudo verificar la identidad con el proveedor. Reintenta más tarde.",
  "No pudimos confirmar el resultado. No reintentes automáticamente: verifica el estado antes de volver a intentar.",
  "No pudimos contactar la herramienta local. Verifica que esté disponible.",
  "que confirmas una acción explícita.",
  "Aprueba este código en la terminal local privada y después confirma la aplicación.",
])("uses the tuteo copy %j", (copy) => {
  expect(source).toContain(copy);
});

it("keeps no voseo form", () => {
  expect(source).not.toMatch(/\b(Volvé|Completala|esperá|Detené|revisalo|Prepará|Reintentá|verificá|Verificá|confirmás|Aprobá|confirmá)\b/u);
});
