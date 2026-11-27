// Builds the three self-contained artboards of design/embedded-auth from style.css + ui.js.
// Usage (from the repo root): node design/embedded-auth/_src/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const out = new URL('../', import.meta.url);
const css = readFileSync(new URL('style.css', here), 'utf8');
const js = readFileSync(new URL('ui.js', here), 'utf8');

export const DIRS = [
  {
    id: 'd1', file: '01-panel-dividido.html', title: '01 · Panel dividido',
    lead: 'Evoluciona el login actual: el panel FloatingLines a la izquierda (violeta para empresas, cian para candidatos) y el formulario a la derecha en todos los pasos. Cada flujo es una pantalla aparte; los pasos del registro se leen en el eyebrow («Registro de empresa · Paso 1 de 3»). Proveedores debajo del formulario, como hoy.',
    trade: 'La más barata y continua: reutiliza LoginScreen, su panel, sus acentos por audiencia y su copia, y quien ya entró la reconoce. A cambio, la mitad del escritorio es decoración también en el código y en la contraseña, el avance del registro solo se dice con texto y, en el teléfono, el panel desaparece y queda un formulario sin marca más que el logotipo.',
    socialFirst: false, socialCompact: false, audSeg: false, eyebrow: true,
    notes: [
      'Mismo esqueleto que <code>LoginScreen.tsx</code>: panel <code>aria-hidden</code> oculto por debajo de <code>lg</code>, columna de 400 px, alternar tema arriba a la derecha.',
      'La otra audiencia sigue siendo un enlace «¿Eres candidato? Ingresa aquí» que cambia de ruta y de acento.',
      'En claro, el logotipo del panel se pinta oscuro: el blanco actual queda casi invisible sobre <code>#F7F5FB</code> (revisar en producto).'
    ]
  },
  {
    id: 'd2', file: '02-tarjeta-centrada.html', title: '02 · Tarjeta centrada',
    lead: 'Una tarjeta de 456 px sobre el fondo con brillo y retícula de puntos del acento. Un selector Empresa · Candidato dentro de la tarjeta reemplaza el eyebrow y el enlace a la otra audiencia; los proveedores van primero y el correo después. Los flujos de varios pasos llevan una barra «Paso 1 de 3 · Sigue: …».',
    trade: 'La más ligera y la que mejor se repite en cualquier flujo (código, contraseña y la futura MFA caben en la misma tarjeta); en el teléfono la tarjeta se vuelve la pantalla sin cambiar nada. El selector deja claro de qué lado entras y los proveedores primero aceleran a quien usa Google. A cambio, se pierde el panel FloatingLines (la marca queda en el brillo), el selector puede leerse como un dato del formulario y, con los tres proveedores de empresa, el correo baja casi 180 px.',
    socialFirst: true, socialCompact: false, audSeg: true, eyebrow: false,
    notes: [
      'El selector es navegación (<code>nav</code> con dos enlaces y <code>aria-current="page"</code>): cada lado es su ruta (/empresa/login, /candidato/login), no un campo.',
      'Solo aparece en Ingresar y Crear cuenta; código, contraseña y «Tu empresa» ya saben quién eres.',
      'Con los flags apagados la tarjeta empieza directo en el correo, sin separador.'
    ]
  },
  {
    id: 'd3', file: '03-recorrido-guiado.html', title: '03 · Recorrido guiado',
    lead: 'Formulario a la izquierda y, a la derecha, un panel claro «Tu recorrido» con los pasos del flujo en curso (registro de empresa: Tu cuenta → Verifica tu correo → Tu empresa; contraseña: Tu correo → Código y nueva contraseña → Listo). Al ingresar, el panel adelanta los pasos del registro. En el teléfono, «Paso 2 de 3» con barra y los pasos plegados. Proveedores en una fila compacta.',
    trade: 'La que mejor explica los flujos de varios pasos y prepara a la empresa: sabe desde el inicio que después viene «Tu empresa» y que publicar depende de la verificación. En Ingresar, el panel vende el registro sin estorbar. A cambio, es la más cara (un componente de pasos nuevo y contenido por flujo), el panel ocupa espacio también en pantallas de un paso y cambia la imagen del login actual (sin FloatingLines).',
    socialFirst: false, socialCompact: true, audSeg: false, eyebrow: true,
    notes: [
      'Los pasos son una lista ordenada; el actual lleva <code>aria-current="step"</code> y cada paso dice su estado en texto («Paso 2, Ahora: …»), no solo con el color del círculo.',
      'Los botones compactos muestran solo el nombre del proveedor; su nombre accesible completo es «Continuar con Google» (incluye la etiqueta visible).',
      'El panel es claro (tinte del acento al 6 %), no la superficie oscura: es un formulario y la regla «Superficie oscura» lo excluye.'
    ]
  }
];

for (const d of DIRS) {
  const { file, ...dir } = d;
  const html = `<!doctype html><html lang="es-MX" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Embedded auth · ${d.title}</title><style>
${css}</style></head><body><script>
const DIR=${JSON.stringify(dir)};
${js}</script></body></html>
`;
  writeFileSync(new URL(file, out), html);
  console.log('wrote', file, html.length);
}
