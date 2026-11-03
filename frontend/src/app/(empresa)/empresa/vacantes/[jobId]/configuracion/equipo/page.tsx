import { notFound } from "next/navigation";
import { fixtureNames, teamDataSource } from "@/features/vacancy-team/model";

export default async function Page({ params, searchParams }: { params?: Promise<{ jobId: string }>; searchParams: Promise<{ fixture?: string; state?: string }> }) {
  const source = teamDataSource(process.env.NODE_ENV, process.env.NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE);
  if (!source) notFound();
  if (source === "api") {
    if (!params) notFound();
    const { TeamApi } = await import("@/features/vacancy-team/api");
    return <TeamApi vacancyId={(await params).jobId} />;
  }
  const { fixture, state } = await searchParams;
  const selected = fixtureNames.find(name => name === fixture) ?? "owner";
  // The fixture adapter cannot execute until the server's development + opt-in gate passes.
  const { TeamPrototype } = await import("@/features/vacancy-team/prototype");
  return <TeamPrototype key={`${selected}-${state ?? "content"}`} fixture={selected} state={state} />;
}
