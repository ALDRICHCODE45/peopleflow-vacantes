import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { vacancyDetail, listItem, legacyDetail } from "../api/public-fixtures";
import type { PublicJobDetail } from "../types";
import { PublicVacancyCard } from "./PublicVacancyCard";
import { PublicJobDetailView } from "./PublicJobDetailView";
import { legacyApplicationJob } from "../enrich";

afterEach(cleanup);
const countries = [{ id: "MX", name: "México" }, { id: "CO", name: "Colombia" }, { id: "AR", name: "Argentina" }, { id: "CL", name: "Chile" }];
for (const surface of ["card", "detail"] as const) {
  const show = (job: PublicJobDetail) => render(surface === "card" ? <PublicVacancyCard job={listItem(job)} /> : <PublicJobDetailView job={job} />);
  it(`${surface} uses only the published label, including legacy text, and omits missing locations`, () => {
    const view = show({ ...vacancyDetail, location_label: "Zona publicada" });
    expect(screen.getAllByText(/Zona publicada/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Ciudad de México")).toBeNull();
    view.unmount();
    const empty = show({ ...vacancyDetail, location_label: null });
    expect(screen.queryByText("Ciudad de México")).toBeNull();
    empty.unmount();
    show({ ...legacyDetail, location_label: "Texto histórico" });
    expect(screen.getAllByText(/Texto histórico/).length).toBeGreaterThan(0);
  });
  it.each([1, 2, 3, 4])(`${surface} shows remote countries (%i) with the full accessible list`, count => {
    show({ ...vacancyDetail, work_mode: "remote", remote_scope: { kind: "countries", countries: countries.slice(0, count) } });
    const expected = ["México", "México y Colombia", "México, Colombia y Argentina", "México, Colombia y 2 más"][count - 1];
    expect(screen.getByText(`Solo desde ${expected}`)).toBeTruthy();
    expect(screen.getAllByText("Remoto").length).toBeGreaterThan(0);
    if (count === 4) expect(screen.getByTitle("Solo desde México, Colombia, Argentina y Chile")).toBeTruthy();
  });
  it(`${surface} shows anywhere only when explicitly published for remote work`, () => {
    const view = show({ ...vacancyDetail, work_mode: "remote", remote_scope: { kind: "anywhere" } });
    expect(screen.getByText("Desde cualquier lugar")).toBeTruthy();
    view.unmount();
    show({ ...vacancyDetail, work_mode: "remote", remote_scope: null });
    expect(screen.queryByText("Desde cualquier lugar")).toBeNull();
  });
}
it("legacy application summary adapter preserves the published label", () => {
  expect(legacyApplicationJob({ ...legacyDetail, location_label: "Texto histórico" }).location).toBe("Texto histórico");
});
