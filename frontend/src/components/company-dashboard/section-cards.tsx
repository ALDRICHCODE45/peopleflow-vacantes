import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dashboard } from "@/features/employer-dashboard/model";

export function SectionCards({ data }: { data: Pick<Dashboard, "published_vacancies" | "in_process" | "pool_added_last_7_days" | "positions"> }) {
  const cards = [
    { title: "Vacantes publicadas", value: data.published_vacancies, description: "Vacantes visibles con publicación activa." },
    { title: "Candidatos en proceso", value: data.in_process, description: "Candidatos en etapas de progreso de tus vacantes publicadas." },
    { title: "Nuevos en la base", value: data.pool_added_last_7_days, description: "Candidatos incorporados a la base de tu empresa.", period: "Últimos 7 días" },
    { title: "Posiciones cubiertas", value: `${data.positions.covered}/${data.positions.required}`, description: "Posiciones cubiertas sobre las requeridas en tus vacantes publicadas." },
  ];
  return <div data-pf-kpi-cards="" className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
    {cards.map(card => <Card key={card.title}><CardHeader>
      <CardTitle><h3>{card.title}</h3></CardTitle>
      <CardDescription>{card.description}</CardDescription>
    </CardHeader><CardContent><p className="text-3xl font-semibold tabular-nums">{card.value}</p>
      {card.period && <p className="text-sm text-muted-foreground">{card.period}</p>}
    </CardContent></Card>)}
  </div>;
}
