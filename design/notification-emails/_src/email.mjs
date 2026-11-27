// PeopleFlow transactional email renderer (design source for design/notification-emails).
// Produces real email HTML: tables, inline styles, one <style> block for dark mode and phones.
// The backend ports this to Go html/template (see 04-sistema-de-correo.html).

export const FONT = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const WM_SANS = "'Arial Black','Helvetica Neue',Arial,Helvetica,sans-serif";
const WM_SERIF = "Georgia,'Times New Roman',Times,serif";

// Tokens from design/system.md (oklch converted to sRGB hex; hex tokens copied as authored).
export const L = { page: "#F7F5FB", card: "#FFFFFF", ink: "#1A1626", muted: "#6B6480", line: "#E4DFF0", quiet: "#F1EEF7", primary: "#7008E7", onPrimary: "#F5F3FF", link: "#7008E7" };
export const D = { page: "#0C0912", card: "#15121F", ink: "#F6F2FF", muted: "#A79FBF", line: "#262233", quiet: "#171226", primary: "#5D0EC0", onPrimary: "#F5F3FF", link: "#A28CED" };
export const TONES = {
  primary: { L: "#7008E7", D: "#A28CED", token: "--primary / --primary-text" },
  info: { L: "#0055A9", D: "#71BFFF", token: "--status-info" },
  success: { L: "#006B30", D: "#63D18F", token: "--status-success" },
  review: { L: "#844C00", D: "#EFBA64", token: "--status-review" },
  danger: { L: "#A9000C", D: "#FF8482", token: "--status-danger" },
  neutral: { L: "#6B6480", D: "#A79FBF", token: "--muted-foreground" },
};

const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export const mix = (a, b, p) => "#" + rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, "0")).join("").toUpperCase();
const lum = h => { const [r, g, b] = rgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

export function tone(name, theme, surface) {
  const base = TONES[name][theme];
  const card = surface ?? (theme === "L" ? L.card : D.card);
  return {
    text: base,
    tint: mix(base, card, 0.1),
    wash: mix(base, card, 0.06),
    border: mix(base, card, 0.4),
    fill: base,
    onFill: theme === "L" ? "#FFFFFF" : D.card,
  };
}

// ---------- dark-mode stylesheet (prefers-color-scheme, Outlook.com data-ogsc/ogsb, preview class) ----------
function darkMap(dir) {
  const m = [];
  const bg = (c, v) => m.push([c, "background-color:" + v, "b"]);
  const fg = (c, v) => m.push([c, "color:" + v, "c"]);
  const bd = (c, v) => m.push([c, "border-color:" + v, "c"]);
  bg("pf-bg", D.page); bg("pf-card", D.card); bg("pf-quiet", D.quiet);
  fg("pf-ink", D.ink); fg("pf-muted", D.muted); fg("pf-link", D.link); bd("pf-line", D.line);
  bg("pf-btn", D.primary); fg("pf-btn-t", D.onPrimary); bd("pf-btn", D.primary);
  fg("pf-wm-p", D.ink); fg("pf-wm-f", D.link);
  for (const t of Object.keys(TONES)) {
    const k = tone(t, "D", dir === "c" ? D.card : D.card);
    fg(`pf-t-${t}`, k.text); bg(`pf-tint-${t}`, k.tint); bg(`pf-wash-${t}`, k.wash); bd(`pf-bd-${t}`, k.border);
    bg(`pf-fill-${t}`, k.fill); fg(`pf-on-${t}`, k.onFill);
  }
  return m;
}

function styleBlock(dir, preview) {
  const m = darkMap(dir);
  const rule = (sel, d) => `${sel}{${d} !important}`;
  const media = m.map(([c, d]) => rule("." + c, d)).join("");
  const ogsc = m.filter(r => r[2] === "c").map(([c, d]) => rule("[data-ogsc] ." + c, d)).join("");
  const ogsb = m.filter(r => r[2] === "b").map(([c, d]) => rule("[data-ogsb] ." + c, d)).join("");
  const prev = preview ? "\n/* solo vista previa del canvas: simula el modo oscuro del cliente */\n" + m.map(([c, d]) => rule("html.pf-dark ." + c, d)).join("") : "";
  return `<style>
:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{border-spacing:0;mso-table-lspace:0pt;mso-table-rspace:0pt}
a{text-decoration-thickness:1px;text-underline-offset:2px}
.pf-btn-a:hover{opacity:.9}
@media (max-width:620px){
.pf-wrap{padding:12px 8px 28px!important}
.pf-pad{padding-left:24px!important;padding-right:24px!important}
.pf-padv{padding-top:28px!important;padding-bottom:28px!important}
.pf-side{padding-left:16px!important;padding-right:16px!important}
.pf-h1{font-size:22px!important;line-height:30px!important}
.pf-h1c{font-size:24px!important;line-height:32px!important}
.pf-body{font-size:16px!important;line-height:25px!important}
.pf-full{width:100%!important}
.pf-btn-a{display:block!important;text-align:center!important}
.pf-hide-sm{display:none!important;max-height:0!important;overflow:hidden!important}
}
@media (prefers-color-scheme:dark){${media}}
${ogsc}${ogsb}${prev}
</style>`;
}

// ---------- building blocks ----------
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plain = s => s.replace(/\*\*|!!/g, "");
const spacer = (h) => `<tr><td height="${h}" style="height:${h}px;font-size:0;line-height:0">&nbsp;</td></tr>`;

function richBody(t) {
  const urg = t.tone;
  return esc(t.body)
    .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600">$1</strong>')
    .replace(/!!(.+?)!!/g, `<strong class="pf-t-${urg}" style="font-weight:600;color:${TONES[urg].L}">$1</strong>`);
}

export function wordmark(size = 22, align = "left") {
  return `<a href="https://app.peopleflow.mx" style="text-decoration:none;display:inline-block" aria-label="PeopleFlow"><span class="pf-wm-p" style="font-family:${WM_SANS};font-weight:900;font-size:${size}px;line-height:${size + 6}px;letter-spacing:-0.04em;color:${L.ink}">people</span><span class="pf-wm-f" style="font-family:${WM_SERIF};font-style:italic;font-weight:400;font-size:${Math.round(size * 1.12)}px;line-height:${size + 6}px;letter-spacing:-0.02em;color:${L.primary}">flow</span></a>`;
}

export function pill(text, tn, { fill = false } = {}) {
  const k = tone(tn, "L");
  const cls = fill ? `pf-fill-${tn} pf-on-${tn} pf-bd-${tn}` : `pf-tint-${tn} pf-bd-${tn} pf-t-${tn}`;
  const bg = fill ? k.fill : k.tint, fg = fill ? k.onFill : k.text, bd = fill ? k.fill : k.border;
  return `<td class="${cls}" bgcolor="${bg}" style="padding:3px 9px;border:1px solid ${bd};border-radius:8px;background-color:${bg};color:${fg};font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;white-space:nowrap">${esc(text)}</td>`;
}
export function pillRow(pills, align = "left") {
  if (!pills.length) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="${align === "center" ? "margin:0 auto" : ""}"><tr>${pills.join('<td width="8" style="width:8px;font-size:0;line-height:0">&nbsp;</td>')}</tr></table>`;
}

export function button(label, url, { align = "left", height = 48 } = {}) {
  const w = Math.round(label.length * 9.2 + 64);
  const pv = Math.round((height - 20) / 2);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" class="pf-full" style="border-collapse:separate;${align === "center" ? "margin:0 auto" : ""}"><tr><td align="center" bgcolor="${L.primary}" class="pf-btn" style="border-radius:18px;background-color:${L.primary}">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(url)}" style="height:${height}px;v-text-anchor:middle;width:${w}px" arcsize="38%" stroke="f" fillcolor="${L.primary}"><w:anchorlock/><center style="color:${L.onPrimary};font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600">${esc(label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${esc(url)}" class="pf-btn pf-btn-t pf-btn-a" style="display:inline-block;padding:${pv}px 28px;border:1px solid ${L.primary};border-radius:18px;background-color:${L.primary};color:${L.onPrimary};font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;text-decoration:none;mso-hide:all">${esc(label)}</a><!--<![endif]-->
</td></tr></table>`;
}

export const F1 = "Recibes este correo porque este aviso está activado en tus preferencias.";
export const F2 = "Este aviso es obligatorio y no se puede desactivar.";
export const LEGAL = "PeopleFlow · [Dirección postal de PeopleFlow]";

function link(text, url) {
  return `<a href="${esc(url)}" class="pf-link" style="color:${L.link};text-decoration:underline">${esc(text)}</a>`;
}
export function footerBlock(t, { align = "left" } = {}) {
  const pref = link("Mis preferencias", t.audience === "candidate" ? "https://app.peopleflow.mx/candidato/configuracion/notificaciones" : "https://app.peopleflow.mx/empresa/configuracion/notificaciones");
  const unsub = link("Dejar de recibir este tipo de correo", "https://app.peopleflow.mx/notificaciones/baja?token=…");
  const p = (inner, mt = 0) => `<p class="pf-muted" style="margin:${mt}px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${L.muted};text-align:${align}">${inner}</p>`;
  return (t.footer === "F2" ? p(esc(F2)) + p(pref, 6) : p(esc(F1)) + p(`${pref}&nbsp;&nbsp;·&nbsp;&nbsp;${unsub}`, 6));
}
export const legalLine = (align = "left") => `<p class="pf-muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${L.muted};text-align:${align}">${esc(LEGAL)}</p>`;

function h1(t, { size = 24, lh = 32, align = "left", cls = "pf-h1" } = {}) {
  return `<h1 class="pf-ink ${cls}" style="margin:0;font-family:${FONT};font-size:${size}px;line-height:${lh}px;font-weight:700;letter-spacing:-0.01em;color:${L.ink};text-align:${align}">${esc(t.heading)}</h1>`;
}
function bodyP(t, { size = 16, lh = 26, align = "left" } = {}) {
  return `<p class="pf-ink pf-body" style="margin:0;font-family:${FONT};font-size:${size}px;line-height:${lh}px;color:${L.ink};text-align:${align}">${richBody(t)}</p>`;
}
function tile(t, size, { radius = 14, round = false, tint = false } = {}) {
  const k = tone(t.tone, "L");
  const isCo = t.audience === "candidate";
  const glyph = isCo ? t.initials : t.glyph;
  const soft = tint || isCo;
  const bg = soft ? k.tint : k.fill, fg = soft ? k.text : k.onFill;
  const cls = soft ? `pf-tint-${t.tone} pf-t-${t.tone}` : `pf-fill-${t.tone} pf-on-${t.tone}`;
  const fs = isCo ? Math.round(size * 0.34) : Math.round(size * 0.46);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${round ? 'align="center" style="margin:0 auto"' : ""}><tr><td width="${size}" height="${size}" align="center" valign="middle" class="${cls}" bgcolor="${bg}" style="width:${size}px;height:${size}px;border-radius:${round ? "50%" : radius + "px"};background-color:${bg};color:${fg};font-family:${FONT};font-size:${fs}px;line-height:${size}px;font-weight:700;text-align:center" aria-hidden="true">${esc(glyph)}</td></tr></table>`;
}

function badges(t) {
  const out = [];
  if (t.urgency) out.push(pill(t.urgency, t.tone, { fill: true }));
  if (t.kind === "mandatory") out.push(pill("Obligatorio", "neutral"));
  return out;
}

// ---------- directions ----------
function frame(inner, bgCls, bg, { maxW = 600 } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="${bgCls}" bgcolor="${bg}" style="width:100%;background-color:${bg}"><tr><td align="center" class="pf-wrap" style="padding:32px 16px 40px">
<!--[if mso]><table role="presentation" width="${maxW}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${maxW}px">${inner}</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>`;
}

// A · Membrete: wordmark on the page, white card, badges row, left-aligned, footer on the page.
function dirA(t) {
  const k = tone(t.tone, "L");
  const head = `<tr><td class="pf-side" style="padding:0 41px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle">${wordmark(22)}</td>
<td valign="middle" align="right" class="pf-muted pf-hide-sm" style="font-family:${FONT};font-size:13px;line-height:18px;color:${L.muted}">${t.audience === "member" ? esc(t.company) : ""}</td></tr></table></td></tr>`;
  const eyebrow = t.audience === "candidate"
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td>${tile(t, 36, { radius: 10 })}</td><td style="padding-left:12px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:600;color:${L.ink}" class="pf-ink">${esc(t.company)}</td></tr></table>`
    : pillRow([pill(t.eyebrow, t.tone), ...badges(t)]);
  const card = `<tr><td class="pf-card pf-line" bgcolor="${L.card}" style="background-color:${L.card};border:1px solid ${L.line};border-radius:24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pf-pad pf-padv" style="padding:40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td>${eyebrow}</td></tr>${spacer(20)}
<tr><td>${h1(t)}</td></tr>${spacer(12)}
<tr><td>${bodyP(t)}</td></tr>${spacer(28)}
<tr><td>${button(t.button, t.url)}</td></tr>
</table></td></tr></table></td></tr>`;
  const foot = `<tr><td class="pf-side" style="padding:24px 41px 0">${footerBlock(t)}</td></tr>
<tr><td class="pf-side" style="padding:16px 41px 0">${legalLine()}</td></tr>`;
  return frame(head + card + foot, "pf-bg", L.page);
}

// B · Encabezado por tipo: card with wordmark row, tinted header block with a tile per kind, footer strip inside the card.
function dirB(t) {
  const k = tone(t.tone, "L");
  const marker = t.kind === "mandatory" ? pillRow([pill("Obligatorio", "neutral")], "right") : "";
  const top = `<tr><td class="pf-pad" style="padding:22px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${wordmark(20)}</td><td valign="middle" align="right">${marker}</td></tr></table></td></tr>`;
  const eyebrowLine = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="pf-t-${t.tone}" style="font-family:${FONT};font-size:13px;line-height:20px;font-weight:600;color:${k.text};white-space:nowrap">${esc(t.audience === "candidate" ? t.company : t.eyebrow)}</td>${t.urgency ? `<td width="8" style="width:8px;font-size:0">&nbsp;</td>${pill(t.urgency, t.tone, { fill: true })}` : ""}</tr></table>`;
  const hero = `<tr><td class="pf-wash-${t.tone} pf-pad" bgcolor="${k.wash}" style="background-color:${k.wash};padding:28px 32px;border-top:1px solid ${k.border};border-bottom:1px solid ${k.border}" >
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="48" valign="top" style="width:48px;padding-top:2px">${tile(t, 48)}</td>
<td valign="top" style="padding-left:16px">${eyebrowLine}<div style="height:6px;line-height:6px;font-size:0">&nbsp;</div>${h1(t)}</td>
</tr></table></td></tr>`;
  // class on hero td must also carry the border tint in dark
  const heroFixed = hero.replace(`class="pf-wash-${t.tone} pf-pad"`, `class="pf-wash-${t.tone} pf-bd-${t.tone} pf-pad"`);
  const main = `<tr><td class="pf-pad" style="padding:28px 32px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td>${bodyP(t)}</td></tr>${spacer(24)}<tr><td>${button(t.button, t.url)}</td></tr></table></td></tr>`;
  const foot = `<tr><td class="pf-quiet pf-line pf-pad" bgcolor="${L.quiet}" style="background-color:${L.quiet};border-top:1px solid ${L.line};border-radius:0 0 23px 23px;padding:20px 32px">${footerBlock(t)}</td></tr>`;
  const card = `<tr><td class="pf-card pf-line" bgcolor="${L.card}" style="background-color:${L.card};border:1px solid ${L.line};border-radius:24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${top}${heroFixed}${main}${foot}</table></td></tr>`;
  const legal = `<tr><td class="pf-side" style="padding:20px 32px 0">${legalLine("center")}</td></tr>`;
  return frame(card + legal, "pf-bg", L.page);
}

// C · Centrada: no card, white canvas, tone bar on top, centered wordmark, seal, heading, button, centered footer.
function dirC(t) {
  const k = tone(t.tone, "L");
  const bar = `<tr><td height="4" class="pf-fill-${t.tone}" bgcolor="${k.fill}" style="height:4px;background-color:${k.fill};border-radius:4px;font-size:0;line-height:0">&nbsp;</td></tr>`;
  const wm = `<tr><td align="center" style="padding:32px 0 0">${wordmark(24)}</td></tr>`;
  const seal = `<tr><td align="center" style="padding:36px 0 0">${tile(t, 64, { round: true, tint: true })}</td></tr>`;
  const eyebrowCells = [];
  eyebrowCells.push(`<td class="pf-t-${t.tone}" style="font-family:${FONT};font-size:13px;line-height:20px;font-weight:600;color:${k.text};white-space:nowrap">${esc(t.audience === "candidate" ? t.company : t.eyebrow)}</td>`);
  for (const b of badges(t)) eyebrowCells.push(b);
  const eyebrow = `<tr><td align="center" style="padding:16px 0 0">${pillRow(eyebrowCells, "center")}</td></tr>`;
  const head = `<tr><td align="center" class="pf-pad" style="padding:12px 48px 0">${h1(t, { size: 28, lh: 36, align: "center", cls: "pf-h1c" })}</td></tr>`;
  const body = `<tr><td align="center" class="pf-pad" style="padding:12px 56px 0">${bodyP(t, { size: 17, lh: 28, align: "center" })}</td></tr>`;
  const btn = `<tr><td align="center" class="pf-pad" style="padding:32px 48px 0">${button(t.button, t.url, { align: "center", height: 52 })}</td></tr>`;
  const rule = `<tr><td class="pf-pad" style="padding:44px 48px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pf-line" style="border-top:1px solid ${L.line};font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table></td></tr>`;
  const foot = `<tr><td class="pf-pad" style="padding:24px 48px 0">${footerBlock(t, { align: "center" })}</td></tr><tr><td class="pf-pad" style="padding:14px 48px 8px">${legalLine("center")}</td></tr>`;
  return frame(bar + wm + seal + eyebrow + head + body + btn + rule + foot, "pf-card", L.card);
}

export const DIRECTIONS = { a: dirA, b: dirB, c: dirC };

export function renderEmail(dir, t, { preview = false } = {}) {
  const pre = plain(t.body);
  const pad = "&#8199;&#847;".repeat(70);
  const bg = dir === "c" ? L.card : L.page;
  const bgCls = dir === "c" ? "pf-card" : "pf-bg";
  return `<!doctype html>
<html lang="es-MX" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(t.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
${styleBlock(dir, preview)}
</head>
<body class="${bgCls}" style="margin:0;padding:0;background-color:${bg}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${bg}">${esc(pre)}${pad}</div>
<div role="article" aria-roledescription="email" aria-label="${esc(t.subject)}" lang="es-MX">
${DIRECTIONS[dir](t)}
</div>
</body>
</html>`;
}

export { plain };
