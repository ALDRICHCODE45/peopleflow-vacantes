import { notFound } from "next/navigation";
import { fixtureNames, prototypeEnabled } from "@/features/vacancy-team/model";

export default async function Page({ searchParams }: { searchParams: Promise<{ fixture?: string; state?: string }> }) {
  if (!prototypeEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE)) notFound();
  const { fixture, state } = await searchParams;
  const selected = fixtureNames.find(name => name === fixture) ?? "owner";
  // The fixture adapter cannot execute until the server's development + opt-in gate passes.
  const { TeamPrototype } = await import("@/features/vacancy-team/prototype");
  return <TeamPrototype key={`${selected}-${state ?? "content"}`} fixture={selected} state={state} />;
}
