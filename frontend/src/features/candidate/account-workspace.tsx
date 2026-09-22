import type { CandidateIdentity } from "./model";

/**
 * Props-only, server-renderable account surface for `/candidato/cuenta`. Every
 * identity and access fact derives from `identity`; the surface owns no fixture,
 * network, persistence, navigation, form, timer or callback, and CDP-09B supplies
 * the frozen fictional identity at the route boundary.
 */
export type AccountWorkspaceProps = Readonly<{ identity: CandidateIdentity }>;

/** Exact local disclosure: fictional identity, no real session/provider/credential/verification, nothing migrates. */
const DISCLOSURE = "Demo local con una identidad ficticia: esta vista no tiene una sesión autenticada real, ni proveedor, ni credenciales, ni estado de verificación. Nada se puede cambiar, guardar ni enviar desde aquí.";
/** Exact shared explanation for the three unavailable credential and session actions. */
const ACTIONS_NOTE = "Esta demo local no puede cambiar el correo ni la contraseña ni cerrar sesión porque no hay autenticación conectada.";
const ACTIONS_NOTE_ID = "pf-account-actions-note";
const IDENTITY_HEADING_ID = "pf-account-identity-heading";
const ACCESS_HEADING_ID = "pf-account-access-heading";

/** Spanish account type for the closed candidate identity role. */
const ACCOUNT_TYPES: Readonly<Record<CandidateIdentity["userType"], string>> = Object.freeze({ candidate: "Candidata" });
/** The account scope is always the local demo, never a remote account. */
const LOCAL_SCOPE = "Demo local";
/** Truthful unavailable values for the access and security facts. */
const NO_SESSION = "No disponibles en esta demo";
const UNAVAILABLE = "No disponible";
/** Access facts in exact order: session, provider and email verification only. */
const ACCESS_FACTS: readonly (readonly [string, string])[] = [
  ["Autenticación y sesión", NO_SESSION],
  ["Proveedor", UNAVAILABLE],
  ["Verificación de correo", UNAVAILABLE],
];
/** The three credential and session actions that stay visibly unavailable. */
const ACTIONS: readonly string[] = ["Cambiar correo (no disponible)", "Cambiar contraseña (no disponible)", "Cerrar sesión (no disponible)"];

/** Class-only paint shared by the three disabled actions: at least a 40px target. */
const ACTION = "inline-flex min-h-10 items-center justify-center rounded-md border border-input px-4 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60";
/** Responsive fact layout: one column on small screens, two columns from `sm` up. */
const FACTS = "grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2";
const SECTION = "flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card/40 p-4";
const CELL = "min-w-0";
const TERM = "text-[12.5px] text-muted-foreground";
const VALUE = "break-words text-foreground";

/** Static read-only account surface over the passed identity. */
export function AccountWorkspace({ identity }: AccountWorkspaceProps) {
  return (
    <div data-pf-account-workspace className="flex flex-col gap-5 px-4 py-4 lg:px-6">
      <p role="note" data-pf-account-disclosure className="max-w-3xl text-sm text-muted-foreground">{DISCLOSURE}</p>
      <section data-pf-account-identity aria-labelledby={IDENTITY_HEADING_ID} className={SECTION}>
        <h2 id={IDENTITY_HEADING_ID} className="font-heading text-xl font-semibold text-foreground">Datos de identidad</h2>
        <dl className={FACTS}>
          <div className={CELL}>
            <dt className={TERM}>Nombre completo</dt>
            <dd className={VALUE}>{identity.fullName}</dd>
          </div>
          <div className={CELL}>
            <dt className={TERM}>Correo electrónico</dt>
            <dd data-pf-account-email className="break-all text-foreground">{identity.email}</dd>
          </div>
          <div className={CELL}>
            <dt className={TERM}>Tipo de cuenta</dt>
            <dd className={VALUE}>{ACCOUNT_TYPES[identity.userType]}</dd>
          </div>
          <div className={CELL}>
            <dt className={TERM}>Alcance</dt>
            <dd className={VALUE}>{LOCAL_SCOPE}</dd>
          </div>
        </dl>
      </section>
      <section data-pf-account-access aria-labelledby={ACCESS_HEADING_ID} className={SECTION}>
        <h2 id={ACCESS_HEADING_ID} className="font-heading text-xl font-semibold text-foreground">Acceso y seguridad</h2>
        <dl className={FACTS}>
          {ACCESS_FACTS.map(([term, value]) => (
            <div key={term} className={CELL}>
              <dt className={TERM}>{term}</dt>
              <dd className={VALUE}>{value}</dd>
            </div>
          ))}
        </dl>
        <div data-pf-account-actions className="flex flex-wrap gap-2">
          {ACTIONS.map((label) => (
            <button key={label} type="button" disabled aria-describedby={ACTIONS_NOTE_ID} className={ACTION}>{label}</button>
          ))}
        </div>
        <p id={ACTIONS_NOTE_ID} data-pf-account-actions-note className="max-w-3xl text-sm text-muted-foreground">{ACTIONS_NOTE}</p>
      </section>
    </div>
  );
}
