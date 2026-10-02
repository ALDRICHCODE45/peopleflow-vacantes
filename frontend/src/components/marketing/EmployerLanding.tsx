import * as React from "react";
import {
  ArrowDown,
  ArrowRight,
  CircleCheck,
  GitBranch,
  Megaphone,
} from "lucide-react";

import { PeopleFlowLogo } from "@/components/brand/logo";
import { HeroAurora } from "@/components/marketing/HeroAurora";
import { ACME_PROTOTYPE_JOBS } from "@/features/jobs/prototype-jobs";
import { workModeLabel } from "@/features/jobs/formatters";
import { Button } from "@/components/ui/button";

type AudienceProps = { candidate?: boolean };

/**
 * Faithful React port of design/landing-preview/index.html (marketing only).
 *
 * - Every section, string, metric, candidate and illustration is copied from
 *   the reference, in the reference order. Copy is intentionally verbatim
 *   (including example metrics and prototype candidate data); links are
 *   non-operational `#` placeholders, as in the reference.
 * - Server components by default. The only client boundaries on this page are
 *   HeroAurora (WebGL), the navbar's ThemeToggle, and ReferenceLandingMotion.
 * - Styling comes from the scoped `reference-landing.css` sheet plus the
 *   reference's own Tailwind utility classes (see that file for the scoped
 *   tokens/utilities).
 */

// ─── Hero pipeline stage (fixed 580x420 geometry, scaled on mobile) ──────────

interface PipelineAvatar {
  color: string;
  ring: string;
}

interface PipelineNodeProps {
  left: number;
  top: number;
  accent: string;
  accentShadow: string;
  title: string;
  count: string;
  countStyle?: React.CSSProperties;
  avatars: PipelineAvatar[];
  trailing: string;
  active?: boolean;
}

function PipelineNode({
  left,
  top,
  accent,
  accentShadow,
  title,
  count,
  countStyle,
  avatars,
  trailing,
  active = false,
}: PipelineNodeProps) {
  return (
    <div className="absolute" style={{ left: `${left}px`, top: `${top}px` }}>
      <div
        className={
          active
            ? "node-active w-[170px] rounded-xl border border-cyan/70 bg-surface2/90 px-3.5 py-3 backdrop-blur-sm"
            : "w-[170px] rounded-xl border border-line bg-surface/85 px-3.5 py-3 shadow-xl backdrop-blur-sm"
        }
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className="h-6 w-6 shrink-0 rounded-full"
              style={{ background: accent, boxShadow: accentShadow }}
            />
            <span className="text-[13.5px] font-semibold text-ink">
              {title}
            </span>
          </div>
          <span
            className={
              countStyle
                ? "rounded-md px-1.5 py-0.5 text-[11px] font-bold"
                : "rounded-md overlay-soft px-1.5 py-0.5 text-[11px] font-bold text-muted"
            }
            style={countStyle}
          >
            {count}
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="avatar-stack flex">
            {avatars.map((avatar) => (
              <span
                key={avatar.color}
                className={`h-5 w-5 rounded-full ring-2 ${avatar.ring}`}
                style={{ background: avatar.color }}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted">{trailing}</span>
        </div>
      </div>
    </div>
  );
}

function PipelineStage({ candidate = false }: AudienceProps) {
  return (
    <div className="pf-pipeline-scaler">
      <div className="pf-pipeline-stage">
        {/* SVG connectors + traveling candidate */}
        <svg
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 580 420"
          fill="none"
        >
          <defs>
            <linearGradient id="linkGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#8B5CF6" />
              <stop offset="1" stopColor="#22D3EE" />
            </linearGradient>
            <filter id="dotGlow" x="-300%" y="-300%" width="700%" height="700%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* base curved links */}
          <path
            d="M170 210 H205"
            stroke="url(#linkGrad)"
            strokeWidth="2"
            opacity="0.55"
          />
          <path
            d="M375 210 C 398 210, 410 160, 410 108"
            stroke="url(#linkGrad)"
            strokeWidth="2"
            opacity="0.55"
          />
          <path
            d="M375 210 C 398 210, 410 262, 410 312"
            stroke="url(#linkGrad)"
            strokeWidth="2"
            opacity="0.55"
          />

          {/* animated flow overlay */}
          <path d="M170 210 H205" stroke="#22D3EE" strokeWidth="2" className="flow" />
          <path
            d="M375 210 C 398 210, 410 160, 410 108"
            stroke="#22D3EE"
            strokeWidth="2"
            className="flow"
          />
          <path
            d="M375 210 C 398 210, 410 262, 410 312"
            stroke="#22D3EE"
            strokeWidth="2"
            className="flow"
          />

          {/* traveling candidate along the happy path */}
          <circle r="4.5" fill="#22D3EE" filter="url(#dotGlow)">
            <animateMotion
              dur="5s"
              repeatCount="indefinite"
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
              path="M170 210 H375 C 398 210 410 262 410 312 H 470"
            />
            <animate
              attributeName="opacity"
              dur="5s"
              repeatCount="indefinite"
              values="0;1;1;1;0"
              keyTimes="0;0.08;0.5;0.92;1"
            />
          </circle>
        </svg>

        <PipelineNode
          left={0}
          top={171}
          accent="#9336ea"
          accentShadow="0 0 12px 1px rgba(147, 54, 234, 0.6)"
          title={candidate ? "Explora" : "Nueva vacante"}
          count={candidate ? "01" : "24"}
          avatars={[
            { color: "#7c4dff", ring: "ring-surface" },
            { color: "#b266ff", ring: "ring-surface" },
            { color: "#9b6bff", ring: "ring-surface" },
          ]}
          trailing={candidate ? "A tu manera" : "+21"}
        />
        <PipelineNode
          left={205}
          top={171}
          accent="#22d3ee"
          accentShadow="0 0 12px 1px rgba(34, 211, 238, 0.6)"
          title={candidate ? "Postúlate" : "Screening"}
          count={candidate ? "02" : "8"}
          countStyle={{ background: "rgba(34, 211, 238, 0.16)", color: "var(--pf-on-cyan)" }}
          avatars={[
            { color: "#22d3ee", ring: "ring-surface2" },
            { color: "#7c4dff", ring: "ring-surface2" },
            { color: "#1fc4de", ring: "ring-surface2" },
          ]}
          trailing={candidate ? "Presenta tu perfil" : "IA + filtros"}
          active
        />
        <PipelineNode
          left={410}
          top={66}
          accent="#d946ef"
          accentShadow="0 0 12px 1px rgba(217, 70, 239, 0.55)"
          title={candidate ? "En revisión" : "Entrevista"}
          count={candidate ? "03" : "3"}
          avatars={[
            { color: "#d946ef", ring: "ring-surface" },
            { color: "#b266ff", ring: "ring-surface" },
            { color: "#e879f9", ring: "ring-surface" },
          ]}
          trailing={candidate ? "Conoce la etapa" : "Agendadas"}
        />
        <PipelineNode
          left={410}
          top={276}
          accent="#22c55e"
          accentShadow="0 0 12px 1px rgba(34, 197, 94, 0.55)"
          title={candidate ? "Próximo paso" : "Contratado"}
          count={candidate ? "04" : "1"}
          countStyle={{ background: "rgba(34, 197, 94, 0.16)", color: "var(--pf-on-green)" }}
          avatars={[{ color: "#22c55e", ring: "ring-surface" }]}
          trailing={candidate ? "Continúa tu camino" : "Oferta enviada"}
        />
      </div>
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

export function EmployerHero({ candidate = false }: AudienceProps = {}) {
  return (
    <div className="relative">
      <HeroAurora audience={candidate ? "candidate" : "employer"} />
      <section aria-label={candidate ? "Tu siguiente paso" : undefined} data-pf-candidate-section={candidate ? "hero" : undefined} className="relative z-10 mx-auto max-w-[1280px] px-8 pt-24 pb-20 md:pt-32">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)]">
          {/* Hero copy */}
          <div className="reveal">
            <p className="eyebrow mb-6 font-mono text-[12px] font-semibold uppercase text-brand">
              {candidate ? "PeopleFlow para candidatos" : "Ecosistema de reclutamiento"}
            </p>
            <h1 className="font-display text-[64px] font-bold leading-[1.02] tracking-tight text-ink">
              {candidate ? "Explora. Postúlate. Avanza." : "Publica. Recibe. Contrata."}
            </h1>
            <p className="mt-7 max-w-[520px] text-[17px] leading-relaxed text-muted">
              {candidate
                ? "Encuentra oportunidades, presenta lo que sabes hacer y sigue tus postulaciones. Tu búsqueda y tu siguiente paso profesional, en un mismo lugar."
                : <>Publica tus vacantes en la bolsa de trabajo, recibe postulaciones
                  y gestiona cada candidato en tu pipeline. La bolsa y el ATS,
                  conectados de punta a punta.</>}
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a
                href={candidate ? "/vacantes" : "#"}
                className="btn btn-primary rounded-xl bg-brand px-7 py-3.5 text-[15px] font-semibold text-white"
              >
                {candidate ? "Explorar vacantes" : "Empezar gratis"}
              </a>
              <a
                href={candidate ? "/candidato/login" : "#"}
                className="btn btn-ghost rounded-xl border border-line bg-surface px-7 py-3.5 text-[15px] font-semibold text-ink"
              >
                {candidate ? "Ingresar a mi perfil" : "Agendar demo"}
              </a>
            </div>
          </div>

          {/* Hero pipeline visual */}
          <div className="reveal relative">
            <div
              className="relative flex items-center overflow-hidden rounded-3xl border border-line bg-surface/40 p-8"
              style={{ minHeight: "540px" }}
            >
              <div className="canvas-grid pointer-events-none absolute inset-0" />
              <div className="glow-purple pointer-events-none absolute left-1/2 top-1/2 h-[470px] w-[470px] -translate-x-1/2 -translate-y-1/2" />
              <div className="floaty relative w-full">
                <PipelineStage candidate={candidate} />
              </div>
            </div>
          </div>
        </div>

        {/* stats / trust strip */}
        <div className="reveal mt-24 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line/50 sm:grid-cols-3">
          <div className="bg-base/70 px-8 py-8 text-center">
            <p className="font-display text-[38px] font-bold text-ink">
              {candidate ? "Explora" : "−68%"}
            </p>
            <p className="mt-1.5 text-[13px] text-muted">{candidate ? "oportunidades a tu manera" : "tiempo por vacante"}</p>
          </div>
          <div className="bg-base/70 px-8 py-8 text-center">
            <p className="font-display text-[38px] font-bold text-ink">{candidate ? "Postúlate" : "100%"}</p>
            <p className="mt-1.5 text-[13px] text-muted">
              {candidate ? "con tu experiencia al frente" : "del pipeline, siempre visible"}
            </p>
          </div>
          <div className="bg-base/70 px-8 py-8 text-center">
            <p className="font-display text-[38px] font-bold text-ink">{candidate ? "Avanza" : "1"}</p>
            <p className="mt-1.5 text-[13px] text-muted">
              {candidate ? "con tus procesos en un solo lugar" : "solo lugar para todo el equipo"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Two systems ─────────────────────────────────────────────────────────────

function SystemCard({
  tone,
  icon: Icon,
  cornerStyle,
  badge,
  title,
  description,
  bullets,
}: {
  tone: "brand" | "cyan";
  icon: React.ComponentType<{ className?: string }>;
  cornerStyle: React.CSSProperties;
  badge: string;
  title: string;
  description: string;
  bullets: string[];
}) {
  const accentText = tone === "brand" ? "text-brand" : "text-cyan";
  const accentBorder = tone === "brand" ? "border-brand/30" : "border-cyan/30";
  return (
    <article className="card reveal relative flex h-full flex-col gap-5 overflow-hidden rounded-3xl border border-line bg-surface p-8 lg:p-9">
      <span
        className="pointer-events-none absolute h-64 w-64 rounded-full"
        style={cornerStyle}
      />
      <div className="relative flex items-center justify-between">
        <span
          className={`grid h-11 w-11 place-items-center rounded-xl border ${accentBorder} bg-base/40 ${accentText}`}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span
          className={`rounded-full overlay-soft px-3 py-1 text-[11px] font-mono font-semibold uppercase tracking-wide ${accentText}`}
        >
          {badge}
        </span>
      </div>
      <div className="relative">
        <h3 className="text-[24px] font-bold text-ink">{title}</h3>
        <p className="mt-2 max-w-[440px] text-[15px] leading-relaxed text-muted">
          {description}
        </p>
      </div>
      <ul className="relative mt-auto flex flex-col gap-3 pt-2 text-[14px] text-ink">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-3">
            <CircleCheck className={`mt-[3px] h-4 w-4 shrink-0 ${accentText}`} />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function TwoSystemsSection({ candidate = false }: AudienceProps = {}) {
  return (
    <section
      id="soluciones"
      aria-label={candidate ? "Cómo funciona" : undefined}
      data-pf-candidate-section={candidate ? "discovery" : undefined}
      className="relative z-10 mx-auto max-w-[1280px] scroll-mt-28 px-8 py-24"
    >
      <div className="reveal mx-auto mb-16 max-w-[720px] text-center">
        <p className="eyebrow mb-4 font-mono text-[12px] font-semibold uppercase text-glow">
          {candidate ? "Tu búsqueda, conectada" : "Un ecosistema, dos sistemas"}
        </p>
        <h2 className="font-display text-[42px] font-bold leading-tight tracking-tight text-ink">
          {candidate ? "Las oportunidades y tu talento, conectados." : "La bolsa de trabajo y tu ATS, conectados."}
        </h2>
        <p className="mt-5 text-[18px] leading-relaxed text-muted">
          {candidate
            ? "Conoce lo que ofrece cada vacante y dale contexto a tu experiencia. De explorar oportunidades a presentar tu perfil, sin perder el hilo."
            : <>Publica una vacante en la bolsa y cada postulación entra sola a tu
              pipeline. Bolsa y ATS, el mismo ecosistema de principio a fin.</>}
        </p>
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <SystemCard
          tone="brand"
          icon={Megaphone}
          cornerStyle={{
            top: "-6rem",
            left: "-6rem",
            background:
              "radial-gradient(closest-side, rgba(147, 54, 234, 0.22), transparent 70%)",
            filter: "blur(2px)",
          }}
          badge={candidate ? "Explora" : "Sistema A"}
          title="Bolsa de trabajo"
          description={candidate ? "Busca oportunidades, compara sus condiciones y conoce a las empresas antes de postularte." : "Publica vacantes y llega a candidatos. Ellos buscan, filtran y se postulan desde tu bolsa pública."}
          bullets={candidate ? [
            "Filtros para enfocar tu búsqueda",
            "Modalidad y requisitos a primera vista",
            "Un espacio para conocer a cada empresa",
          ] : [
            "Publicación de vacantes en minutos",
            "Postulaciones self-service",
            "Página de marca empleadora",
          ]}
        />

        {/* Connector A → B */}
        <div className="reveal flex flex-col items-center justify-center gap-3">
          <span className="rounded-full overlay-soft px-3 py-1 text-[11px] font-mono font-semibold uppercase tracking-wider text-ink">
            {candidate ? "conecta con" : "fluye a"}
          </span>
          <span
            className="grid h-14 w-14 place-items-center rounded-full border border-brand/40 bg-base/70 text-brand"
            style={{ boxShadow: "0 0 28px 0 rgba(147, 54, 234, 0.45)" }}
          >
            <ArrowRight className="hidden h-6 w-6 lg:block" />
            <ArrowDown className="block h-6 w-6 lg:hidden" />
          </span>
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted">
            {candidate ? "tu siguiente paso" : "en tiempo real"}
          </span>
        </div>

        <SystemCard
          tone="cyan"
          icon={GitBranch}
          cornerStyle={{
            top: "-6rem",
            right: "-6rem",
            background:
              "radial-gradient(closest-side, rgba(34, 211, 238, 0.18), transparent 70%)",
            filter: "blur(2px)",
          }}
          badge={candidate ? "Preséntate" : "Sistema B"}
          title={candidate ? "Tu perfil · Tu trayectoria" : "ATS · Pipeline"}
          description={candidate ? "Reúne tu experiencia, habilidades y preferencias. Dale a cada empresa una mejor idea de lo que puedes aportar." : "Cada postulación entra directo a tu pipeline. Screening con IA, scoring, entrevistas y decisiones del equipo, todo en un solo lugar."}
          bullets={candidate ? [
            "Tu experiencia y habilidades en contexto",
            "Tu formación y preferencias de trabajo",
            "Un lugar para consultar tus postulaciones",
          ] : [
            "Screening con IA y scoring automático",
            "Pipeline por etapas con drag & drop",
            "Coordinación y decisiones del equipo",
          ]}
        />
      </div>
    </section>
  );
}

// ─── Value props (bento) ─────────────────────────────────────────────────────

interface MiniKanbanRow {
  color: string;
  primary: string;
  secondary: string;
}

interface MiniKanbanColumn {
  dot: string;
  label: string;
  rows: MiniKanbanRow[];
}

const MINI_KANBAN: MiniKanbanColumn[] = [
  {
    dot: "bg-brand",
    label: "Nueva vacante",
    rows: [
      { color: "#7c4dff", primary: "w-16", secondary: "w-10" },
      { color: "#b266ff", primary: "w-14", secondary: "w-10" },
      { color: "#9b6bff", primary: "w-16", secondary: "w-9" },
      { color: "#6d3fe0", primary: "w-12", secondary: "w-11" },
    ],
  },
  {
    dot: "bg-cyan",
    label: "Screening",
    rows: [
      { color: "#22d3ee", primary: "w-16", secondary: "w-9" },
      { color: "#1fc4de", primary: "w-14", secondary: "w-9" },
    ],
  },
  {
    dot: "bg-grass",
    label: "Contratado",
    rows: [{ color: "#22c55e", primary: "w-14", secondary: "w-10" }],
  },
];

function MiniKanban({ candidate = false }: AudienceProps) {
  return (
    <div className="grid flex-1 grid-cols-3 gap-3">
      {MINI_KANBAN.map((column, index) => (
        <div
          key={column.label}
          className="flex flex-col gap-2.5 rounded-2xl bg-base/70 p-3"
        >
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${column.dot}`} />
            <span className="text-[12px] font-semibold text-ink">
              {candidate ? ["Postulada", "En revisión", "Entrevista"][index] : column.label}
            </span>
          </div>
          {column.rows.map((row) => (
            <div
              key={row.color}
              className="flex items-center gap-2 rounded-lg bg-elevated p-2.5"
            >
              <span
                className="h-5 w-5 rounded-full"
                style={{ background: row.color }}
              />
              <span className="flex flex-col gap-1.5">
                <span className={`block h-1.5 ${row.primary} rounded bg-line`} />
                <span
                  className={`block h-1 ${row.secondary} rounded bg-line/70`}
                />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface ResumeRow {
  color: string;
  primary: string;
  secondary: string;
  score: string;
  scoreStyle: React.CSSProperties;
}

const SCREENING_ROWS: ResumeRow[] = [
  {
    color: "#7c4dff",
    primary: "w-24",
    secondary: "w-14",
    score: "94%",
    scoreStyle: { background: "rgba(34, 197, 94, 0.16)", color: "var(--pf-on-green)" },
  },
  {
    color: "#22d3ee",
    primary: "w-20",
    secondary: "w-12",
    score: "88%",
    scoreStyle: { background: "rgba(34, 211, 238, 0.16)", color: "var(--pf-on-cyan)" },
  },
  {
    color: "#b266ff",
    primary: "w-24",
    secondary: "w-11",
    score: "76%",
    scoreStyle: { background: "rgba(224, 168, 62, 0.16)", color: "var(--pf-on-amber)" },
  },
];

const TEAM_AVATARS = ["#7c4dff", "#22d3ee", "#d946ef", "#22c55e"];

export function ValuePropsSection({ candidate = false }: AudienceProps = {}) {
  return (
    <section aria-label={candidate ? "Tu búsqueda a tu manera" : undefined} data-pf-candidate-section={candidate ? "benefits" : undefined} className="mx-auto max-w-[1280px] px-8 py-24">
      <div className="reveal mx-auto mb-14 max-w-[640px] text-center">
        <h2 className="font-display text-[42px] font-bold leading-tight tracking-tight text-ink">
          {candidate ? "Tu siguiente paso, a tu manera" : "Todo el proceso, bajo tu control"}
        </h2>
        <p className="mt-4 text-[18px] leading-relaxed text-muted">
          {candidate ? "Lo que buscas, lo que sabes hacer y las oportunidades que te interesan. Dale a tu búsqueda un lugar propio." : <>Desde la vacante hasta la contratación, cada etapa es visible, medible
          y tuya.</>}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card reveal flex flex-col gap-6 rounded-3xl border border-line bg-surface p-8">
          <div>
            <h3 className="text-[24px] font-bold text-ink">{candidate ? "Tus postulaciones, a la vista" : "Pipeline visible"}</h3>
            <p className="mt-2 max-w-[440px] text-[15px] leading-relaxed text-muted">
              {candidate ? "Consulta las oportunidades a las que te postulaste y la etapa de cada proceso desde tu perfil." : <>Mira a cada candidato avanzar por tus etapas en tiempo real. Sin
              hojas de cálculo, sin cajas negras.</>}
            </p>
          </div>
          <MiniKanban candidate={candidate} />
          {candidate && <p className="text-[12px] text-muted">Vista ilustrativa de las etapas, no son postulaciones reales.</p>}
        </div>

        <div className="flex flex-col gap-6">
          <div className="card reveal flex flex-col gap-5 rounded-3xl border border-line bg-surface p-7">
            <div>
              <h3 className="text-[20px] font-bold text-ink">
                {candidate ? "Tu experiencia cuenta" : "Screening con IA"}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                {candidate ? "Presenta tu trayectoria, tus habilidades y tu formación. Tu perfil habla de lo que puedes aportar." : <>La IA filtra y ordena los mejores perfiles. La decisión final
                siempre es tuya.</>}
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {SCREENING_ROWS.map((row, index) => (
                <div
                  key={row.color}
                  className="flex items-center gap-3 rounded-xl bg-base/70 p-3"
                >
                  <span
                    className="h-7 w-7 shrink-0 rounded-full"
                    style={{ background: row.color }}
                  />
                  <span className="flex flex-1 flex-col gap-1.5">
                    <span
                      className={`block h-2 ${row.primary} rounded bg-line`}
                    />
                    <span
                      className={`block h-1.5 ${row.secondary} rounded bg-line/70`}
                    />
                  </span>
                  <span
                    className="rounded-full px-2.5 py-1 text-[12px] font-bold"
                    style={row.scoreStyle}
                  >
                    {candidate ? ["Experiencia", "Habilidades", "Formación"][index] : row.score}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="card reveal flex flex-col gap-5 rounded-3xl border border-line bg-surface p-7">
            <div>
              <h3 className="text-[20px] font-bold text-ink">
                {candidate ? "Conoce a tu próximo equipo" : "Tu equipo, coordinado"}
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-muted">
                {candidate ? "Explora las empresas y lo que están construyendo. Una buena decisión empieza por conocer tus opciones." : <>Comentarios, evaluaciones y decisiones en un solo lugar. Todos
                alineados, sin correos perdidos.</>}
              </p>
            </div>
            <div className="flex items-center gap-4 rounded-xl bg-base/70 p-4">
              <div className="avatar-stack flex">
                {TEAM_AVATARS.map((color) => (
                  <span
                    key={color}
                    className="h-8 w-8 rounded-full ring-2 ring-surface"
                    style={{ background: color }}
                  />
                ))}
              </div>
              <span className="flex flex-1 flex-col gap-1.5 rounded-lg bg-elevated p-3">
                <span className="block h-2 w-32 rounded bg-line" />
                <span className="block h-1.5 w-20 rounded bg-line/70" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Showcase (kanban board) ─────────────────────────────────────────────────

type ScoreTone = "green" | "cyan";

interface ShowcaseCardModel {
  href?: string;
  name: string;
  role: string;
  color: string;
  borderClass: string;
  hoverClass?: string;
  tags?: string[];
  metaBadge?: string;
  metaText?: string;
  score?: string;
  tone?: ScoreTone;
  check?: boolean;
}

interface ShowcaseColumnModel {
  dot: string;
  title: string;
  count: string;
  cards: ShowcaseCardModel[];
}

const SCORE_STYLES: Record<ScoreTone, React.CSSProperties> = {
  green: { background: "rgba(34, 197, 94, 0.16)", color: "var(--pf-on-green)" },
  cyan: { background: "rgba(34, 211, 238, 0.16)", color: "var(--pf-on-cyan)" },
};

const SHOWCASE_COLUMNS: ShowcaseColumnModel[] = [
  {
    dot: "bg-brand",
    title: "Nueva vacante",
    count: "3",
    cards: [
      {
        name: "Sofía Ramírez",
        role: "Frontend Engineer",
        color: "#7c4dff",
        borderClass: "border-line",
        hoverClass: "hover:border-brand/50",
        tags: ["React", "Remoto"],
      },
      {
        name: "Diego Herrera",
        role: "Backend Engineer",
        color: "#b266ff",
        borderClass: "border-line",
        hoverClass: "hover:border-brand/50",
        tags: ["Go", "Senior"],
      },
      {
        name: "Valeria Cruz",
        role: "Fullstack",
        color: "#9b6bff",
        borderClass: "border-line",
        hoverClass: "hover:border-brand/50",
        tags: ["Node"],
      },
    ],
  },
  {
    dot: "bg-cyan",
    title: "Screening",
    count: "2",
    cards: [
      {
        name: "Mateo Gómez",
        role: "Backend Engineer",
        color: "#22d3ee",
        borderClass: "border-cyan/30",
        hoverClass: "hover:border-cyan/60",
        metaBadge: "Go · K8s",
        score: "92%",
        tone: "green",
      },
      {
        name: "Camila Ríos",
        role: "DevOps",
        color: "#1fc4de",
        borderClass: "border-line",
        hoverClass: "hover:border-cyan/60",
        metaBadge: "AWS",
        score: "87%",
        tone: "cyan",
      },
    ],
  },
  {
    dot: "bg-magenta",
    title: "Entrevista",
    count: "2",
    cards: [
      {
        name: "Andrés Vega",
        role: "Backend Engineer",
        color: "#d946ef",
        borderClass: "border-line",
        hoverClass: "hover:border-magenta/50",
        metaText: "Mié · 15:00",
        score: "90%",
        tone: "green",
      },
      {
        name: "Lucía Peña",
        role: "Frontend Engineer",
        color: "#e879f9",
        borderClass: "border-line",
        hoverClass: "hover:border-magenta/50",
        metaText: "Jue · 11:30",
        score: "88%",
        tone: "cyan",
      },
    ],
  },
  {
    dot: "bg-grass",
    title: "Contratado",
    count: "1",
    cards: [
      {
        name: "Javier Solís",
        role: "Backend Engineer",
        color: "#22c55e",
        borderClass: "border-grass/30",
        metaText: "Oferta aceptada",
        check: true,
      },
    ],
  },
];

function ShowcaseCard({ card }: { card: ShowcaseCardModel }) {
  const tone = card.tone ?? "green";
  return (
    <div
      className={`rounded-xl border ${card.borderClass} bg-surface p-3.5${
        card.hoverClass ? ` transition ${card.hoverClass}` : ""
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="h-8 w-8 rounded-full"
          style={{ background: card.color }}
        />
        <span>
          <span className="block text-[13px] font-semibold text-ink">
            {card.href ? <a href={card.href} className="inline-flex min-h-10 items-center hover:underline">{card.name}</a> : card.name}
          </span>
          <span className="block text-[11px] text-muted">{card.role}</span>
        </span>
      </div>

      {card.tags ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {card.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md overlay-soft px-2 py-0.5 text-[10.5px] text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      {card.metaBadge || card.metaText ? (
        <div className="mt-3 flex items-center justify-between">
          {card.metaBadge ? (
            <span className="rounded-md overlay-soft px-2 py-0.5 text-[10.5px] text-muted">
              {card.metaBadge}
            </span>
          ) : (
            <span className="text-[10.5px] text-muted">{card.metaText}</span>
          )}
          {card.check ? (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={SCORE_STYLES.green}
            >
              ✓
            </span>
          ) : (
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-bold"
              style={SCORE_STYLES[tone]}
            >
              {card.score}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

// The candidate board illustrates the journey, not fabricated application data.
// Only vacancy cards link out, using the exact existing fixture identifiers.
const CANDIDATE_SHOWCASE_COLUMNS: ShowcaseColumnModel[] = [
  {
    dot: "bg-brand", title: "Explora", count: String(ACME_PROTOTYPE_JOBS.length),
    cards: ACME_PROTOTYPE_JOBS.map((job) => ({
      name: job.title, role: job.company.name, href: `/vacantes/${job.id}`,
      color: SHOWCASE_COLUMNS[0].cards[0].color, borderClass: "border-line",
      hoverClass: "hover:border-brand/50", tags: [workModeLabel(job.work_mode)],
    })),
  },
  {
    dot: "bg-cyan", title: "Tu perfil", count: "2",
    cards: [
      { name: "Tu experiencia", role: "Cuenta tu trayectoria", color: SHOWCASE_COLUMNS[1].cards[0].color, borderClass: "border-line", tags: ["Experiencia", "Formación"] },
      { name: "Tus habilidades", role: "Destaca lo que sabes hacer", color: SHOWCASE_COLUMNS[0].cards[1].color, borderClass: "border-line", tags: ["Tu talento"] },
    ],
  },
  {
    dot: "bg-magenta", title: "Postúlate", count: "2",
    cards: [
      { name: "Tus datos", role: "Revisa antes de enviar", color: SHOWCASE_COLUMNS[2].cards[0].color, borderClass: "border-line", tags: ["Tu postulación"] },
      { name: "Tu CV", role: "Adjunta un archivo si quieres", color: SHOWCASE_COLUMNS[2].cards[1].color, borderClass: "border-line", tags: ["Opcional"] },
    ],
  },
  {
    dot: "bg-grass", title: "Da seguimiento", count: "1",
    cards: [{ name: "Tus postulaciones", role: "Consulta tus procesos", color: SHOWCASE_COLUMNS[3].cards[0].color, borderClass: "border-line", tags: ["Desde tu perfil"] }],
  },
];

export function ShowcaseSection({ candidate = false }: AudienceProps = {}) {
  return (
    <section
      id="producto"
      aria-label={candidate ? "Oportunidades y postulaciones" : undefined}
      data-pf-candidate-section={candidate ? "showcase" : undefined}
      className="relative z-10 mx-auto max-w-[1280px] scroll-mt-28 px-8 py-24"
    >
      <div className="reveal mx-auto mb-12 max-w-[660px] text-center">
        <p className="eyebrow mb-4 font-mono text-[12px] font-semibold uppercase text-brand">
          {candidate ? "De la búsqueda al siguiente paso" : "El producto"}
        </p>
        <h2 className="font-display text-[42px] font-bold leading-tight tracking-tight text-ink">
          {candidate ? "Tu búsqueda, en acción" : "Tu tablero, en acción"}
        </h2>
        <p className="mt-4 text-[18px] leading-relaxed text-muted">
          {candidate ? "Explora una vacante, presenta tu perfil y sigue tu camino. Así se conectan los pasos de tu búsqueda en PeopleFlow." : <>Arrastra candidatos entre etapas, deja comentarios y decide en equipo.
          Todo el proceso en una sola vista.</>}
        </p>
      </div>

      <div className="reveal card overflow-hidden rounded-2xl border border-line bg-surface/60 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <span className="flex gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </span>
          <div className="ml-3 flex items-center gap-2 rounded-lg border border-line bg-base/60 px-3 py-1.5 text-[12px] text-muted">
            <span className="h-2 w-2 rounded-full bg-brand" />
            {candidate ? "Tu recorrido · Vista de ejemplo" : "Vacante · Backend Developer (Senior)"}
          </div>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <span className="rounded-md overlay-soft px-2.5 py-1 text-[12px] text-muted">
              {candidate ? "Explorar" : "Filtrar"}
            </span>
            <span className="rounded-md bg-brand px-2.5 py-1 text-[12px] font-semibold text-white">
              {candidate ? "Tu siguiente paso" : "+ Candidato"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 p-5 lg:grid-cols-4">
          {(candidate ? CANDIDATE_SHOWCASE_COLUMNS : SHOWCASE_COLUMNS).map((column) => (
            <div
              key={column.title}
              className="flex flex-col gap-3 rounded-xl bg-base/50 p-3"
            >
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${column.dot}`} />
                  <span className="text-[13px] font-semibold text-ink">
                    {column.title}
                  </span>
                </div>
                <span className="text-[12px] text-muted">{column.count}</span>
              </div>
              {column.cards.map((card) => (
                <ShowcaseCard key={card.name} card={card} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Closing CTA ─────────────────────────────────────────────────────────────

export function ClosingCtaSection({ candidate = false }: AudienceProps = {}) {
  return (
    <section
      id="empezar"
      aria-label={candidate ? "Empieza tu búsqueda" : undefined}
      data-pf-candidate-section={candidate ? "closing" : undefined}
      className="relative z-10 mx-auto max-w-[1280px] scroll-mt-28 px-8 py-20"
    >
      <div className="reveal relative overflow-hidden rounded-3xl border border-line bg-surface/50 px-8 py-20 text-center backdrop-blur-sm">
        <div className="glow-purple pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[720px] -translate-x-1/2 -translate-y-1/2" />
        <div className="relative">
          <h2 className="font-display text-[46px] font-bold leading-tight tracking-tight text-ink">
            {candidate ? "Tu siguiente paso empieza aquí" : "Empieza a ver todo tu proceso"}
          </h2>
          <p className="mx-auto mt-4 max-w-[560px] text-[18px] leading-relaxed text-muted">
            {candidate ? "Empieza por explorar. Cuando encuentres una oportunidad que te interese, conoce los detalles y muestra lo que puedes aportar." : <>Publica tu primera vacante en la bolsa y sigue cada postulación en
            tu pipeline. Sin tarjeta, sin fricción.</>}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a
              href={candidate ? "/vacantes" : "#"}
              className="btn btn-primary rounded-xl bg-brand px-8 py-3.5 text-[15px] font-semibold text-white"
            >
              {candidate ? "Explorar vacantes" : "Empezar gratis"}
            </a>
            <a
              href={candidate ? "/candidato/login" : "#"}
              className="btn btn-ghost rounded-xl border border-line bg-surface px-8 py-3.5 text-[15px] font-semibold text-ink"
            >
              {candidate ? "Ingresar a mi perfil" : "Agendar demo"}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────────

const FOOTER_COLUMNS = [
  {
    heading: "Producto",
    links: ["Bolsa de trabajo", "Pipeline", "Screening IA", "Precios"],
  },
  { heading: "Empresa", links: ["Nosotros", "Clientes", "Contacto"] },
  { heading: "Recursos", links: ["Blog", "Guías", "Soporte"] },
] as const;

const CANDIDATE_FOOTER_COLUMNS = [
  { heading: "Explora", links: ["Vacantes", "Cómo funciona", "Oportunidades"] },
  { heading: "Tu perfil", links: ["Ingresar a mi perfil", "Tu siguiente paso"] },
  { heading: "PeopleFlow", links: ["Para empresas", "Para candidatos"] },
];
const CANDIDATE_FOOTER_HREFS: Record<string, string> = {
  "Vacantes": "/vacantes", "Cómo funciona": "#soluciones", "Oportunidades": "#producto",
  "Ingresar a mi perfil": "/candidato/login", "Tu siguiente paso": "#empezar",
  "Para empresas": "/", "Para candidatos": "/candidatos",
};

export function EmployerFooter({ candidate = false }: AudienceProps = {}) {
  return (
    <footer role="contentinfo" className="relative z-10 border-t border-line">
      <div className="mx-auto max-w-[1280px] px-8 py-14">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <a href={candidate ? "/candidatos" : "#"} aria-label="PeopleFlow" className="inline-block select-none">
              <PeopleFlowLogo className="h-6 w-auto" />
            </a>
            <p className="mt-4 max-w-[280px] text-[14px] leading-relaxed text-muted">
              {candidate ? "De encontrar una oportunidad a dar tu siguiente paso. Tu talento y tu búsqueda, en un solo lugar." : <>De la vacante publicada en la bolsa al candidato contratado en tu
              pipeline — un solo ecosistema.</>}
            </p>
            <div className="mt-5 flex gap-3">
              {["in", "X", "IG"].map((network) => candidate ? (
                <Button key={network} type="button" variant="outline" size="icon" aria-label={`${network} (próximamente)`}>{network}</Button>
              ) : (
                <span
                  key={network}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted transition hover:border-brand/50 hover:text-ink"
                >
                  {network}
                </span>
              ))}
            </div>
          </div>
          {(candidate ? CANDIDATE_FOOTER_COLUMNS : FOOTER_COLUMNS).map((column) => (
            <div key={column.heading}>
              <p className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-ink">
                {column.heading}
              </p>
              <ul className="flex flex-col gap-2.5 text-[14px] text-muted">
                {column.links.map((link) => (
                  <li key={link}>
                    <a href={candidate ? CANDIDATE_FOOTER_HREFS[link] : "#"} className={candidate ? "inline-flex min-h-10 items-center transition hover:text-ink" : "transition hover:text-ink"}>
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-line pt-6 text-[13px] text-muted sm:flex-row sm:items-center">
          <span>© 2026 PeopleFlow — Todos los derechos reservados.</span>
          <div className="flex gap-6">
            {["Privacidad", "Términos", "Cookies"].map((link) => candidate ? (
              <Button key={link} type="button" variant="link" className="min-h-10 text-muted" aria-label={`${link} (próximamente)`}>{link}</Button>
            ) : (
              <a key={link} href="#" className="transition hover:text-ink">
                {link}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Root composition (hero → sections) ──────────────────────────────────────

export function EmployerLanding({ candidate = false }: AudienceProps = {}) {
  return (
    <>
      <EmployerHero candidate={candidate} />
      <TwoSystemsSection candidate={candidate} />
      <ValuePropsSection candidate={candidate} />
      <ShowcaseSection candidate={candidate} />
      <ClosingCtaSection candidate={candidate} />
    </>
  );
}
