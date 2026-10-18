import { redirect } from "next/navigation"

/** Legacy create URL: new vacancies start in the canonical draft editor. */
export default function Page() {
  redirect("/empresa/vacantes/borradores/nuevo")
}
