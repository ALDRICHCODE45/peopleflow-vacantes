// Generates the artboards (01–04) and the standalone sample emails in design/notification-emails/.
// Run from the repo root: node design/notification-emails/_src/build.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderEmail, L, D, TONES, tone, contrast, mix, F1, F2, LEGAL, FONT } from "./email.mjs";
import { TEMPLATES, ROWS, MATRIX } from "./templates.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = o => JSON.stringify(o).replace(/</g, "\\u003c");

// ---------------- artboard chrome (PeopleFlow product tokens, like design/notifications) ----------------
const CHROME_CSS = `
:root{color-scheme:light;--background:#F7F5FB;--foreground:#1A1626;--card:#FFFFFF;--muted:#F1EEF7;--muted-foreground:#6B6480;--border:#E4DFF0;--primary:oklch(0.491 0.27 292.581);--primary-foreground:oklch(0.969 0.016 293.756);--primary-text:var(--primary);--status-danger:oklch(0.45 0.2 25);--status-info:oklch(0.45 0.16 250)}
html[data-theme=dark]{color-scheme:dark;--background:#0C0912;--foreground:#F6F2FF;--card:#15121F;--muted:#171226;--muted-foreground:#A79FBF;--border:#262233;--primary:oklch(0.432 0.232 292.759);--primary-text:oklch(0.70 0.14 292.759);--status-danger:oklch(0.75 0.15 22);--status-info:oklch(0.78 0.12 245)}
*{box-sizing:border-box}
body{margin:0;background:var(--background);color:var(--foreground);font:14px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.page{width:1440px;margin:0 auto;padding:48px 64px 72px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:32px}
.kicker{margin:0 0 6px;font-size:12px;font-weight:500;color:var(--muted-foreground)}
h1.t{margin:0;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-.01em}
.lede{margin:8px 0 0;max-width:820px;color:var(--muted-foreground)}
.seg{display:inline-flex;height:36px;padding:4px;border-radius:14px;background:var(--muted);gap:2px;flex:none}
.seg button{border:0;background:transparent;color:color-mix(in oklab,var(--foreground) 70%,transparent);font:500 14px/1 inherit;font-family:inherit;padding:0 12px;border-radius:10px;cursor:pointer;min-height:28px}
.seg button[aria-pressed=true]{background:var(--background);color:var(--foreground);box-shadow:0 1px 2px rgb(0 0 0/.1)}
html[data-theme=dark] .seg button[aria-pressed=true]{background:color-mix(in oklab,var(--foreground) 10%,transparent);box-shadow:none}
button:focus-visible,a:focus-visible{outline:2px solid var(--primary-text);outline-offset:2px}
.card{background:var(--card);border-radius:24px;box-shadow:0 1px 2px rgb(0 0 0/.06);outline:1px solid color-mix(in oklab,var(--foreground) 5%,transparent)}
.trade{margin-top:24px;padding:20px 24px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px}
.trade h2{margin:0 0 6px;font-size:14px;font-weight:600}
.trade p{margin:0;color:var(--muted-foreground)}
.row{margin-top:48px}
.row>h2{margin:0 0 4px;font-size:18px;line-height:28px;font-weight:600}
.row>p{margin:0 0 16px;color:var(--muted-foreground)}
.pair{display:flex;gap:48px;align-items:flex-start}
figure{margin:0}
figcaption{font-size:12px;color:var(--muted-foreground);margin:0 0 8px;font-weight:500}
.client{width:720px;overflow:hidden;padding:0}
.inbox{display:flex;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--border)}
.av{width:32px;height:32px;border-radius:50%;background:var(--muted);display:grid;place-items:center;font:900 13px/1 "Arial Black",Arial,sans-serif;flex:none}
.av i{font:italic 400 15px/1 Georgia,serif;color:var(--primary-text)}
.in-t{min-width:0;flex:1}
.in-t b{font-weight:600}
.in-1{display:flex;justify-content:space-between;gap:12px;font-size:13px}
.in-1 span{color:var(--muted-foreground)}
.in-2{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted-foreground)}
.in-2 b{color:var(--foreground)}
.client iframe{display:block;width:720px;border:0;height:600px;background:transparent}
.phone{width:399px;border-radius:48px;padding:12px;background:#1A1626;box-shadow:0 12px 32px -16px rgb(0 0 0/.45)}
html[data-theme=dark] .phone{background:#2B2540}
.screen{border-radius:36px;overflow:hidden;background:var(--card)}
.ph-top{padding:14px 18px 10px;border-bottom:1px solid var(--border)}
.ph-top .back{font-size:13px;color:var(--primary-text);font-weight:500}
.ph-top .sub{margin:6px 0 2px;font-size:15px;line-height:20px;font-weight:600}
.ph-top .frm{font-size:12px;color:var(--muted-foreground)}
.screen iframe{display:block;width:375px;border:0;height:600px}
.spec{margin-top:64px}
.spec>h2{margin:0 0 4px;font-size:20px;line-height:28px;font-weight:600}
.spec>p{margin:0 0 20px;color:var(--muted-foreground);max-width:900px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.box{padding:20px 24px}
.box h3{margin:0 0 10px;font-size:15px;font-weight:600}
.box p,.box li{color:var(--muted-foreground);margin:0}
.box ul{margin:0;padding-left:18px}
.box li+li{margin-top:4px}
.box.wide{grid-column:span 3}
.box.two{grid-column:span 2}
table.t{width:100%;border-collapse:collapse;font-size:13px}
table.t th{text-align:left;font-weight:500;color:var(--muted-foreground);padding:8px;border-bottom:1px solid var(--border)}
table.t td{padding:8px;border-bottom:1px solid var(--border);vertical-align:top}
.sw{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:6px;box-shadow:inset 0 0 0 1px rgb(0 0 0/.15)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
code{background:var(--muted);padding:1px 5px;border-radius:6px}
pre{margin:0;background:var(--muted);padding:16px;border-radius:14px;overflow:auto;line-height:1.55;white-space:pre}
.scale div{display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border)}
.scale span{color:var(--muted-foreground);font-size:12px;white-space:nowrap}
.note{font-size:12px;color:var(--muted-foreground);margin-top:8px}
`;

const CHROME_JS = `
const DATA = JSON.parse(document.getElementById('emails').textContent);
function paint(theme){
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('.seg button').forEach(b=>b.setAttribute('aria-pressed', String(b.dataset.theme===theme)));
  document.querySelectorAll('iframe[data-mail]').forEach(f=>{
    let html = DATA[f.dataset.mail];
    if(theme==='dark') html = html.replace('<html lang="es-MX"', '<html class="pf-dark" lang="es-MX"');
    f.onload = ()=>{ const d=f.contentDocument; const a=d.querySelector('[role=article]'); f.style.height = Math.ceil(a.getBoundingClientRect().height)+'px'; };
    f.srcdoc = html;
  });
}
document.querySelectorAll('.seg button').forEach(b=>b.addEventListener('click',()=>paint(b.dataset.theme)));
paint('light');
`;

function page({ title, kicker, h1, lede, body, emails }) {
  return `<!doctype html><html lang="es-MX" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=1440"><title>${esc(title)}</title><style>${CHROME_CSS}</style></head>
<body><main class="page">
<header class="top"><div><p class="kicker">${esc(kicker)}</p><h1 class="t">${esc(h1)}</h1><p class="lede">${lede}</p></div>
<div class="seg" role="group" aria-label="Tema del cliente de correo"><button type="button" data-theme="light" aria-pressed="true">Claro</button><button type="button" data-theme="dark" aria-pressed="false">Oscuro</button></div></header>
${body}
</main>
<script type="application/json" id="emails">${json(emails || {})}</script>
<script>${CHROME_JS}</script></body></html>`;
}

// ---------------- per-direction content ----------------
const DIRS = {
  a: {
    n: "01", file: "01-membrete.html", name: "Membrete",
    lede: "La marca vive sobre el fondo de página, como un papel membretado; el aviso es una tarjeta blanca de 24 px (la tarjeta del sistema) con una fila de etiquetas que dice de qué se trata y cuán urgente es antes de leer el título. Alineado a la izquierda, como se lee un correo de trabajo.",
    pros: "La más sobria y la que mejor envejece: se parece al producto (fondo lavanda, tarjeta blanca, botón violeta de 18 px), escala a los 17 avisos sin piezas nuevas y la etiqueta da el tipo y la urgencia en una línea.",
    cons: "Es la menos memorable: sin un acento fuerte por tipo, un aviso obligatorio y uno operativo se parecen salvo por las etiquetas. En Outlook de escritorio la tarjeta pierde las esquinas redondas.",
    when: "Si el objetivo es que los correos se sientan como una extensión directa del panel y cuesten poco de mantener.",
    header: "Marca de texto vivo (22 px) sobre la página, alineada con el contenido de la tarjeta (41 px). A la derecha, el nombre de la empresa en 13 px secundario (solo correos para la empresa; se oculta en teléfono).",
    type: [["Título", "24/32 · 700", "22/30 en teléfono"], ["Cuerpo", "16/26 · 400", "16/25 en teléfono"], ["Etiquetas", "12/16 · 600", ""], ["Empresa (encabezado)", "13/18 · 400", ""], ["Pie y legal", "12/18 · 400", ""]],
    spacing: ["Página: 32 arriba, 40 abajo, 16 a los lados (teléfono 12 / 8).", "Tarjeta: 40 por lado (teléfono 28 × 24), borde 1 px, radio 24.", "Ritmo interno: etiquetas → 20 → título → 12 → cuerpo → 28 → botón.", "Pie: 24 bajo la tarjeta; línea legal 16 debajo."],
    button: "48 px de alto, radio 18, 16/600, 28 px a los lados; violeta a la izquierda en escritorio, a todo el ancho en teléfono.",
    badge: "Fila de etiquetas de 12/600, radio 8: el tipo en tinte 10 % + borde 40 % del tono; la urgencia rellena en el tono («Vencida»); «Obligatorio» en neutro.",
    urgency: "Etiqueta «Vencida» rellena en rojo de estado y la fecha del cuerpo en rojo 600. El botón sigue siendo violeta: el rojo marca el estado, no la acción.",
    footer: "Fuera de la tarjeta, a la izquierda y alineado con el texto: F1 o F2 y sus enlaces subrayados en violeta; debajo la línea legal.",
    varies: [["Operativo", "Etiqueta de familia en su tono (Postulaciones violeta, Pruebas verde, Entrega ámbar si vence pronto)", "F1"], ["Obligatorio", "Etiqueta de familia + «Obligatorio» neutra", "F2"], ["Obligatorio y urgente", "«Vencida» rellena + «Obligatorio»; fecha en rojo", "F2"], ["Candidato", "En lugar de etiquetas: monograma de la empresa (36 px, tinte violeta) y su nombre", "F1"]],
  },
  b: {
    n: "02", file: "02-encabezado-por-tipo.html", name: "Encabezado por tipo",
    lede: "Cada aviso abre con una franja teñida del tono de su tipo y un mosaico de 48 px que lo resume: «!» para una entrega, el número para un agrupado, «→» para una asignación, el monograma de la empresa para el candidato. La marca y «Obligatorio» van en la cabecera de la tarjeta; el pie vive dentro, en una franja tranquila.",
    pros: "La que más se distingue de un vistazo en la bandeja abierta: el tipo y la urgencia se leen por color, forma y palabra, el agrupado enseña el conteo y el candidato ve primero quién le escribe.",
    cons: "La más cargada y la que más depende del color de fondo (la franja teñida); necesita un mosaico y un tono por cada uno de los 17 avisos, y en modo oscuro forzado de Gmail la franja se invierte a su manera.",
    when: "Si se quiere que un aviso urgente no se confunda nunca con uno de rutina y que el correo se sienta más «producto» que carta.",
    header: "Marca de texto vivo (20 px) dentro de la tarjeta, arriba a la izquierda; «Obligatorio» en neutro a la derecha cuando aplica. Debajo, la franja del tipo.",
    type: [["Título", "24/32 · 700", "22/30 en teléfono"], ["Antetítulo (familia o empresa)", "13/20 · 600 en el tono", ""], ["Mosaico", "22/48 · 700 (monograma 16)", ""], ["Cuerpo", "16/26 · 400", "16/25 en teléfono"], ["Pie y legal", "12/18 · 400", ""]],
    spacing: ["Tarjeta: radio 24, borde 1 px; laterales 32 (teléfono 24).", "Cabecera 22 arriba y abajo.", "Franja: 28 arriba y abajo, mosaico 48 + 16 de separación, antetítulo → 6 → título.", "Cuerpo 28 → botón 24 → 32; pie 20 × 32 sobre superficie tranquila; legal 20 bajo la tarjeta."],
    button: "48 px de alto, radio 18, 16/600, violeta, a la izquierda; a todo el ancho en teléfono.",
    badge: "El tipo es el mosaico relleno del tono (texto blanco; en oscuro, texto del fondo sobre el tono claro). Urgencia: etiqueta rellena junto al antetítulo. «Obligatorio»: etiqueta neutra en la cabecera.",
    urgency: "Franja teñida de rojo al 6 % con borde al 40 %, mosaico rojo con «!», antetítulo «Entrega» en rojo y «Vencida» rellena. Es la única dirección donde la urgencia ocupa toda una franja.",
    footer: "Dentro de la tarjeta, sobre superficie tranquila (#F1EEF7) con borde superior; F1 o F2 a la izquierda. Línea legal centrada fuera de la tarjeta.",
    varies: [["Operativo", "Franja y mosaico violeta (o verde para pruebas completadas, ámbar si vence pronto); el agrupado pone el conteo en el mosaico", "F1"], ["Obligatorio", "Franja azul de estado, mosaico «→» o «+», «Obligatorio» en la cabecera", "F2"], ["Obligatorio y urgente", "Franja roja, mosaico «!», «Vencida» rellena", "F2"], ["Candidato", "Franja violeta suave, monograma de la empresa en tinte, antetítulo = nombre de la empresa", "F1"]],
  },
  c: {
    n: "03", file: "03-centrada.html", name: "Centrada",
    lede: "Sin tarjeta: el correo es una sola columna centrada sobre blanco, con una barra de 4 px del tono arriba, la marca centrada, un sello circular de 64 px con el símbolo del tipo y un título grande. Más editorial y aireada; se lee como un aviso de una marca cuidada, no como una notificación de sistema.",
    pros: "La más limpia y la más robusta en clientes difíciles: sin tarjeta ni franjas no hay bordes que se rompan en Outlook ni fondos que Gmail invierta mal, y el título de 28 px se lee muy bien en el teléfono.",
    cons: "Centrado es peor para textos de más de dos líneas (T16) y deja menos sitio para contexto; el tipo se reconoce por el sello y la barra fina, menos que en 02. La más alejada de cómo se ve el panel.",
    when: "Si se prioriza una imagen de marca pulida y la máxima compatibilidad, aceptando menos diferencia visual entre tipos.",
    header: "Barra de 4 px en el tono del tipo sobre todo el ancho de la columna; marca de texto vivo (24 px) centrada 32 px debajo.",
    type: [["Título", "28/36 · 700, centrado", "24/32 en teléfono"], ["Antetítulo (familia o empresa)", "13/20 · 600 en el tono", ""], ["Cuerpo", "17/28 · 400, centrado", "16/25 en teléfono"], ["Sello", "29/64 · 700 (monograma 22)", ""], ["Pie y legal", "12/18 · 400, centrado", ""]],
    spacing: ["Columna de 600 sobre blanco (oscuro #15121F); laterales 48–56 (teléfono 24).", "Barra → 32 → marca → 36 → sello → 16 → antetítulo → 12 → título → 12 → cuerpo → 32 → botón.", "44 → filete de 1 px → 24 → pie → 14 → legal."],
    button: "52 px de alto, radio 18, 16/600, violeta, centrado; a todo el ancho en teléfono.",
    badge: "Sello circular en tinte 10 % del tono con el símbolo en el tono; en la línea del antetítulo, «Vencida» rellena y «Obligatorio» neutra.",
    urgency: "Barra superior roja, sello rojo con «!», antetítulo «Entrega» en rojo + «Vencida» rellena + «Obligatorio», y la fecha en rojo 600.",
    footer: "Centrado bajo un filete de 1 px: F1 o F2 y enlaces; línea legal debajo.",
    varies: [["Operativo", "Barra y sello del tono (violeta, verde o ámbar); el agrupado pone el conteo en el sello", "F1"], ["Obligatorio", "Barra y sello azules de estado + «Obligatorio»", "F2"], ["Obligatorio y urgente", "Barra y sello rojos + «Vencida» + «Obligatorio»", "F2"], ["Candidato", "Sello con el monograma de la empresa; antetítulo = nombre de la empresa", "F1"]],
  },
};

function swatch(c) { return `<span class="sw" style="background:${c}"></span><code>${c}</code>`; }

function colorsTable(dir) {
  const surf = dir === "c" ? [["Fondo (columna)", L.card, D.card, "--card"]] : [["Fondo de página", L.page, D.page, "--background"], ["Tarjeta", L.card, D.card, "--card"]];
  const rows = [
    ...surf,
    ...(dir === "b" ? [["Pie (superficie tranquila)", L.quiet, D.quiet, "--muted"]] : []),
    ["Texto", L.ink, D.ink, "--foreground"],
    ["Texto secundario", L.muted, D.muted, "--muted-foreground"],
    ["Borde y filete", L.line, D.line, "--border"],
    ["Botón", L.primary, D.primary, "--primary"],
    ["Texto del botón", L.onPrimary, D.onPrimary, "--primary-foreground"],
    ["Enlace y «flow» de la marca", L.link, D.link, "--primary-text"],
    ["Urgente (vencida)", TONES.danger.L, TONES.danger.D, "--status-danger"],
    ["Vence pronto", TONES.review.L, TONES.review.D, "--status-review"],
    ["Asignación / equipo", TONES.info.L, TONES.info.D, "--status-info"],
    ["Prueba completada", TONES.success.L, TONES.success.D, "--status-success"],
  ];
  return `<table class="t"><thead><tr><th>Rol</th><th>Claro</th><th>Oscuro</th><th>Token</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td>${swatch(r[1])}</td><td>${swatch(r[2])}</td><td><code>${r[3]}</code></td></tr>`).join("")}</tbody></table><p class="note">Tintes: 10 % del tono sobre la tarjeta (etiquetas, sellos), 6 % (franja de 02), borde 40 %. Mismo cálculo que <code>Badge</code> del sistema, materializado en hex.</p>`;
}

function dirSpec(key) {
  const d = DIRS[key];
  return `<section class="spec" aria-labelledby="spec-${key}"><h2 id="spec-${key}">Sistema de correo · ${d.name}</h2>
<p>Valores para pasar a Go <code>html/template</code> con estilos en línea. Lo común a las tres direcciones (preheader, modo oscuro, Outlook, datos de la plantilla, microcopia por aprobar) está en 04.</p>
<div class="grid">
<div class="card box"><h3>Cabecera y marca</h3><p>${d.header}</p><p class="note">Sin imagen por defecto: «people» en Arial Black 900 y «flow» en Georgia cursiva violeta, como el wordmark. Si se aloja una imagen, va en PNG (no WebP: Outlook no la muestra) con <code>alt="PeopleFlow"</code>.</p></div>
<div class="card box"><h3>Preheader</h3><p>El texto oculto del inicio repite la línea de cuerpo de la plantilla (sin palabras nuevas), seguido de espaciadores para que la bandeja no muestre el resto del correo.</p><p class="note">Ej. T8: «La fecha compromiso de Supervisor de Almacén era el 24 de noviembre de 2026.»</p></div>
<div class="card box"><h3>Escala tipográfica</h3><div class="scale">${d.type.map(t => `<div><b style="font-weight:500">${t[0]}</b><span>${t[1]}${t[2] ? " · " + t[2] : ""}</span></div>`).join("")}</div><p class="note">Pila: <code>${esc(FONT)}</code></p></div>
<div class="card box two"><h3>Colores (claro / oscuro)</h3>${colorsTable(key)}</div>
<div class="card box"><h3>Espaciado</h3><ul>${d.spacing.map(s => `<li>${s}</li>`).join("")}</ul></div>
<div class="card box"><h3>Botón</h3><p>${d.button}</p><p class="note">A prueba de clientes: celda con <code>bgcolor</code> + enlace con relleno; en Outlook de escritorio, <code>v:roundrect</code> con el mismo color y alto.</p></div>
<div class="card box"><h3>Etiquetas, urgencia y obligatorio</h3><p>${d.badge}</p><p class="note" style="margin-top:8px">${d.urgency}</p></div>
<div class="card box"><h3>Pie y línea legal</h3><p>${d.footer}</p><p class="note">F1: «${esc(F1)}» · «Mis preferencias» · «Dejar de recibir este tipo de correo». F2: «${esc(F2)}» · «Mis preferencias». Legal: «${esc(LEGAL)}» (dirección por definir).</p></div>
<div class="card box wide"><h3>Qué cambia por tipo</h3><table class="t"><thead><tr><th>Tipo</th><th>Acento e identificador</th><th>Pie</th></tr></thead><tbody>${d.varies.map(v => `<tr><td>${v[0]}</td><td>${v[1]}</td><td>${v[2]}</td></tr>`).join("")}</tbody></table></div>
</div></section>`;
}

function rowsHTML(key) {
  return ROWS.map((r, i) => {
    const td = TEMPLATES[r.desktop], tp = TEMPLATES[r.phone];
    const pre = (t) => t.body.replace(/\*\*|!!/g, "");
    return `<section class="row" aria-labelledby="r${i}"><h2 id="r${i}">${esc(r.label)}</h2>
<p>Asunto: «${esc(td.subject)}»${r.phone !== r.desktop ? ` · Teléfono: «${esc(tp.subject)}»` : ""}</p>
<div class="pair">
<figure><figcaption>Escritorio · columna de 600 px</figcaption><div class="card client">
<div class="inbox"><div class="av" aria-hidden="true">p<i>f</i></div><div class="in-t"><div class="in-1"><b>PeopleFlow</b><span>${td.time}</span></div><div class="in-2"><b>${esc(td.subject)}</b> — ${esc(pre(td))}</div></div></div>
<iframe data-mail="${key}-${r.desktop}-d" title="Correo ${td.id} en escritorio: ${esc(td.subject)}" scrolling="no"></iframe></div></figure>
<figure><figcaption>Teléfono · 375 px</figcaption><div class="phone"><div class="screen">
<div class="ph-top"><div class="back">‹ Recibidos</div><div class="sub">${esc(tp.subject)}</div><div class="frm">PeopleFlow · ${tp.time}</div></div>
<iframe data-mail="${key}-${r.phone}-p" title="Correo ${tp.id} en teléfono: ${esc(tp.subject)}" scrolling="no"></iframe></div></div></figure>
</div></section>`;
  }).join("");
}

function directionPage(key) {
  const d = DIRS[key];
  const emails = {};
  for (const r of ROWS) {
    emails[`${key}-${r.desktop}-d`] = renderEmail(key, TEMPLATES[r.desktop], { preview: true });
    emails[`${key}-${r.phone}-p`] = renderEmail(key, TEMPLATES[r.phone], { preview: true });
  }
  const body = `<section class="card trade" aria-label="Compromisos"><div><h2>A favor</h2><p>${d.pros}</p></div><div><h2>En contra</h2><p>${d.cons}</p></div><div><h2>Elígela si…</h2><p>${d.when}</p></div></section>
${rowsHTML(key)}
${dirSpec(key)}`;
  return page({ title: `Correos · ${d.n} ${d.name}`, kicker: "Correos transaccionales de PeopleFlow · U1 · S1", h1: `${d.n} · ${d.name}`, lede: d.lede, body, emails });
}

// ---------------- 04 shared system ----------------
function contrastRows() {
  const pairs = [];
  const add = (label, fg, bg) => pairs.push([label, fg, bg, contrast(fg, bg)]);
  for (const th of ["L", "D"]) {
    const P = th === "L" ? L : D, n = th === "L" ? "Claro" : "Oscuro";
    add(`${n} · texto / tarjeta`, P.ink, P.card);
    add(`${n} · secundario / página (pie de 01)`, P.muted, P.page);
    add(`${n} · secundario / superficie tranquila (pie de 02)`, P.muted, P.quiet);
    add(`${n} · enlace / página`, P.link, P.page);
    add(`${n} · enlace / superficie tranquila`, P.link, P.quiet);
    add(`${n} · texto del botón / botón`, P.onPrimary, P.primary);
    for (const t of ["danger", "info", "primary", "review", "success"]) {
      const k = tone(t, th);
      add(`${n} · ${t} texto / tinte 10 %`, k.text, k.tint);
      add(`${n} · ${t} texto / franja 6 %`, k.text, k.wash);
      add(`${n} · ${t} relleno / texto`, k.onFill, k.fill);
    }
    add(`${n} · «Obligatorio» / tinte neutro`, tone("neutral", th).text, tone("neutral", th).tint);
  }
  return pairs;
}

const GO_STRUCT = `// Un solo layout por dirección; las 17 plantillas solo llenan EmailView.
type EmailView struct {
    Subject, Preheader      string // Preheader = línea de cuerpo en texto plano
    Heading                 string
    Body                    template.HTML // línea de cuerpo con <strong> en las variables
    ButtonLabel, ButtonURL  string
    Kind                    string // "operational" | "mandatory" | "candidate"
    ToneName                string // "primary" | "info" | "success" | "review" | "danger" (sufijo de las clases .pf-*)
    Tone                    Tone   // tones[ToneName]
    Eyebrow                 string // "Postulaciones", "Entrega", ... o CompanyName (candidato)
    Glyph                   string // "!", "→", "+", "✓", "…", el conteo o CompanyInitials
    Urgency                 string // "" | "Vencida" | "Vence pronto"
    CompanyName             string // contexto en correos de empresa; identidad en candidato
    CompanyInitials         string
    Mandatory               bool   // true → F2; false → F1
    PreferencesURL          string
    UnsubscribeURL          string // vacío si Mandatory
    LegalAddress            string
}

type Tone struct{ Text, Tint, Wash, Border, Fill, OnFill string } // hex, claro

var tones = map[string]Tone{
    "primary": {"${tone("primary", "L").text}", "${tone("primary", "L").tint}", "${tone("primary", "L").wash}", "${tone("primary", "L").border}", "${tone("primary", "L").fill}", "#FFFFFF"},
    "info":    {"${tone("info", "L").text}", "${tone("info", "L").tint}", "${tone("info", "L").wash}", "${tone("info", "L").border}", "${tone("info", "L").fill}", "#FFFFFF"},
    "success": {"${tone("success", "L").text}", "${tone("success", "L").tint}", "${tone("success", "L").wash}", "${tone("success", "L").border}", "${tone("success", "L").fill}", "#FFFFFF"},
    "review":  {"${tone("review", "L").text}", "${tone("review", "L").tint}", "${tone("review", "L").wash}", "${tone("review", "L").border}", "${tone("review", "L").fill}", "#FFFFFF"},
    "danger":  {"${tone("danger", "L").text}", "${tone("danger", "L").tint}", "${tone("danger", "L").wash}", "${tone("danger", "L").border}", "${tone("danger", "L").fill}", "#FFFFFF"},
}
// Los valores oscuros no van en línea: viven en el <style> como clases
// (.pf-t-danger, .pf-tint-danger, .pf-fill-danger, ...) dentro de
// @media (prefers-color-scheme: dark), [data-ogsc] y [data-ogsb].`;

const GO_LAYOUT = `{{define "layout"}}<!doctype html>
<html lang="es-MX" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
  <title>{{.Subject}}</title>
  {{template "styles"}}  {{/* bloque fijo: teléfono + modo oscuro, igual para los 17 */}}
</head>
<body class="pf-bg" style="margin:0;padding:0;background-color:#F7F5FB">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">{{.Preheader}}&#8199;&#847;…</div>
  <table role="presentation" width="100%" class="pf-bg" bgcolor="#F7F5FB" …>
    {{template "brand" .}}          {{/* wordmark de texto vivo */}}
    {{template "kind" .}}           {{/* etiquetas / franja / sello según la dirección */}}
    <h1 class="pf-ink pf-h1" style="margin:0;font-size:24px;line-height:32px;font-weight:700;color:#1A1626">{{.Heading}}</h1>
    <p class="pf-ink pf-body" style="margin:0;font-size:16px;line-height:26px;color:#1A1626">{{.Body}}</p>
    {{template "button" .}}         {{/* td bgcolor + <a> + v:roundrect para Outlook */}}
    {{if .Mandatory}}{{template "footerF2" .}}{{else}}{{template "footerF1" .}}{{end}}
    {{template "legal" .}}
  </table>
</body></html>{{end}}

{{define "kind"}}<td class="pf-tint-{{.ToneName}} pf-t-{{.ToneName}}"
  style="background-color:{{.Tone.Tint}};color:{{.Tone.Text}};border:1px solid {{.Tone.Border}};…">{{.Eyebrow}}</td>
{{if .Urgency}}<td class="pf-fill-{{.ToneName}} pf-on-{{.ToneName}}" style="background-color:{{.Tone.Fill}};color:{{.Tone.OnFill}};…">{{.Urgency}}</td>{{end}}
{{if .Mandatory}}<td class="pf-tint-neutral pf-t-neutral" …>Obligatorio</td>{{end}}{{end}}`;

function systemPage() {
  const tc = { primary: "Violeta", info: "Azul de estado", success: "Verde de estado", review: "Ámbar de estado", danger: "Rojo de estado" };
  const matrix = `<table class="t"><thead><tr><th>#</th><th>Asunto</th><th>Tipo</th><th>Tono</th><th>Símbolo (02 mosaico · 03 sello)</th><th>Antetítulo / etiqueta</th><th>Urgencia</th><th>Pie</th></tr></thead><tbody>${MATRIX.map(m => `<tr><td>${m[0]}</td><td>${esc(m[1])}</td><td>${m[2]}</td><td><span class="sw" style="background:${TONES[m[3]].L}"></span>${tc[m[3]]}</td><td><code>${esc(m[4])}</code></td><td>${esc(m[5])}</td><td>${m[6] || "—"}</td><td>${m[7]}</td></tr>`).join("")}</tbody></table>`;
  const cr = contrastRows();
  const contrastT = `<table class="t"><thead><tr><th>Par</th><th>Texto</th><th>Fondo</th><th>Contraste</th></tr></thead><tbody>${cr.map(r => `<tr><td>${r[0]}</td><td>${swatch(r[1])}</td><td>${swatch(r[2])}</td><td>${r[3].toFixed(2)} : 1${r[3] < 4.5 ? " ⚠" : ""}</td></tr>`).join("")}</tbody></table>`;
  const body = `
<div class="grid" style="margin-top:32px">
<div class="card box two"><h3>Anatomía común</h3><ol style="margin:0;padding-left:20px;color:var(--muted-foreground)">
<li><b>Preheader</b> oculto = línea de cuerpo (texto plano).</li>
<li><b>Marca</b>: «people<i>flow</i>» como texto vivo; nunca depende de una imagen.</li>
<li><b>Contexto</b>: nombre de la empresa (en correos de empresa, solo 01 lo pinta arriba; en candidato, todas lo muestran como identidad).</li>
<li><b>Identificador de tipo</b>: etiqueta (01), mosaico + franja (02) o sello + barra (03).</li>
<li><b>Urgencia</b> («Vencida», «Vence pronto») y <b>«Obligatorio»</b>: siempre con palabra, nunca solo color.</li>
<li><b>Título</b> = «Heading» de la plantilla, en <code>&lt;h1&gt;</code>.</li>
<li><b>Línea de cuerpo</b> = «Body line», con las variables en 600.</li>
<li><b>Un solo botón</b> violeta = «Button».</li>
<li><b>Pie</b> F1 (opcional, con baja) o F2 (obligatorio, sin baja).</li>
<li><b>Línea legal</b> con la dirección postal de PeopleFlow.</li></ol></div>
<div class="card box"><h3>Tres ejes, no diecisiete diseños</h3><p><b>Tipo</b> decide el pie y la marca «Obligatorio» (operativo, obligatorio, candidato). <b>Tono</b> viene de la familia del aviso, igual que en la campana (postulaciones violeta, pruebas completadas verde, asignaciones azul, entregas ámbar/rojo). <b>Urgencia</b> solo existe en entregas: ámbar «Vence pronto», rojo «Vencida».</p><p class="note">El botón siempre es violeta: el color de estado marca qué pasó, no la acción.</p></div>
<div class="card box wide"><h3>Las 17 plantillas</h3>${matrix}<p class="note">Antetítulos y etiquetas nuevos («Postulaciones», «Pruebas», «Entrega», «Asignación», «Equipo», «Vencida», «Vence pronto», «Obligatorio») son microcopia por aprobar; el resto del texto es el acordado.</p></div>
<div class="card box"><h3>Modo oscuro</h3><ul>
<li>Estilos en línea = claro (lo que ve un cliente que ignora <code>&lt;style&gt;</code>).</li>
<li><code>&lt;meta name="color-scheme" content="light dark"&gt;</code> + <code>supported-color-schemes</code>.</li>
<li>Clases <code>.pf-*</code> con los valores oscuros del sistema en <code>@media (prefers-color-scheme: dark)</code> (Apple Mail, iOS, Outlook macOS, Thunderbird).</li>
<li>Las mismas reglas con <code>[data-ogsc]</code> / <code>[data-ogsb]</code> para Outlook.com.</li>
<li>Gmail app y Outlook Windows invierten por su cuenta: colores sin blanco puro en texto sobre violeta, sin imágenes con fondo, la marca es texto, así que la inversión no rompe nada.</li></ul></div>
<div class="card box"><h3>Compatibilidad</h3><ul>
<li>Maquetación en tablas, <code>role="presentation"</code>, ancho máximo 600 con tabla fantasma <code>&lt;!--[if mso]&gt;</code>.</li>
<li>Botón: <code>v:roundrect</code> en Outlook escritorio; en el resto, enlace con relleno sobre celda con <code>bgcolor</code>.</li>
<li>Outlook escritorio no pinta radios ni <code>border-radius:50%</code>: tarjetas y sellos quedan cuadrados, el resto se conserva.</li>
<li>Sin CSS ni JS externos, sin fuentes remotas; Inter solo si está instalada.</li>
<li>Teléfono: una regla <code>@media (max-width:620px)</code> reduce márgenes, baja el título y pone el botón a todo el ancho; Gmail con cuentas no Google la ignora y ve la versión de escritorio, que ya cabe a 375 por el ancho fluido.</li></ul></div>
<div class="card box"><h3>Privacidad y datos</h3><ul>
<li>Ningún correo lleva nombre de candidato ni de integrante (L18); el mensaje de T16 no se incluye.</li>
<li>Datos nuevos que el backend debe pasar: <code>company_name</code> en todos (hoy solo T11, T15–T17), <code>company_initials</code> para candidato y el conteo como símbolo en agrupados (02 y 03).</li>
<li>Remitente propuesto: «PeopleFlow &lt;avisos@…&gt;» (dominio por definir).</li></ul></div>
<div class="card box two"><h3>Go html/template · datos</h3><pre tabindex="0" aria-label="Estructura de datos en Go">${esc(GO_STRUCT)}</pre></div>
<div class="card box"><h3>Por qué así en Go</h3><ul>
<li>Un layout por dirección + 17 definiciones de <code>EmailView</code>; ninguna plantilla repite HTML.</li>
<li><code>html/template</code> escapa los atributos <code>style</code>: pasar solo hex de la tabla <code>tones</code> (pasa el filtro CSS); nunca concatenar CSS que venga del usuario (saldría <code>ZgotmplZ</code>).</li>
<li><code>Body</code> se arma en Go con las variables escapadas dentro de <code>&lt;strong&gt;</code> y luego se marca <code>template.HTML</code>.</li>
<li>El bloque <code>&lt;style&gt;</code> es fijo y va en un <code>{{define "styles"}}</code>.</li>
<li>Muestras HTML listas para Mailpit: <code>design/notification-emails/samples/</code>.</li></ul></div>
<div class="card box wide"><h3>Go html/template · esqueleto del layout</h3><pre tabindex="0" aria-label="Esqueleto del layout en Go">${esc(GO_LAYOUT)}</pre></div>
<div class="card box two"><h3>Contraste calculado (WCAG 2.x)</h3>${contrastT}</div>
<div class="card box"><h3>Por aprobar antes de implementar</h3><ul>
<li>La dirección (01, 02 o 03).</li>
<li>Microcopia nueva: antetítulos de familia, «Vencida», «Vence pronto», «Obligatorio».</li>
<li>Dirección postal de PeopleFlow para la línea legal y dominio del remitente.</li>
<li>Si se quiere logo en imagen: exportar el wordmark a PNG @2x (256 × 64) claro; la versión oscura no se puede garantizar, por eso el texto vivo es la opción por defecto.</li>
<li>Opcional (no está en la copia acordada): enlace de respaldo bajo el botón («¿No funciona el botón? Copia este enlace»).</li></ul></div>
</div>`;
  return page({ title: "Correos · 04 Sistema de correo", kicker: "Correos transaccionales de PeopleFlow · U1 · S1", h1: "04 · Sistema de correo (común a las tres direcciones)", lede: "Reglas compartidas: anatomía, cómo se asigna tipo, tono y urgencia a las 17 plantillas, modo oscuro, compatibilidad, privacidad, cómo llevarlo a Go <code>html/template</code> y lo que falta decidir. El interruptor de tema solo afecta a esta página.", body });
}

// ---------------- write ----------------
for (const k of Object.keys(DIRS)) writeFileSync(join(OUT, DIRS[k].file), directionPage(k));
writeFileSync(join(OUT, "04-sistema-de-correo.html"), systemPage());
mkdirSync(join(OUT, "samples"), { recursive: true });
for (const k of Object.keys(DIRS)) for (const [id, t] of Object.entries(TEMPLATES)) writeFileSync(join(OUT, "samples", `${DIRS[k].n}-${id}.html`), renderEmail(k, t));
const low = contrastRows().filter(r => r[3] < 4.5);
console.log("written. contrast pairs below 4.5:", low.length ? low.map(r => `${r[0]} ${r[3].toFixed(2)}`).join("; ") : "none");
