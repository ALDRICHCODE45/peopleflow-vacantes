import * as React from "react"

import { CandidateHeader } from "./candidate-header"

/**
 * Shared candidate destination frame: the `(candidato)` layout owns the single
 * CandidateShell, so a route renders only its header plus the destination's
 * summary and the list of what the destination contains. It fakes no metric,
 * form, upload, saved state, session or success claim. CDP-04 onward fills each
 * destination with its real workspace behind this same frame.
 */
export function CandidateDestinationShell({
  title,
  summary,
  preview,
}: Readonly<{ title: string; summary: string; preview: readonly string[] }>) {
  return (
    <>
      <CandidateHeader title={title} />
      <div data-pf-destination={title} className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="flex w-full flex-col gap-4 px-4 lg:px-6">
              <p className="max-w-3xl text-sm text-muted-foreground">{summary}</p>
              <section data-pf-destination-preview aria-labelledby="candidate-preview-title" className="rounded-2xl border border-border bg-card/40 p-4 md:p-6">
                <h2 id="candidate-preview-title" className="font-heading text-base font-semibold text-foreground">Qué vas a encontrar</h2>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {preview.map((item) => (
                    <li key={item} className="flex gap-2.5 text-sm text-foreground">
                      <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
