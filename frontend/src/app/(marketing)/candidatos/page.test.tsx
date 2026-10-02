import { Children, isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import MarketingPage from "../page";
import { ReferenceLandingMotion } from "@/components/marketing/ReferenceLandingMotion";
import CandidateMarketingPage, { metadata } from "./page";
import LegacyCandidatePage from "../para-candidatos/page";
import { permanentRedirect } from "next/navigation";

vi.mock("next/navigation", () => ({ permanentRedirect: vi.fn(() => { throw new Error("redirect"); }) }));

describe("candidate marketing route", () => {
  it("uses /candidatos as its canonical route and retains the landing composition", () => {
    expect(metadata.alternates?.canonical).toBe("/candidatos");
    expect(CandidateMarketingPage().props["data-pf-candidate-landing"]).toBe(true);
  });

  it("shares the employer wrapper, ambient layers and reveal animation without an alternate theme", () => {
    const candidate = CandidateMarketingPage();
    const employer = MarketingPage();
    expect(candidate.props.className).toBe(employer.props.className);
    expect(candidate.props["data-pf-reference-landing"]).toBe("");
    const children = Children.toArray(candidate.props.children).filter(isValidElement);
    expect(children.some((child) => child.type === ReferenceLandingMotion)).toBe(true);
    expect(children.slice(0, 2).map((child) => (child.props as { className: string }).className)).toEqual(
      Children.toArray(employer.props.children).filter(isValidElement).slice(0, 2).map((child) => (child.props as { className: string }).className),
    );
  });

  it("permanently redirects the previous URL to the canonical landing", () => {
    expect(() => LegacyCandidatePage()).toThrow("redirect");
    expect(permanentRedirect).toHaveBeenCalledWith("/candidatos");
  });
});
