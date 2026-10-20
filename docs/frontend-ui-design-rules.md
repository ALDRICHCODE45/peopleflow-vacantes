# Reglas de diseño de UI frontend — Proyecto 04

Reglas durables para construir interfaces en `frontend/`. El objetivo es una UI
consistente, accesible y barata de mantener: **shadcn primero, markup propio casi nunca**.

Documentos relacionados:

- `docs/decision-frontend-hosting.md` — hosting del frontend Next.js (Amplify)
- `docs/arquitectura-backend-proyecto-04.md` — backend Go (monolito modular)

---

## 1. Principio rector

Antes de escribir UI custom, inventariar lo que ya existe:

1. Listar los primitives instalados en `frontend/src/components/ui`.
2. Consultar el registry de shadcn con las herramientas MCP configuradas, en modo
   **solo lectura** (listar, buscar y ver ítems), para saber si el primitivo o una
   variante ya resuelve el caso. Si hace falta la CLI, solo se permite la versión
   fijada por el proyecto (`pnpm exec shadcn`); nunca `pnpm dlx ...@latest`.
3. Recién entonces, si no existe, componer una superficie de producto a partir de
   primitives shadcn.

Nunca se crea un componente de UI propio para un patrón que shadcn ya cubre.

**Instalación de dependencias/componentes.** Agregar un paquete o un ítem del registry
**no es automático**. Requiere autorización humana normal y la revisión del
paquete/registro por parte de una persona. La consulta es solo lectura; la instalación
(`pnpm add`, `shadcn add`, etc.) espera esa aprobación explícita. Nunca se instala ni se
actualiza nada por iniciativa del agente.

## 2. Jerarquía de decisión

En este orden estricto:

1. **Usar el primitivo instalado tal cual**, con su jerarquía nativa y sus variantes
   (`variant`, `size`, `data-*`). Ejemplos: `<TabsList variant="line">`,
   `<Badge variant="secondary">`, `<Button variant="outline">`.
2. **Componer superficie de producto** uniendo primitives y sub-componentes
   (`Card` + `CardHeader` + `CardContent`, `Empty` + `EmptyTitle` + `EmptyContent`).
3. **Extender un primitive compartido** solo cuando el cambio es transversal a todo
   el producto y no se puede resolver por composición. Es el único caso que justifica
   tocar `frontend/src/components/ui/*`. Ejemplo vigente: subir el token de contraste
   del tab inactivo en `tabs.tsx` (CPR-19).
4. **Markup propio mínimo** solo para layout de producto, densidad o accesibilidad
   (grillas, ancho de lectura, nombres accesibles, scroll de rieles y targets según la
   regla siguiente).

### Tamaño de targets

- Los controles y acciones **independientes** (botones, inputs, selects) apuntan a un
  alto ≥ 40px.
- Los controles **compuestos y compactos**, como los `TabsTrigger` del primitive nativo
  instalado (~32px / `h-8`), pueden conservar su variante instalada mientras el teclado,
  el foco, el nombre accesible y el espaciado sigan intactos.
- No se sobreescribe la pintura, el padding ni el layout nativo del trigger solo para
  alcanzar 40px.

## 3. Tokens semánticos, no color crudo

Estas reglas aplican al **código de producto/vista**: `frontend/src/features/**`,
`frontend/src/app/**` y componentes de producto bajo `frontend/src/components/**`.

- Usar tokens: `bg-background`, `bg-card`, `bg-muted`, `text-foreground`,
  `text-muted-foreground`, `border-border`, `ring-ring`, `bg-primary`, `text-primary`.
- Prohibido color crudo en código de producto: `#hex`, `rgb()/rgba()`, `hsl()`,
  `oklch()`, `color-mix()`, y utilidades tipo `bg-blue-500`.
- Prohibido `dark:` manual para color en código de producto; los tokens ya resuelven
  ambos temas.
- Sin estilos inline para pintar superficies de producto.
- Espaciado con `gap-*` y `flex`, nunca `space-x-*`/`space-y-*` en código de producto.
- Dimensiones iguales con `size-*` (`size-10`, no `w-10 h-10`).

**Excepciones.** Quedan fuera de estas prohibiciones:

- Las definiciones centrales de tokens (variables CSS del tema, por ejemplo el bloque
  `@theme inline` o las variables del CSS global/módulo de tema).
- Los primitives instalados/compartidos en `frontend/src/components/ui/*` cuando su
  implementación nativa necesita esas clases (por ejemplo `dark:` o valores de color
  propios del primitive). Se preserva el código tal como lo entrega shadcn.

## 4. Cuándo extender un primitive compartido

Solo si se cumplen **todas**:

- El cambio beneficia a todo el producto, no a una sola pantalla.
- No se puede lograr con variantes, composición ni `className` de layout.
- Se acompaña de test del primitive compartido y verificación de contraste/accesibilidad.

Un cambio de una sola vista jamás se resuelve editando el primitive compartido.

## 5. No inventar a mano

Prohibido recrear con `div`/`span`/`button`/`hr`/`input` lo que ya existe como primitive.
Para cada patrón, **usar el primitive shadcn correspondiente cuando esté instalado o
tras una instalación aprobada**; si todavía no está instalado, se consulta el registry
(solo lectura) y se sigue el flujo de autorización de la sección 1. Nunca se implementa
a mano. Ojo: el "debería usarse" no implica "está instalado"; el inventario vigente está
en la sección 7.

- Cards y superficies → `Card` + `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`.
- Avatares → `Avatar` + `AvatarImage` + `AvatarFallback` (el fallback es obligatorio).
- Tabs → `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent`.
- Diálogos/paneles → `Dialog` (modal, instalado), `Sheet` (lateral, instalado),
  `Drawer` (inferior, instalado).
- Estados vacíos → `Empty` + `EmptyHeader`/`EmptyTitle`/`EmptyDescription`/`EmptyContent`.
- Menús → `DropdownMenu` (con sus grupos).
- Tablas → `Table`.
- Controles de formulario → `Field` + `FieldGroup`, `Input`, `Textarea`, `Select`,
  `Checkbox`, `ToggleGroup`, `InputGroup`.
- Separadores → `Separator` (no `<hr>`).
- Carga → `Skeleton`, `Progress` y `Spinner` oficiales de shadcn (instalados; criterios en sección 11).
- Notificaciones transitorias → **Sileo**, excepción aprobada a shadcn-first; un único `AppToaster` global.
- Estados/etiquetas → `Badge` (no `span` con color propio).
- Tooltips/info → `Tooltip`/`Popover` (instalados); `HoverCard` (**hoy no instalado**).
- Resultados de acciones → toast de Sileo con `notifyActionResult` más `ActionStatus` (sección 12); sin `Alert`.

## 6. Ejemplos canónicos

### Card

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>Título de la sección</CardTitle>
    <CardDescription>Contexto breve, sin duplicar el título.</CardDescription>
  </CardHeader>
  <CardContent>{/* contenido */}</CardContent>
  <CardFooter>{/* acciones */}</CardFooter>
</Card>
```

No volcar todo en `CardContent`: la jerarquía nativa es la que da espaciado y composición.

**Composición oficial de shadcn** (<https://ui.shadcn.com/docs/components/base/card>):

```text
Card
├── CardHeader
│   ├── CardTitle
│   ├── CardDescription
│   └── CardAction
├── CardContent
└── CardFooter
```

Criterios de auditoría (obligatorios en código nuevo y al tocar una card existente):

- Una superficie con aspecto de tarjeta (fondo `card`, borde o anillo, radio, padding
  propio) se construye con `Card`, nunca con un `div` estilizado a mano.
- El título va en `CardTitle` y el texto de apoyo en `CardDescription`; no se reemplazan
  por `p`/`span` sueltos ni por layouts flex propios dentro del `CardHeader`. El heading
  semántico (`h2`/`h3`) va **dentro** de `CardTitle`.
- Una acción, badge o menú del encabezado va en `CardAction` (arriba a la derecha), no en
  un flex manual junto al título ni al final de `CardContent`.
- Las acciones y metadatos del cierre van en `CardFooter`, no al final de `CardContent`.
- El espaciado se ajusta con `size="sm"` o la variable `--card-spacing`
  (`[--card-spacing:--spacing(6)]`), no con `p-0`/`py-*`/`gap-*` que pisen la estructura.
  El contenido de borde a borde usa `-mx-(--card-spacing)`; sobre un footer, además
  `-mb-(--card-spacing)` en `CardContent`.
- Una imagen de portada va antes del `CardHeader`.
- Excepciones legítimas, documentadas en el código con un comentario: tarjetas
  arrastrables del tablero (anatomía propia de §14.3) y skeletons, que replican la
  estructura con `Skeleton` dentro de las mismas partes.

**Semántica y nombre accesible.** `Card`, `CardHeader`, `CardTitle` y `CardDescription`
aportan composición y estilo, pero **no** convierten por sí solos el título en un heading
accesible: `CardTitle`/`CardDescription` renderizan `div`, no `<h1>`–`<h6>` ni un rol de
encabezado. El código de producto debe aportar la semántica real:

- Si la card encabeza una sección del documento, renderizar un heading real
  (`<h2>`/`<h3>`) dentro del `CardHeader` (como el `h2` de identidad del perfil de
  candidato) o nombrar el contenedor con `aria-labelledby`.
- Si la card agrupa controles de formulario, el nombre accesible puede venir del
  `FieldLegend` de un `FieldSet`. Patrón vigente en el perfil: el `FieldSet` lleva su
  `FieldLegend` en `sr-only` (semántica de grupo para lectores de pantalla) y el
  `CardTitle` visible se marca `aria-hidden` para no duplicar el anuncio.

**Un CTA directo o un menú contextual, nunca una bandeja de botones.** El `CardFooter`
puede llevar metadatos y, como máximo, **una** acción primaria o directa; una sola acción
visible sigue siendo válida en el footer. Cuando la misma entidad tiene **dos o más acciones
pares** (reemplazar, descargar, marcar como principal), esas acciones se agrupan en un único
`DropdownMenu` instalado dentro del `CardAction` del `CardHeader` (o del `ItemActions` de
`Item`), con un trigger contextual de **≥ 40px** (`Button` `variant="ghost"`,
`size="icon"`, `className="size-10"`), ícono `Ellipsis`, `type="button"` y nombre accesible
por entidad (`Acciones de <etiqueta>`). El contenido usa `DropdownMenuGroup` y cada
`DropdownMenuItem` conserva `min-h-10`.

- **Nunca** se usa `CardFooter` solo como bandeja de varios botones: tres botones en un
  footer no son un footer, son un menú mal ubicado.
- `disabled` se reserva para restricciones reales de datos o estado, como una vacante
  histórica sin enlace público ("Vacante histórica sin enlace"). Los placeholders de
  presentación no se deshabilitan: quedan **habilitados e inertes** —visibles, alcanzables
  por foco y clicables, sin ningún efecto de producto (sin navegación, request, storage,
  mutación, toast ni mensaje de éxito)—. Un placeholder nunca se presenta como `disabled`.
- Un placeholder **no lleva copy visible de demo, prototipo o sesión local**. La inercia y el
  dato honesto bastan: un campo que no se puede probar se muestra como `No disponible` o se
  omite la fila, en vez de inventarlo o rotular la superficie como demostración. Tampoco se
  conserva un `aria-describedby` hacia una nota de demo eliminada.
- El trigger de disclosure **no cuenta como acción** ni como capacidad: abre opciones, no
  ejecuta documentos. Es un control de divulgación con su propio nombre accesible.
- Un footer legítimo de metadatos más un único CTA **sigue permitido**; esta regla no lo
  prohíbe.

### Avatar

```tsx
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

<Avatar className="size-10">
  <AvatarImage src={src} alt={`Fotografía de retrato de ${name}`} />
  <AvatarFallback>{initials}</AvatarFallback>
</Avatar>
```

`AvatarFallback` siempre presente; el alto/ancho viaja con `size-*`.

### Badge

```tsx
import { Badge } from "@/components/ui/badge";

<Badge variant="info" dot>Nuevo</Badge>          {/* estado: texto + punto decorativo */}
<Badge variant="accent">Principal</Badge>        {/* rol/etiqueta: sin punto */}
<Badge variant="outline" className="text-muted-foreground">{skill}</Badge>  {/* metadata: sin punto */}
```

Regla durable del Badge:

- **Las variantes semánticas compartidas son dueñas del color y la geometría.** El
  código de producto elige `variant` (`info`, `review`, `success`, `danger`, `accent`,
  `neutral`, …) y **no** agrega recetas de color por llamada ni overrides de geometría
  (`px-*`, `rounded-*`). El radio del badge es el `rounded-md` del primitive.
- **El texto siempre carga el significado.** Un badge se lee aunque no se perciba el
  color: el tono solo refuerza la etiqueta en español.
- **El punto decorativo frontal es opt-in del estado de ciclo de vida.** Los estados
  (`submitted`→`info`, `in_review`→`review`, `hired`→`success`, `rejected`→`danger`)
  pasan `dot`; lo dibuja el `::before` del primitive, nunca un hijo manual.
- **Roles, metadatos, skills, contadores, etiquetas de solo lectura y etiquetas
  promocionales (`Destacada`) quedan sin punto:** no son estados de ciclo de vida.
- **Filtros, tabs y toggles no son badges.** Esos patrones usan `Tabs`/`ToggleGroup`
  instalados; un `Badge` no reemplaza un control interactivo.
- **Sin paleta cruda ni recetas de color semántico por llamada** (`bg-red-50`,
  `text-destructive`, `border-status-*` escritos a mano): el color de estado vive en el
  primitive y en los tokens `--status-*`.

**Excepción acotada — contador de tabs.** El contador numérico dentro de un
`TabsTrigger` puede ser un `Badge variant="secondary"` sin punto y de tamaño circular,
pero esa geometría la aporta el `TabsList` contenedor
(`**:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full`), no cada badge: es una
**excepción de contador**, no un badge de estado.

### Tabs

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

<Tabs value={active} onValueChange={setActive}>
  <TabsList aria-label="Secciones">
    <TabsTrigger value="personal">Personal</TabsTrigger>
    <TabsTrigger value="experience">Experiencia</TabsTrigger>
  </TabsList>
  <TabsContent value={active}>{/* panel único montado */}</TabsContent>
</Tabs>
```

**Nota vigente (perfil de candidato):** `frontend/src/features/candidate/profile-workspace.tsx`
usa la **variante por defecto instalada** (`<TabsList>` / `variant="default"`, el riel
tipo pill). El color, el padding y el estado activo de cada `TabsTrigger` los aporta el
primitive instalado; la vista **no** agrega `className` al trigger ni lo pinta a mano.
Del riel solo se conservan ajustes de layout/accesibilidad: `max-w-full`, `justify-start`,
overflow horizontal, nombre accesible, `tabIndex` y anillo de foco visible. Aunque el
riel compacto mida ~32px, se mantiene así: teclado, foco, accesibilidad y espaciado están
intactos y no se sobreescribe el trigger para forzar 40px (ver targets en la sección 2).

## 7. Mapa de primitives para listado/Kanban de vacantes y pipeline de empleadores

Checklist práctico. Estado = instalado en `frontend/src/components/ui` al momento de
esta regla.

| Necesidad | Primitives | Estado |
| --- | --- | --- |
| Superficie de tarjeta de vacante / candidato | `Card`, `CardHeader`, `CardContent`, `CardFooter` | Instalado |
| Identidad de candidato/empleador | `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarGroup` | Instalado |
| Estado, etapa, etiquetas | `Badge` | Instalado |
| Cambiar vista lista/board o filtros cortos (2–7 opciones) | `Tabs` **o** `ToggleGroup` | Instalado |
| Área scrolleable interna (columnas Kanban) | `ScrollArea` + `ScrollBar` horizontal | Instalado |
| Menú de acciones por tarjeta | `DropdownMenu` | Instalado |
| Estado vacío (sin vacantes / sin postulantes) | `Empty`, `EmptyHeader`, `EmptyTitle`, `EmptyDescription`, `EmptyContent` | Instalado |
| Modal de detalle o confirmación con formulario | `Dialog` | Instalado |
| Panel lateral de detalle | `Sheet` | Instalado |
| Panel inferior móvil | `Drawer` | Instalado |
| Selector de etapa/estado | `Select` | Instalado |
| Popover de filtros/detalle | `Popover` | Instalado |
| Command palette / búsqueda con combobox | `Command` | **No instalado → consultar registry** |
| Ayuda contextual | `Tooltip`, `HoverCard` | `Tooltip` instalado; `HoverCard` no |
| Datos tabulares | `Table` | Instalado |
| Separación de bloques | `Separator` | Instalado |
| Placeholders de carga | `Skeleton`, `Progress` | Instalado |
| Acción puntual en curso | `Spinner` oficial de shadcn | Instalado |
| Notificaciones transitorias | `Sileo` mediante `AppToaster` global | Instalado; excepción aprobada |
| Resultados de acciones (éxito, error, advertencia, información) | Sileo mediante `notifyActionResult` + `ActionStatus` | Instalado |

Regla operativa: si el primitivo no está instalado, **primero** se consulta en el
registry (herramientas MCP en solo lectura) y **no se implementa a mano**. Agregarlo
requiere autorización humana normal y revisión del paquete/registro (sección 1): no hay
instalación automática. La columna "Estado" es un inventario y no convierte en instalado
lo ausente (`HoverCard`, `Command`).

## 8. Evidencia del inventario del registry

Evidencia obtenida de un **listado MCP en solo lectura** del registry: **471 ítems
`@shadcn` disponibles**, incluyendo los primitives núcleo listados arriba. Es evidencia
**sensible al tiempo**: re-consultarla en solo lectura antes de asumir que algo existe o
dejó de existir. Listar, buscar o ver **no instala nada**.

Consulta (solo lectura), preferentemente con las herramientas MCP del registry shadcn
configuradas en el proyecto (listar, buscar, ver). Si hace falta la CLI, usar solo la
versión fijada por el proyecto:

```bash
cd frontend
pnpm exec shadcn info --json                 # config del proyecto + instalados
pnpm exec shadcn search @shadcn -q "<tema>"  # buscar en el registry
pnpm exec shadcn view @shadcn/<item>         # ver un ítem no instalado
```

`pnpm exec shadcn` se usa solo para lectura/listado/consulta. Cualquier acción de registry
que descargue, agregue o instale requiere autorización apropiada y revisión del paquete
(sección 1). Nunca `pnpm dlx ...@latest`.

## 9. Checklist de revisión de UI

- [ ] ¿La carga usa un skeleton de la estructura real, un Spinner para la acción puntual
      o Progress para progreso medible, sin demoras artificiales (sección 11)?
- [ ] ¿Los toasts salen de resultados reales, usan el host global y no sustituyen errores
      persistentes ni validaciones de formulario (sección 11)?
- [ ] ¿Cada resultado de acción usa `notifyActionResult` con el tipo correcto, título,
      consecuencia, como máximo una acción y la referencia técnica en errores, más su
      `ActionStatus` junto a la acción, y cada error de campo usa `FieldError` (sección 12)?

- [ ] ¿Existe un primitive instalado que cubre el patrón? Si sí, se usó.
- [ ] ¿Se usaron variantes nativas antes que clases propias?
- [ ] ¿La superficie se compone con sub-componentes (`CardHeader`, `EmptyContent`, etc.)?
- [ ] ¿La pintura de producto usa solo tokens semánticos (cero color crudo, cero `dark:`
      de color en código de producto)?
- [ ] ¿Cada `Badge` usa una variante semántica compartida (sin recetas de color por
      llamada ni overrides de geometría) y solo los estados de ciclo de vida llevan el
      punto decorativo `dot` (sección 6, "Badge")?
- [ ] ¿Las clases propias son solo layout/densidad/accesibilidad?
- [ ] ¿Los cambios de primitive compartido son transversales y vienen con test?
- [ ] ¿Los controles/acciones independientes apuntan a ≥ 40px, y los compuestos nativos
      (p. ej. `TabsTrigger`) conservan su variante compacta sin romper foco, teclado ni
      espaciado (sección 2)?
- [ ] ¿Foco visible y nombre accesible en todos los controles?
- [ ] ¿Los filtros de tablero/lista comparten un único «Filtros» Sheet, dimensiones
      multiselección OR/AND y chips removibles con anuncio de resultados (§13.12)?
- [ ] ¿Los chips del tablero nunca envuelven ni empujan las columnas hacia abajo,
      incluso con preguntas largas y en móvil (§13.12)?
- [ ] ¿La pantalla tiene presencia visual: jerarquía, profundidad, iconografía,
      densidad y acento semántico (sección 10)?
- [ ] ¿Si la vista ofrece dos modos, cada modo tiene una arquitectura distinta y no
      comparte la misma grilla de datos (sección 10.7)?
- [ ] ¿El `CardFooter` se usa solo para metadatos y como máximo **una** acción directa, y
      las entidades con dos o más acciones pares agrupan esas acciones en un `DropdownMenu`
      dentro del `CardAction` (sección 6), en lugar de una bandeja de botones?
- [ ] ¿Hay **una** acción principal por superficie, elegida por el objetivo principal de la
      pantalla, y las alternativas tienen menos peso (sección 15)?
- [ ] ¿Ajustes, decisión y navegación viven en zonas distintas: ajustes y estado arriba,
      decisión en el centro, salir de la pantalla fuera de la card (sección 15)?
- [ ] ¿El estado de la entidad se ve de un vistazo (badge), sin depender de leer un
      párrafo (sección 15)?
- [ ] ¿Cada estado vacío responde qué ocurre → qué pasará → qué puedes hacer (sección 15)?
- [ ] ¿La pantalla está diseñada para su decisión (explorar, evaluar o completar) y los
      registros comparables siguen identidad → condiciones → complemento → acción
      (sección 16)?
- [ ] ¿Los badges se reservan para categorías y el resto es texto; la información no
      parece un control (sección 16)?
- [ ] ¿Un monto de dinero se lee con separadores y siempre va con moneda, periodicidad y
      neto/bruto (sección 16)?
- [ ] ¿En móvil la pantalla se reorganiza (apila, mueve) en lugar de achicar texto y
      controles (sección 16)?
- [ ] ¿Se revisó la superficie con el volumen real de datos (todas las opciones de todos
      los grupos, nombres largos, conteos en 0) y no se convierte en una pared de
      controles (sección 17)?
- [ ] ¿Todo texto con cantidad concuerda en número («1 candidato», «2 candidatos»)
      usando el helper de plural, nunca concatenando una «s» (sección 17)?
- [ ] ¿Toda acción importante pide confirmación con `ConfirmActionDialog` (sección 18)?
- [ ] ¿Se conservó el diseño validado de las pantallas existentes, comparando con `main` (sección 21)?
- [ ] ¿Los errores, prohibiciones y vacíos de pantalla completa usan `StateCard` (sección 22)?
- [ ] ¿Todo `Calendar` usa `captionLayout="dropdown"`?
- [ ] ¿Cada componente de shadcn usado se comparó con el ejemplo y la composición de su
      documentación oficial (sección 19) y se respetan todas sus partes?
- [ ] ¿Una superficie compuesta nueva (Sheet, Dialog, barra de herramientas) parte de
      un patrón aprobado de estas reglas o de una referencia visual, y no de una
      composición improvisada (sección 17)?

---

## 10. Presencia visual y diversidad de presentación

Estas reglas vienen de las referencias de producto aprobadas para el dashboard y para
`/candidato/postulaciones`. No son gusto: son criterios observables. Una pantalla
**correcta pero sin vida** — todos los bloques con el mismo peso, bordes finos en todo,
datos como texto plano, color decorativo sin significado — es un **fallo de revisión**,
no un detalle de estilo.

### 10.1 Jerarquía

- **Sí**: una introducción de página visible (un `h2` real de 20–24px) seguida del
  contexto, y después la superficie de trabajo. La jerarquía se lee sin zoom.
- **Sí**: un punto focal por pantalla (el título o la métrica principal); el ojo tiene
  dónde empezar.
- **Sí**: contraste tipográfico real entre título, valor y etiqueta: el título usa
  `font-heading` + `font-semibold`, la etiqueta es `text-[12.5px]` con
  `text-muted-foreground` y el valor vuelve a `text-foreground`.
- **No**: repetir el mismo tamaño y peso en todos los textos de la pantalla.
- **No**: dejar que una barra de chrome (el header del shell) sea lo único que nombra la
  página.

### 10.2 Profundidad y superficies

- **Sí**: superficies neutras elevadas para agrupar contenido de la tarea: la `Card`
  instalada ya aporta `bg-card` + `shadow-sm` + `ring-1 ring-foreground/5`. Una
  superficie de contenido usa `bg-card`, nunca `bg-card/40`.
- **Sí**: borde para estructura y estado (divisores, foco, selección); sombra para
  elevación.
- **Sí**: dentro de una card, el divisor es el borde de la sección: `border-b` en
  `CardHeader` y `border-t` en `CardFooter`. El primitivo ya aporta el espaciado
  (`[.border-b]:pb-*`, `[.border-t]:pt-*`), así que **no** se inserta un `Separator`
  extra entre secciones de la misma card (duplicaría el gap). `Separator` queda para
  dividir bloques independientes.
- **Sí**: radio concéntrico (contenedor grande, hijos menores).
- **No**: `border border-border` en cada caja de la pantalla: si todo tiene el mismo
  borde fino, nada tiene jerarquía.
- **No**: sombras decorativas sin agrupación: la profundidad tiene que explicar qué
  bloque es una unidad de tarea.

### 10.3 Iconografía contextual

- **Sí**: un medallón circular (`rounded-full`, `bg-primary/10`, `text-primary`,
  `size-9`/`size-11`) con un ícono funcional que ancla la identidad de una fila
  (postulación, empresa, métrica, documento).
- **Sí**: un ícono chico (`size-3.5`) junto a **cada** etiqueta de dato, para que el campo
  se reconozca antes de leerlo; el texto sigue estando.
- **Sí**: `aria-hidden="true"` en todo ícono decorativo o redundante con el texto.
- **No**: íconos sueltos sin significado, íconos sin etiqueta, o emoji como ícono.
- **No**: mezclar librerías de íconos en la misma superficie.

### 10.4 Densidad y agrupación por tarea

- **Sí**: densidad media: bloques con aire (`gap-*`) agrupados por lo que la persona
  quiere hacer (buscar/filtrar, escanear, leer el detalle de una postulación).
- **Sí**: un bloque por tarea, no un bloque por campo.
- **No**: filas esparcidas y cajas vacías para "equilibrar"; el aire sin agrupación se
  lee como pantalla sin terminar.

### 10.5 Acento semántico de estado

- **Sí**: el color de estado se consume como token semántico (`--status-*`,
  `bg-status-*`, `text-status-*`) en el texto y el borde del `Badge`, sobre un fondo de
  muy baja opacidad del mismo token.
- **Sí**: color con moderación, solo donde hay significado (estado, progreso).
- **No**: color de acento como lavado de superficie o decoración.
- **No**: color crudo, `dark:` manual, o color como único portador del significado: el
  texto español del estado siempre viaja con el tono.

### 10.6 Datos visualizados, no solo escritos

- **Sí**: cuando el dato es una proporción, se muestra además como barra o segmento
  (`Progress`, barra segmentada) con su leyenda.
- **Sí**: el resumen de una entidad usa un badge semántico (p. ej. "Completo",
  "Principal") en vez de otra línea de texto.
- **Sí**: una fila destacada dentro de una sección se marca como tal (superficie
  `bg-muted` inset, ícono de documento, badge), no con más texto.
- **No**: mostrar porcentajes, conteos o distribuciones solo como texto cuando existe un
  primitivo que los visualiza.

### 10.7 Diversidad de composición y diferenciación de modos

- **Sí**: cuando una vista ofrece dos modos (tarjetas y lista), cada modo tiene una
  **arquitectura de información distinta**. Compartir átomos (ícono, etiqueta, badge,
  enlace) está bien; compartir la composición completa no.
- **Sí — modo Tarjetas**: grilla real de dos columnas en desktop y una en mobile, con
  `Card` vertical completo: header de identidad (medallón + título + empresa) y el
  `Badge` de estado arriba a la derecha; divisor; fila de metadatos de dos columnas con
  ícono/etiqueta/valor; bloque de carta de presentación a ancho completo; divisor;
  footer con la fecha y la acción.
- **Sí — modo Lista**: una columna de filas horizontales compactas (identidad, estado y
  fuente, carta y fechas, acción al final), con etiquetas cortas y truncado de una línea
  solo donde el escaneo lo pide. Cada `<li>` conserva su semántica y contiene una
  superficie `Card size="sm"` independiente, redondeada y separada de las demás; la
  separación visual permite reconocer cada postulación sin perder densidad.
- **No**: unir todas las filas dentro de un solo riel con `divide-y` cuando la referencia
  aprobada muestra superficies independientes. La densidad se logra reduciendo la
  jerarquía interna y la altura, no borrando los límites entre entidades.
- **No**: dos modos que son la misma fila con otro `gap`. Si al cambiar de modo la
  persona no gana una lectura distinta, el modo no se justifica.

### 10.8 Antipatrones observados (diagnóstico de las pantallas vigentes)

Prohibiciones observables, no consejos:

- Lienzo pálido sin punto focal.
- Bordes finos uniformes en todas las cajas.
- Todas las cajas con el mismo peso visual.
- Iconografía débil o ausente: nada ancla la identidad de una fila.
- Datos mostrados como texto sin visualizar (porcentajes, distribuciones, conteos).
- Filas esparcidas con aire desperdiciado.
- Enlaces genéricos sin ícono direccional ni jerarquía.
- Profundidad no intencional: todo plano.
- Contenido agrupado por campo, no por tarea.
- Color de acento decorativo en lugar de semántico.

### 10.9 Criterios observables de aceptación

- [ ] Existe un encabezado de página real que nombra la pantalla, con una línea de
      contexto debajo.
- [ ] Hay un punto focal identificable y contraste tipográfico medible entre etiqueta y
      valor.
- [ ] Las superficies de contenido son elevadas (`bg-card` + sombra + ring), no
      translúcidas ni con borde fino uniforme.
- [ ] Cada etiqueta de dato tiene su ícono funcional y todo ícono decorativo es
      `aria-hidden`.
- [ ] Las proporciones y los estados se visualizan (barra, segmento, badge) además del
      texto.
- [ ] El color aparece solo en tokens semánticos de estado o progreso.
- [ ] Si hay dos modos de vista, sus arquitecturas difieren y no comparten la grilla de
      datos.
- [ ] Ninguna de las prohibiciones de 10.8 está presente.

## 11. Carga y notificaciones con calidad de producto

**La calidad viene de conservar contexto y dar feedback honesto, no de agregar animaciones.**
Esta base se aplica a nuevas superficies y a las que se modifiquen; no implica una
migración masiva ni conectar prototipos a persistencia inexistente.

| Situación real | Patrón |
| --- | --- |
| Primera carga de contenido | Composición propia de la pantalla con el `Skeleton` instalado |
| Acción puntual pendiente | `Spinner` oficial junto al texto de la acción |
| Progreso conocido | `Progress` con valor real, nunca porcentaje inventado |
| Resultado de una acción (éxito, error, advertencia, información) | Toast de Sileo mediante `notifyActionResult` (sección 12) más una línea de estado junto a la acción |
| Error de un campo | `FieldError` junto al campo; un toast no lo reemplaza |

### Skeletons por contexto

- Un skeleton **duplica la estructura** de lo que va a llegar, no la sugiere: los mismos
  primitives y slots (si lo cargado es una `Card`, el skeleton es una `Card` con
  `CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/`CardContent`/`CardFooter` en
  el mismo orden; si es una lista de `Item`, filas de `Item`), la misma cantidad y orden
  de secciones, la misma grilla responsive y las mismas medidas de título, badge, avatar,
  botón o campo. Al llegar el contenido no debe moverse nada.
- Componer el primitive `@/components/ui/skeleton`; no crear divs con `animate-pulse`
  como sustituto, ni usar una pantalla genérica de carga para todo el sistema.
- Marcar los bloques decorativos con `aria-hidden="true"`; el contenedor lleva
  `aria-busy="true"` y un solo texto de estado accesible. No anunciar cada bloque.
- En refetch, conservar el contenido útil y el foco cuando sea posible. No volver a
  vaciar toda la pantalla ni desmontar un formulario que la persona está editando.
- No agregar timers, latencias ni skeletons a datos locales ya disponibles. Un
  `loading.tsx` representa una espera real del segmento; no reemplaza automáticamente
  la carga de consultas del cliente.
- Cuando la estructura es observable, un test compara la secuencia de `data-slot` del
  skeleton con la del componente cargado.
- Si todavía no se sabe qué pantalla va a llegar (por ejemplo, el control de rol antes
  de mostrar cualquier ruta de empresa o candidato), no se inventa un skeleton: se usa el
  patrón «Spinner puntual» centrado en el área de contenido, con un único estado
  accesible («Verificando tu cuenta») y sin bloques falsos.

```tsx
// Real: <Card><CardHeader><CardTitle/><CardDescription/><CardAction><Badge/></CardAction>
//       </CardHeader><CardContent>…</CardContent><CardFooter><Button/></CardFooter></Card>
<Card aria-busy="true" aria-label="Solicitud">
  <span role="status" className="sr-only">Cargando solicitud</span>
  <CardHeader>
    <CardTitle><Skeleton aria-hidden="true" className="h-5 w-40" /></CardTitle>
    <CardDescription><Skeleton aria-hidden="true" className="h-4 w-64" /></CardDescription>
    <CardAction><Skeleton aria-hidden="true" className="h-5 w-16 rounded-full" /></CardAction>
  </CardHeader>
  <CardContent className="grid gap-4 sm:grid-cols-2">
    <Skeleton aria-hidden="true" className="h-10 w-full" />
    <Skeleton aria-hidden="true" className="h-10 w-full" />
  </CardContent>
  <CardFooter><Skeleton aria-hidden="true" className="h-10 w-32" /></CardFooter>
</Card>
```

### Spinner puntual

Importar `Spinner` de `@/components/ui/spinner`, nunca dibujarlo a mano o importar
otro loader por vista. Mantener texto contextual en español. Si el texto ya anuncia
la espera, el icono es decorativo; si se usa solo, darle `aria-label` contextual.
Deshabilitar únicamente la acción realmente pendiente y mantener su ancho estable.

```tsx
<Button disabled={pending} aria-busy={pending}>
  {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
  {pending ? "Guardando…" : "Guardar"}
</Button>
```

### Sileo como excepción explícita

- Paquete aprobado: `sileo@0.1.5` (MIT; incluye `motion` como dependencia).
  Documentación: <https://sileo.aaryan.design/docs>.
- `frontend/src/components/feedback/app-toaster.tsx` monta un único host en el layout
  raíz, sin convertir el layout en cliente ni mover el bootstrap del tema. No montar
  otro Toaster en páginas, shells o diálogos.
- Importar `sileo` desde `sileo` en eventos del cliente. No emitir durante render,
  montaje, navegación normal ni desde placeholders. No duplicar una misma acción con
  varios toasts.
- Mostrar éxito solo después de la confirmación real de la operación. El formulario
  actual de vacantes y los borradores locales no habilitan mensajes de guardado o
  publicación en servidor. No simular esas confirmaciones para mostrar el componente.
- Mensajes breves en español, con título autosuficiente. No exponer datos personales,
  errores crudos ni detalles internos. Una descripción es información complementaria.
- Los errores de campo conservan su explicación junto al campo. Los resultados de una
  acción usan el toast más una línea de estado junto a la acción (sección 12); nunca
  dependen solo del tiempo de vida del toast.
- Usar las opciones globales: posición superior derecha, duración de 6 segundos y
  superficie `--popover`. No pasar colores, `fill`, posición o estilos por llamada; la
  duración solo cambia en los errores, que quedan fijos (sección 12).
  Los tokens y ajustes responsive viven en `globals.css`, bajo `[data-pf-toaster]`.
- El tema lo resuelven los tokens existentes, incluso con elección manual opuesta al
  sistema. No crear otro almacén de tema. Sileo inyecta su propio CSS: no duplicar su
  stylesheet. Las reglas globales tienen especificidad para sobrevivir esa inyección.
- Respetar movimiento reducido. En ese modo y en pantallas de hasta 400px se usa una
  superficie estática: el SVG de ancho fijo no debe desbordar ni continuar su morph
  JavaScript visible. Skeleton y Spinner conservan el significado sin animación continua.
- Las acciones dentro de un toast (`button`) son un atajo, nunca el único camino: Sileo
  las dibuja como un enlace dentro del botón del toast, y con teclado no son confiables.
  La misma acción tiene que existir en la pantalla. No usar `promise` sin verificar antes
  teclado, anuncios y estados terminales del flujo.

### Verificación aislada

La fixture no es una ruta de producto y no llama al backend. Prueba los componentes
reales, claro/oscuro con tema manual, viewport de 320px, movimiento reducido y axe.
Desde `frontend/`, en dos terminales:

```bash
corepack pnpm exec vite --config tests/fixtures/ui-feedback/vite.config.ts
PLAYWRIGHT_FEEDBACK_ORIGIN=http://127.0.0.1:3187 corepack pnpm exec playwright test tests/e2e/ui-feedback.spec.ts --retries=0
```

Sin `PLAYWRIGHT_FEEDBACK_ORIGIN`, estos tests se omiten explícitamente en la suite E2E
normal: no se confunden con cobertura ejecutada. No confundir aprobar la fixture con
haber migrado o verificado todas las pantallas de producto.

## 12. Resultados de acciones: éxito, error, advertencia e información

**Un resultado bien comunicado responde tres preguntas: qué pasó, qué quedó a salvo y qué
puede hacer la persona ahora.** Un párrafo rojo suelto, largo o con jerga técnica
(«clave de idempotencia», «respuesta inválida») es un fallo de revisión.

### Dónde se muestra cada cosa

| Qué | Patrón | Pieza |
| --- | --- | --- |
| Resultado de una acción (guardar, crear, cargar) | Toast de Sileo abajo a la derecha (no tapa el botón de tema del encabezado) | `notifyActionResult` (`@/components/feedback/notify`) |
| Estado persistente de esa acción | Una línea breve junto al botón, con ícono | `ActionStatus` en un `ActionBar` (`@/components/feedback/action-status`) |
| Un campo inválido | Mensaje corto junto al campo, `aria-invalid` en el control | `Field` + `FieldError` |
| Una página o sección sin datos que mostrar | Estado vacío con acción | `Empty` |

- No se usa `Alert` para resultados de acciones.
- `notifyActionResult` es la única forma de emitir toasts de resultado. Recibe una clave
  por acción (por ejemplo `"draft-save"`), cierra el toast anterior de esa clave y deja
  uno solo visible por acción.
- La línea de estado (`ActionStatus`) va **junto a** la acción, dentro de un
  `ActionStatusSlot` que se renderiza siempre, aunque esté vacío, con alto reservado.
  Así un resultado que aparece o cambia nunca mueve el botón. En filas de acciones va a
  la izquierda de los botones con `ActionBar` (punto siguiente); solo un botón aislado,
  fuera de una fila de acciones, la lleva debajo. Nunca va arriba de la acción ni ocupa
  más de una línea por resultado.
- **Footer de acciones compacto (`ActionBar`).** En el pie de una `Card` o de un
  `Sheet` (o en cualquier fila de acciones de un formulario), el `ActionStatusSlot` va
  **a la izquierda** de las acciones, en la misma fila: se usa `ActionBar`
  (`@/components/feedback/action-status`) dentro del `CardFooter`/`SheetFooter`, sin
  `flex-col`. El slot se sigue renderizando siempre y la fila se alinea arriba, así un
  estado que aparece o se parte en dos líneas no mueve los botones; en el DOM las
  acciones siguen antes que el estado. Apilar el estado debajo de los botones duplica el
  alto del footer (~128px contra ~80px en una `Card`) y queda prohibido. Aprobado por
  el usuario tras las pruebas de los cortes 2 y 3 (2026-10-16).
- **Footer de pasos (wizard).** Cuando el pie tiene una acción de retroceso («Atrás»)
  además de las acciones principales, la fila es «Atrás» a la izquierda, luego el
  `ActionBar` ocupando el resto (estado reservado y acciones a la derecha), todo
  alineado arriba. Los pasos sin resultado que mostrar no reservan el slot. Aplicado en
  el editor de borradores (2026-10-16).
- La línea de estado (`ActionStatus`) es el respaldo accesible y persistente del toast.
  Resume el resultado en pocas palabras («Guardado · versión 2», «No se guardó · ver
  aviso») y, si hay una acción útil (iniciar sesión, crear la empresa), la ofrece ahí
  como enlace o botón real ≥ 40px. Un nuevo intento la reemplaza.
- Si el backend rechaza datos, los campos señalan qué corregir; el toast solo resume.

### Tipos de toast

| Tipo | Cuándo | Duración |
| --- | --- | --- |
| `success` | Solo después de la confirmación real del backend | 6 s |
| `error` | La acción falló o su resultado es incierto | Fijo (`duration: null`) hasta cerrarlo o hasta un nuevo intento |
| `warning` | La acción se completó con una salvedad que la persona debe conocer | 6 s |
| `info` | Información neutra sobre una acción (por ejemplo, nada que guardar) | 6 s |

- Íconos propios de lucide con `aria-hidden` (`CircleCheck`, `CircleAlert`,
  `TriangleAlert`, `Info`), nunca los íconos por defecto de Sileo: su texto alternativo
  está en inglés.
- No se pasan colores ni estilos por llamada: los tonos salen de `--status-*` en
  `globals.css`.

### Redacción

- El título nombra qué pasó y a quién; la descripción añade la consecuencia o el
  siguiente paso, nunca repite el título. Máximo dos oraciones cortas y lenguaje
  neutro respecto al género («Ana pasó a Screening», no «Candidato movido»).
- **Título:** qué pasó, en seis palabras o menos y sin culpar a la persona («Borrador
  guardado», «No se pudo guardar el borrador», «El servidor tuvo un problema»).
- **Descripción:** una o dos oraciones con la consecuencia (qué se guardó o no) y el
  siguiente paso. Nada de códigos, términos internos ni texto del backend sin revisar,
  salvo el mensaje de validación del backend ya pensado para mostrarse.
- **Acción:** como máximo una, con un verbo concreto («Reintentar», «Iniciar sesión»,
  «Crear empresa»). Es un atajo: la misma acción existe en la línea de estado o en la
  pantalla.

### Mensaje por causa

| Causa técnica | Título | Siguiente paso |
| --- | --- | --- |
| Datos inválidos (400) | Revisa los datos marcados | Corregir los campos señalados |
| Sesión vencida (401) | Tu sesión expiró | Iniciar sesión (sin perder lo capturado) |
| Sin permiso (403) | No tienes permiso para esta acción | Explicar qué cuenta puede hacerlo |
| Falta un requisito (404 de empresa, empresa inactiva) | Falta configurar tu empresa | Enlace a la configuración |
| Conflicto (409/412) | Esto cambió en otro lugar | Explicar qué se conserva |
| Error del servidor (5xx) | El servidor tuvo un problema | Reintentar; decir si es seguro |
| Sin conexión o sin respuesta a tiempo | No hubo respuesta del servidor | Reintentar; decir si es seguro |
| Respuesta que la UI no reconoce | No pudimos confirmar el resultado | Reintentar sin duplicar o revisar antes |

Cuando una escritura pudo haber ocurrido (5xx, sin respuesta, respuesta no reconocida),
la descripción dice explícitamente si reintentar es seguro.

### Referencia técnica

- Los toasts de error incluyen al final de la descripción una línea discreta con la
  referencia, por ejemplo `HTTP 500 · internal_error · 17:58:46`. Sirve para reportar el
  problema y ubicarlo en los logs del backend.
- Solo lleva el código HTTP, el código de error del backend y la hora local del intento.
  Nunca tokens, cookies, cuerpos de petición o respuesta, identificadores personales ni
  mensajes crudos de excepciones.
- Las Server Actions devuelven esa referencia como datos serializables
  (`{ status?, code? }`). El navegador solo ve el POST 200 de la action, así que sin
  esta referencia la causa real queda oculta.

### Accesibilidad

- Sileo anuncia todos los toasts con `aria-live="polite"`, incluso los errores, y
  muestra la descripción solo al expandirse. Por eso cada resultado también queda en
  `ActionStatus`, con `role="status"` y texto completo, y el botón que originó la acción
  la referencia con `aria-describedby`.
- El toast es un `<button>` sin cierre con Escape: los errores fijos se cierran con clic,
  deslizando o con un nuevo intento. Ninguna acción queda disponible solo en el toast.
- El color nunca es el único portador del significado: ícono, título y texto cargan el
  mensaje completo.

## 13. Patrones aprobados en la configuración de vacantes

Patrones que salieron de pruebas reales en el navegador (cortes 1–3 de la
configuración del pipeline). Se aplican a cualquier pantalla nueva con el mismo caso.

### 13.1 Modo oscuro: superficies y medallones

- **No** usar `bg-muted` como fondo de filas o ítems dentro de una `Card` ni sobre
  `bg-background`: en oscuro `--muted` es casi igual a `--card` y la fila desaparece.
  Usar el `Item` instalado con `variant="outline"`, o `bg-card` + `ring-1` para marcar un
  ítem activo de navegación (`bg-card shadow-sm ring-1 ring-primary/40`).
- **No** usar `text-primary` sobre un fondo teñido de `primary` (`bg-primary/10`): el
  violeta oscuro del tema no se lee. El medallón de posición o identidad usa
  `bg-primary/12 text-foreground ring-1 ring-primary/40` (misma idea que el `Badge`
  `accent`).
- Toda pantalla nueva se revisa en tema claro y oscuro antes de pedir la prueba.

### 13.2 Listas ordenables

- La manija de arrastre (`GripVertical`, `Button` ghost `size-10`, nombre
  «Arrastrar {nombre}») va **a la izquierda** del número de posición. A la derecha del
  contenido queda un único menú «⋯» (`DropdownMenu`, «Acciones de {nombre}»).
- Arrastrar nunca es el único camino (WCAG 2.5.7): el menú «⋯» ofrece «Subir» y
  «Bajar», deshabilitados cuando el movimiento no es posible, y la acción destructiva
  («Quitar …») va separada con `DropdownMenuSeparator` y `variant="destructive"`.
- Los elementos de posición fija no tienen manija ni menú: muestran «Posición fija» con
  un ícono `Lock`, y un espacio vacío del ancho de la manija mantiene alineados los
  números.
- El arrastre usa `@dnd-kit/core` (ya instalado), solo desde la manija, con anuncios en
  español para teclado y lector de pantalla.

### 13.3 Sheets

- El `Sheet` compartido es **flotante por defecto** (separado de los bordes y con
  `rounded-2xl`). `presentation="edge"` queda solo para el cajón de navegación móvil del
  sidebar.
- Un `Sheet` sirve para editar una parte secundaria de una entidad sin salir de su
  pantalla (por ejemplo, los subestados de una columna desde su menú «⋯»). Si edita
  datos propios, tiene su propio botón de guardar, independiente del formulario de
  fondo, y cerrarlo con cambios sin guardar pide confirmación con un `Dialog`
  («Seguir editando» / «Descartar»).
- Su footer es una sola fila con `ActionBar` (sección 12).

### 13.4 Secciones de configuración con apartados

- La configuración de una entidad vive en su propia ruta con un menú de apartados a la
  izquierda en desktop (como la configuración de empresa), un apartado por ruta y un
  guardado por apartado. Se entra desde la pantalla de la entidad con un botón de
  ícono (engranaje, `Settings`) con nombre accesible y `Tooltip`, no desde el sidebar.
- Solo se listan apartados que existen: nada de entradas «Próximamente».

### 13.5 Fechas de negocio

- Para fechas que dependen de días hábiles o de la zona de la organización, el «hoy»,
  el rango elegible y los días deshabilitados vienen del servidor. Se compone `Popover`
  + `Calendar` con esos datos; **no** se usa `DatePickerField`, que toma la fecha del
  navegador (sirve para fechas personales como la de nacimiento).
- Las celdas del calendario usan `[--cell-size:--spacing(10)]` para llegar a 40px.
- Un aviso en línea (no un error) usa `TriangleAlert` y `text-status-review`, nunca
  `text-muted-foreground`.

### 13.6 Formularios

- Al rechazar un guardado por validación, el foco va al **primer campo con error** en
  orden visual, no a un campo fijo.

### 13.7 Tests de menús y popovers

- jsdom no puede abrir los portales de `DropdownMenu`. Las opciones de un menú salen de
  una función pura (por ejemplo `stageRowActions`) que se prueba aparte, y el test de UI
  verifica el trigger (nombre, `aria-haspopup`). Lo que solo se ve con el menú abierto
  se confirma en la prueba manual.

### 13.8 Textos consistentes y diálogos de confirmación

- Un mismo dato se llama igual en todas partes: formulario, resumen, diálogo y
  checklist (por ejemplo «Columna de corte» y «Objetivo de entrega», no «Columna de
  entrega» o «Meta de entrega» en el resumen).
- Una acción importante se confirma con `ConfirmActionDialog` (sección 18), con un
  resumen de ícono + etiqueta + valor dentro del mismo diálogo y la consecuencia de
  confirmar. Los formularios y las listas de requisitos pendientes siguen usando
  `Dialog`: lo que falta se agrupa por dónde se completa, con un enlace «Completar»
  por ítem. Su `DialogFooter` usa `ActionBar` (sección 12); no son confirmaciones.
- Si el resultado de la acción es incierto (sin respuesta), el diálogo ofrece
  «Comprobar», que solo lee el estado; nunca reintenta solo.

- Un diálogo con una lista que puede crecer (faltantes, resultados) tiene alto máximo
  (`max-h-[min(44rem,calc(100dvh-2rem))]`) y **un solo** contenedor de scroll entre el
  encabezado y el pie: un `div` con `min-h-0 flex-1 overflow-y-auto`. Las cards de
  adentro llevan `shrink-0`: una `Card` que se encoge recorta su contenido («cards
  cortadas») en lugar de dejar que el área haga scroll.
- `ScrollArea` solo se usa con una altura definida (fija, o el alto completo de un
  contenedor que ya la tiene, como las columnas del tablero). En un alto flexible por
  `max-h`, su área interna crece con el contenido y se desborda del contenedor.
- En una lista compacta con `ItemSeparator`, el `ItemGroup` lleva `gap-0` y el separador
  `my-0`: si no, el espacio se suma dos veces y cada fila queda el doble de alta.
- Las filas de una lista dentro de una card son `Item` compactos separados por
  `ItemSeparator`, no una caja con borde por fila; el conteo del grupo va en `CardAction`
  y el total, en la descripción del diálogo («Faltan 13 datos en 3 secciones»).

### 13.9 Subida de archivos

- Los archivos viajan por un Route Handler de Next (`app/api/…`) que agrega el Bearer del
  lado del servidor, corta el cuerpo al límite que manda el backend (más un margen chico
  para el multipart) y reenvía solo las partes esperadas. No se sube el límite global de
  las Server Actions y el token nunca llega al navegador.
- El tipo MIME del navegador es orientativo: se acepta un tipo permitido o un tipo vacío
  / `application/octet-stream` cuya extensión corresponda a uno permitido; el backend
  decide por el contenido real. El `accept` del input lista tipos **y** extensiones
  (`.pdf,.docx`).
- Antes de enviar se valida tamaño y tipo en el cliente con mensajes junto al campo; los
  rechazos del servidor (tamaño, tipo, contenido que no coincide, límite de la
  biblioteca) tienen su propio texto.

### 13.10 Tableros con movimientos persistidos

- La manija y el menú «Mover a…» son controles hermanos de la entrada al detalle;
  comparten las mismas reglas de destino, basadas en el orden que entrega el servidor.
  Un destino no permitido se deshabilita en `useDroppable` y se explica durante el
  arrastre. No poner `aria-disabled` en la región completa: también deshabilitaría
  semánticamente los controles de detalle que siguen disponibles.
- Cada tarjeta tiene su propio bloqueo de escritura. En el pipeline compacto, el éxito
  se anuncia con el toast existente y con el cambio real de columna; no queda un
  «Candidato movido/descartado» persistente ni un slot vacío dentro de la tarjeta.
  Los errores y avisos de reconciliación sí conservan un `ActionStatus` compacto en la
  tarjeta, referenciado desde sus controles. Esta es la excepción acotada a la reserva
  de `ActionStatusSlot` de la sección 12.
  Al cambiar de columna, recuperar el foco de teclado perdido en su menú, sin robarlo
  de otro control que la persona haya usado durante la espera.
- Una salida con consecuencias se confirma con el `Dialog` instalado (sección 13.8),
  no requiere agregar otro primitive. El resultado de otra tarjeta nunca cierra esa
  confirmación.
- Ante resultado incierto, respuesta no reconocida o conflicto que exige reconciliar,
  conservar el tablero y leerlo **una vez**, sin repetir la escritura. Si la lectura
  falla, bloquear movimientos sobre la copia desactualizada y ofrecer «Reintentar»
  solo para leer. Los errores mantienen toast y estado persistente junto a la acción.
- Si coinciden escrituras independientes y el resumen global no tiene versión propia
  (por ejemplo cobertura), hacer una sola lectura al terminar todas: las respuestas
  pueden llegar fuera de orden. No convertir esa lectura en un reintento de escritura.
- Un hito irreversible confirmado no retrocede por una respuesta de escritura anterior.
  El resumen se adopta de la escritura; sus detalles se leen por separado, con una
  secuencia de lectura que descarta respuestas antiguas. Si esos detalles fallan, se
  conserva el hito y se muestra una descripción breve sin inventar fechas ni resultados.
  La reconciliación vuelve a leer resumen y detalles, nunca repite la escritura.
- Las operaciones de ciclo de vida (descartar/recuperar) comparten el bloqueo por
  tarjeta, los resultados y la reconciliación de los movimientos, pero no sus destinos
  de arrastre. Una columna sin movimientos directos puede conservar detalle y acciones
  propias habilitados: no llamarla «Solo lectura» si permite recuperar candidatos.
- La confirmación puede contener datos capturados. Un rechazo de validación sin detalles
  deja el diálogo abierto y conserva esos datos; un `409` que exige confirmar una
  consecuencia agrega la explicación y espera **otro clic explícito**, sin reenviar solo.

### 13.11 Texto plano con límites Unicode

- Si el contrato cuenta puntos de código, el contador, la validación y el cuerpo usan
  una misma función pura: recortar únicamente `Unicode White_Space` en los extremos,
  contar con `Array.from`, conservar el interior y rechazar controles salvo `\n` y `\t`
  cuando el contrato los permita. No usar `maxLength` de HTML: cuenta unidades UTF-16 y
  corta antes de tiempo los caracteres suplementarios.
- Los campos opcionales vacíos después de ese recorte se **omiten** del cuerpo; nunca
  se envía `""`. Una opción «Otro» puede volver obligatorio el comentario: esa condición
  depende del catálogo seleccionado, no de un campo separado duplicado.
- Motivo interno, comentario interno y mensaje público son datos distintos. El diálogo
  explica quién verá cada uno; el historial conserva sus etiquetas. Los mensajes se
  renderizan como texto de React con `whitespace-pre-wrap` y `break-words`, nunca HTML.

### 13.12 Filtros locales de tableros y listas

- Los filtros viven en un único `Sheet` flotante a la derecha (§13.3), abierto desde
  «Filtros» (`Button` outline con contador de **valores** activos). No agregar un
  botón suelto por filtro. Cada dimensión es multiselección: OR entre sus valores y
  AND entre dimensiones activas; una dimensión vacía no restringe. «Sin X» es un valor
  de la dimensión cuando aplica, nunca un interruptor separado.
- Un solo modelo genérico `{ key, label, options, match(item, selected) }` alimenta
  filtrado, grupos y chips. Agregar una dimensión es una declaración. Las opciones
  siguen el orden del tablero/catálogo; pueden agruparse visualmente sin cambiar la
  semántica OR. Los conteos por opción describen el tablero completo actual.
- El Sheet sigue la anatomía de la sección 17: encabezado con identidad, secciones por
  significado y **un control compacto por dimensión** (multiselect con búsqueda,
  casillas y conteos dentro del desplegable), nunca todas las opciones expandidas como
  lista de casillas. Pie con el resumen en vivo («N candidatos coinciden» y los filtros
  activos) y las acciones «Limpiar» y «Ver N candidato(s)». Los filtros aplican en
  vivo; el botón primario solo cierra y el foco vuelve a «Filtros».
- Una sola barra en superficie `Card`, con borde, `rounded-xl` y espaciado de 8–12px:
  «Filtros» con contador a la izquierda; con filtros activos, `Separator` vertical,
  riel de chips `min-w-0 flex-1` sin wrap y con scroll horizontal fino, y «Limpiar»
  ghost con `RotateCcw` a la derecha. Sin filtros, solo «Filtros». La barra de controles
  usa `CardContent` sin encabezado ni footer redundantes; el grupo tiene nombre accesible.
- Cada chip es un control, nunca un badge interactivo: ícono de dimensión, etiqueta
  muted + «: » + valor, máximo 300px, etiqueta y valor con `min-w-0 truncate`.
  `Tooltip` → `TooltipTrigger` + `TooltipContent` (§19) conserva el texto completo
  «{dimensión}: {valor}» al pasar o enfocar. Quitar usa un botón compacto de 32px
  con nombre «Quitar filtro {dimensión}: {valor}», sin abreviar el contenido.
- Solo con filtros activos aparece debajo «● Vista filtrada · Mostrando X de Y
  candidato(s)», con anuncio cortés y helper de plural, más «Editar filtros ›» a la
  derecha que abre el mismo Sheet y devuelve el foco a «Filtros». En móvil esa línea
  puede envolver; la barra y sus chips nunca. El estado vive en el controlador/página
  local, sin URL; filtrar no escribe ni vuelve a leer.
- Convención futura del servidor: parámetros repetidos por valor, por ejemplo
  `?substate=a&substate=b&substate=none`, con la misma semántica OR/AND. No cambiar
  contratos ni emitir requests para implementar la presentación local.
- Se conserva el tablero completo como fuente: las columnas muestran «X de Y» mientras
  hay filtro. Si quedan vacías, usan `Empty` con borde dashed, ícono de filtro muted,
  título «Sin coincidencias» y «Ningún candidato coincide con los filtros en esta
  etapa.», sin botón en ninguna columna: «Limpiar» vive en la barra. Es la excepción
  de filtrado a los vacíos de una línea de §14.2–§14.3; sin filtros se conservan.
  La cobertura no cambia. Si una escritura oculta su tarjeta, sus errores siguen visibles en la barra
  y el foco puede volver al filtro.

## 14. Tipografía y pulido de producto (decisiones de la pasada de UI)

### 14.1 Tipografía de la aplicación

- Inter es la única familia de la aplicación: cuerpo y títulos. `--font-heading` resuelve
  a Inter. Clash Display queda solo en la landing de marketing, registrada con su propio
  nombre de familia.
- La jerarquía se arma con tamaño y peso, nunca con una fuente display: título de página
  20px/600; título de sección 15–16px/600; etiqueta de sección dentro de una ficha en
  mayúsculas pequeñas 11–12px/500 con tracking amplio y `text-muted-foreground`; cuerpo
  14px/400; metadatos 12–13px en muted; números con `tabular-nums`.

### 14.2 Reglas de pulido observadas en el tablero y la ficha

- Nunca repetir un dato en dos formatos contiguos (nombre de columna y badge con el mismo
  nombre; «Etapa: Descartados» seguido de un badge «Descartados»).
- Un hito histórico no se presenta como estado actual: si la cobertura completa se
  alcanzó y ya no se cumple, se muestra como nota con fecha, no como badge de éxito.
- Un estado vacío repetido en varias columnas es un hueco discreto de una línea, no un
  `Empty` con ícono y párrafo por columna.
- Una tarjeta o card no ocupa el ancho completo para mostrar un solo número: los
  indicadores van compactos en el encabezado de la página.
- Una ficha de entidad tiene encabezado de identidad fijo (avatar con iniciales, nombre,
  badge de estado, acciones primarias arriba y un único cierre), contenido en pestañas
  con contador, datos en grilla etiqueta/valor y archivos como tarjeta de archivo (ícono
  del tipo, nombre, acción de descarga), no como enlace subrayado.
- Ningún contenido se corta contra el borde de un contenedor con scroll horizontal.

### 14.3 Composición del pipeline aprobada en v0

Referencia: `docs/design/v0/reference-lqiGtbQJqJc/` y capturas de L5 en
`odd/tasks/ui-polish.md`. Se porta la presentación, nunca su estado de demostración.

- Encabezado «Pipeline» 20px/600, fecha corta 12px muted; cobertura compacta con
  `CheckCheck` y `Progress` de 4px success sobre border, divisor vertical y engranaje
  de 40px que navega a la configuración real. Capacidad desconocida: sin denominador
  ni barra. Cobertura completa actual: texto success; hito pasado: nota muted
  «Se completó el …», nunca badge de éxito.
- Fechas con `Intl` es-MX, día numérico, mes corto, año; sin conectores «de».
  Metadatos de tarjeta sin año; actividad con hora de 24h. Se conserva la zona de
  negocio `America/Mexico_City` del tablero anterior.
- Riel `ScrollArea` + `ScrollBar` horizontal, snap y pequeño inset que preserva los
  bordes de la primera tarjeta. Columnas de 284px con tintes centrales `.stage-*`
  (new/custom neutral, screening info, screening_ok review, in_process primary,
  placement success, discarded danger); oscuro manual y de sistema comparten el
  ajuste de primary hacia foreground. Los tintes solo viven en `globals.css`, con
  tokens y `color-mix`, sin pintura inline ni paleta nueva.
- Excepciones locales a §6: el `Badge` de identidad de etapa consume la receta central
  `.stage-badge`; los contadores de columna y tabs tienen densidad compacta definida
  por sus contenedores. No se convierten en nuevas variantes globales ni se replican
  recetas de color por llamada. Una columna vacía usa una sola línea en un hueco
  dashed de 96px, no un `Empty` repetido.
- Tarjetas `Card` con composición nativa, avatar de 32px, nombre 14px/500 de dos
  líneas con tooltip, metadatos de fechas, `Separator` y archivo por extensión o
  motivo/grupo de descarte. Menú: destinos permitidos → «Ver ficha» → «Descartar»;
  descartada: «Recuperar» → «Ver ficha». La manija dnd-kit sigue independiente,
  disponible con foco y siempre visible en pantallas pequeñas; su target de 40px
  ocupa el aire alrededor de la fila compacta del CV, no añade otra fila de acciones.
- Ficha de hasta 560px, identidad con avatar de 48px, acciones arriba, único cierre
  «Cerrar ficha», `Tabs` de 44px con contadores reales y contenido `ScrollArea`
  vertical. Excepción de densidad a §6: este riel local usa triggers de radio menor
  y 12px; estados activos, teclado y foco siguen siendo del primitive instalado.
  El foco inicial va al título y vuelve al detalle al cerrar. Se conserva la ficha
  flotante de §13.3 y el overlay instalado; ningún cambio global de overlay.
- Resumen con dl de etiqueta/valor e íconos; CV en tarjeta descargable real; preguntas
  de filtro y actividad en tabs independientes, con skeleton/error/reintento según la
  lectura real (sin timers de demostración). Timeline ordenado más reciente primero,
  actores reales y badges «Contratación» / «Salida de Placement». Footer: título real
  de la vacante, sin número de postulación ni datos inventados.
- Descartar/recuperar conservan `Dialog`, `ActionBar`, validación Unicode, mensajes
  privados/públicos y confirmaciones de Placement. Las confirmaciones que parten de
  la ficha se anidan dentro de ella y devuelven el foco a su acción.

### 14.4 Tableros a altura completa

- En escritorio (`md`+), el pipeline publicado ocupa el alto disponible del viewport:
  contenido en columna flex y tablero con `flex-1 min-h-0`, sin alargar la página.
- Las columnas se estiran al alto del tablero, con un mínimo de 420px; toda su superficie
  conserva las reglas de destino del arrastre.
- Cada columna mantiene su encabezado fuera del `ScrollArea` vertical. Las vacías
  conservan arriba el bloque compacto «Sin candidatos en esta etapa» (nunca un recuadro
  punteado de altura completa); la barra horizontal queda al borde inferior del tablero.
- Bajo `md`, la página mantiene su scroll natural y el tablero tiene altura acotada con
  scroll interno. Si falta altura en escritorio, el mínimo se resuelve dentro del tablero,
  no ampliando la página.

### 14.5 Sidebar colapsado y marca de la app

- El sidebar colapsado nunca reduce ni deforma el wordmark: muestra una marca compacta
  centrada. El wordmark queda para el estado expandido y el drawer móvil, a 24px de alto
  (`h-6`) dentro de la fila de 40px.
- La marca compacta es un único componente (`PeopleFlowMark`) con el nombre accesible
  «PeopleFlow» que muestra el isotipo aprobado, uno por tema: `peopleflow-mark-light.png`
  (disco blanco con «p» negra) en tema claro y `peopleflow-mark-dark.png` (disco negro
  con «p» blanca) en tema oscuro, ambos con las esquinas transparentes, a 32px dentro del cuadrado de 40px. Las imágenes son
  decorativas (`alt=""`); el nombre lo da el contenedor. El botón del logo pierde su
  padding de estado expandido en el riel, para que el isotipo nunca quede recortado.
- Todos los botones del riel (navegación, acción primaria y cuenta) comparten un cuadrado
  de 40px centrado, con el ícono o el avatar centrado; hover, selección y foco usan esa
  misma geometría.
- El ancho del riel contempla el tamaño del botón y sus márgenes simétricos; las
  desalineaciones no se corrigen con desplazamientos por ítem. Las etiquetas conservan su
  nombre accesible y los tooltips siguen disponibles.
- La transición dura 200ms con `ease-linear`, respeta movimiento reducido y no altera la
  presentación expandida.

### 14.6 Reordenar columnas desde el tablero

- Con o sin candidatos (corte 7): manija `GripVertical` de 40px
  «Reordenar {columna}», visible con hover/foco (siempre en móvil), y menú accesible
  «Mover a la izquierda/derecha». Nuevos y Placement mantienen su posición; Descartados
  nunca es arrastrable ni destino. Elevar la columna y marcar la inserción sin animaciones
  obligatorias. La columna no se mueve hasta confirmar con `ConfirmActionDialog` (§18);
  con candidatos (`structure_locked === true`) primero se pide la vista previa del impacto
  y el diálogo lista a quién afecta; el PUT lleva `confirm_impact` y el toast cuenta el
  impacto realmente aplicado. Cada confirmación guarda con el ETag del pipeline y bloqueo;
  adoptar el nuevo ETag y leer el tablero. Ante conflicto o incertidumbre, leer una vez
  configuración y tablero, sin repetir el PUT; si falla, bloquear el reordenamiento y
  ofrecer solo actualización de lectura. Toast real y estado persistente en el slot
  reservado de la barra del tablero, sin alterar el editor de configuración.


## 15. Principios de jerarquía y composición

Principios de diseño aplicados al rediseño del pipeline de un borrador. Son buenas
prácticas, no resultados medidos con usuarios: cuando una pantalla tenga métricas o
pruebas con usuarios, mandan esos datos.

| Principio | Regla | Para qué sirve |
| --- | --- | --- |
| Jerarquía visual | Una sola acción principal (`Button` por defecto) por superficie; las alternativas van en `outline` o `ghost`. La principal se elige por el objetivo de la pantalla: si primero hay que revisar, la principal es revisar. | El siguiente paso es evidente sin ocultar las alternativas. |
| Proximidad (Gestalt) | Las acciones sobre la entidad van juntas; los ajustes de otra cosa (por ejemplo, las columnas del pipeline) van en el `CardAction` del encabezado. | Separa decidir sobre la entidad de configurar el proceso. |
| Acción frente a navegación | Salir de la pantalla («Volver a …») va fuera de la card, como `ghost` alineado al inicio; nunca junto a la acción principal. | Salir no compite con completar la tarea. |
| Visibilidad del estado | El estado de la entidad se muestra como badge en el encabezado de su card o de la página («Vacante en borrador», «Activa»). | Se entiende la situación de un vistazo. |
| Un solo punto de entrada | Una misma acción aparece una sola vez por pantalla (no una tuerca en la página y «Configurar columnas» en la card). | Evita elegir entre dos caminos iguales. |
| Espacio en blanco intencional | Una card no se estira para llenar la pantalla: su alto sigue al contenido y se organiza en encabezado, contenido y pie. | Aire sin alejar lo que está relacionado. |
| Estado vacío orientado a la acción | Título que dice qué ocurre, descripción que dice qué pasará (y qué puede hacerse mientras), acciones para salir del estado; una pista secundaria opcional en el `CardFooter`. | El vacío deja de ser un aviso y ofrece una salida clara. |
| Legibilidad y adaptación | El texto de apoyo limita su ancho (`max-w-md` o `max-w-prose`); el título del estado vacío se refuerza (`text-xl font-semibold`); los botones se apilan a ancho completo en móvil (`flex-col sm:flex-row`). | Escaneo rápido y controles cómodos en pantallas chicas. |

Ejemplo de referencia: `DraftPipelineCard` en
`src/features/employer-vacancies/draft-pipeline-state.tsx` (estado y ajustes arriba,
decisión al centro, pista al pie, «Volver a Vacantes» afuera). Su skeleton usa el mismo
componente con placeholders, como pide la sección 11.

## 16. Diseñar según la decisión y estructuras comparables

Principios surgidos del rediseño del listado y el detalle públicos de vacantes (propuesta
de v0, portada al sistema). Igual que la sección 15, son buenas prácticas, no resultados
medidos con usuarios. Complementan la sección 15 (jerarquía, proximidad, acción frente a
navegación), que no se repite acá.

| Principio | Regla | Para qué sirve |
| --- | --- | --- |
| Diseñar según la decisión | Cada superficie sirve a una decisión: la card ayuda a **explorar** (¿vale la pena abrirla?), el detalle a **evaluar** (¿me postulo?), el formulario a **completar** una acción. Solo entra lo que ayuda a esa decisión; el resto va al paso siguiente. | Evita cards que intentan ser un detalle y detalles que intentan ser un formulario. |
| Estructura estable | Los registros comparables (cards de vacantes, de postulaciones, de candidatos) siguen siempre el mismo orden: **identidad → condiciones → información complementaria → acción**, cada grupo en su zona. | Se comparan registros sin releer cada uno. |
| Badges solo para categorías | Un badge marca una categoría o un estado («Nueva», «Remoto», «En proceso»). La información secundaria va como texto con separadores («Indefinido · Intermedio · Ingeniería»). La información nunca se ve como un botón; los íconos de una lista informativa son distintos entre sí y sin borde de control. | Lo clicable se distingue de lo que solo se lee. |
| Legibilidad numérica | Un monto se formatea con separadores y sin decimales vacíos (`$50,000 MXN`, no `50000.00 MXN`); las condiciones del monto van debajo, en texto secundario. | El número se lee de un vistazo sin perder información. |
| Información decisiva visible | El salario siempre va con moneda, periodicidad y neto/bruto. Si no se publica, se dice («Salario no publicado»), nunca se omite en silencio ni se inventa. | Nadie decide con un dato a medias. |
| Resumen completo | Un extracto corta en un límite de palabra y marca el corte con «…» solo si recortó; nunca a mitad de una palabra. | Ayuda a decidir sin texto roto. |
| Divulgación progresiva | Se muestra lo esencial (los primeros beneficios o habilidades) y el resto detrás de «y N más». Si la superficie no tiene el dato completo, «y N más» lleva al lugar donde está (por ejemplo, `#beneficios` del detalle), nunca despliega algo inventado. | Menos carga sin esconder lo que existe. |
| Información de decisión junto a la acción | En una pantalla de evaluación, los datos que deciden (compensación, requisitos de postulación) van en el mismo bloque que la acción principal, y ese bloque queda visible al desplazarse en escritorio (`lg:sticky`, con el desplazamiento del encabezado). | La decisión y la acción no quedan lejos. |
| Accesos directos en páginas largas | Una página con varias secciones largas ofrece navegación por anclas, solo a las secciones que tienen datos, con estado activo visible. | Control y eficiencia sin recorrer todo. |
| Escaneabilidad | Las listas reales se muestran como listas espaciadas y se separan los grupos con significado distinto (indispensables frente a deseables). El texto que la persona escribió como párrafo se respeta: no se inventan viñetas. | Se lee rápido sin falsear el contenido. |
| Reorganizar en móvil | En pantallas chicas se apilan zonas (el pie de la card, la columna lateral del detalle pasa abajo) y los botones van a ancho completo; el tamaño del texto y de los controles no se reduce. | Legible y cómodo en cualquier pantalla. |

Ejemplos de referencia: `PublicVacancyCard` (identidad → condiciones → complemento →
pie con compensación y «Ver vacante») y `PublicJobDetailView` (encabezado, «La vacante de
un vistazo», navegación por secciones y columna fija con compensación y «Postularme») en
`src/features/jobs/components/`. Referencia de diseño:
`docs/design/v0/reference-c6eMqlbQQtD/`.

## 17. Paneles densos (Sheets de filtros, configuración y formularios largos)

Origen: el primer Sheet de «Filtros» del tablero mostraba todas las opciones de todas
las dimensiones como casillas sueltas, sin secciones; el contenido se deslizaba por
debajo del encabezado, abundaban conteos en 0, el pie decía «Ver 1 candidatos» y la
explicación de la lógica estaba en la descripción del encabezado. La referencia
corregida (v0) resuelve cada punto; estas reglas evitan que se repita.

| Regla | Concreto | Para qué |
| --- | --- | --- |
| Un control compacto por dimensión | Cada filtro es un `Field` con etiqueta, un disparador de multiselección (Combobox o Popover del sistema) que muestra «Todas las etapas» o el resumen de lo elegido, y una ayuda de una línea. Las opciones, su búsqueda, las casillas y los conteos viven **dentro** del desplegable. Una lista de casillas expandida solo se admite con una única dimensión de ≤5 opciones. | El panel se recorre de un vistazo, sin importar cuántas opciones tenga cada grupo. |
| Secciones por significado | Las dimensiones se agrupan en secciones con encabezado de ícono + etiqueta en mayúsculas pequeñas («PROCESO DE SELECCIÓN», «CANDIDATOS DESCARTADOS») y un `Separator` entre ellas; la etiqueta de la sección no compite en peso con la del campo. | Jerarquía clara: sección → campo → opciones. |
| Anatomía fija del panel | Encabezado: tile con el ícono de la acción, título con verbo («Filtrar candidatos») y una línea de propósito en lenguaje llano. Cuerpo: único contenedor con scroll (sección 13.8: `min-h-0 flex-1 overflow-y-auto`), separado del encabezado y del pie por bordes; el contenido nunca pasa visible por debajo del encabezado. Pie fijo: resumen en vivo + acción secundaria con ícono («Limpiar») + primaria con el resultado («Ver 3 candidatos →»). | Siempre se sabe dónde se está, qué se eligió y qué va a pasar. |
| La lógica se explica una vez, en llano | La regla de combinación va en una nota informativa (ícono + superficie `muted`) al final del cuerpo: «Las opciones de un mismo filtro se suman. Entre filtros, los candidatos deben cumplir ambas condiciones.» Nunca en la descripción del encabezado ni con jerga («AND/OR», «dimensiones»). | La persona entiende el efecto sin leer documentación. |
| Conteos que no hacen ruido | Los conteos van alineados a la derecha, `tabular-nums` y en `muted-foreground`; las opciones en 0 siguen siendo elegibles pero con menor contraste. Nunca una columna de ceros con el mismo peso que las etiquetas. | El dato útil se ve; el vacío no grita. |
| Plural siempre correcto | Todo texto con cantidad pasa por un helper de plural («1 candidato coincide», «3 candidatos coinciden», «Ver 1 candidato»). Prohibido concatenar «s» o dejar un plural fijo. | Un error de concordancia rompe la sensación de producto cuidado. |
| Probar con el peor caso real | Antes de dar por terminada una superficie densa se revisa con todos los grupos y todas sus opciones, nombres largos, conteos en 0 y en móvil, en claro y oscuro. Un test fija la anatomía (encabezado, secciones, un disparador por dimensión, pie con resumen) y el plural. | Los problemas aparecen con datos reales, no con un caso de ejemplo. |
| Partir de un patrón o una referencia | Una superficie compuesta nueva parte de un patrón de estas reglas o de una referencia visual aprobada (v0 o una captura del usuario). Si no hay ninguna, se propone primero una referencia (prompt de v0 o boceto) antes de implementar. | Evita componer al tanteo y rehacer después. |

Ejemplo de referencia: el Sheet «Filtrar candidatos» del tablero
(`src/features/pipeline-movement/board-filters.tsx`), según las capturas de v0 del
2026-10-19.

## 18. Confirmación de acciones importantes

Decisión del usuario (2026-10-19): «hay veces que estas haciendo algo y por accidente
haces un click o incluso dos, y terminas realizando una accion que no querias realizar,
propongo que salte un alert dialog y en esta y en todas las acciones importantes como
ultimo paso antes de realmente ejecutar la accion».

- **Qué se confirma:** mover un candidato de etapa (arrastrando o desde «Mover a…», en la
  tarjeta y en la ficha), cambiar su subestado, reordenar columnas, salir o volver a
  Placement, descartar, recuperar, publicar una vacante, borrar un CV y cumplir la entrega
  desde la configuración. Una acción nueva que cambie datos de otra persona, el historial
  o algo irreversible entra en esta lista.
- **Con qué:** un único componente, `ConfirmActionDialog`
  (`src/components/feedback/confirm-action-dialog.tsx`), sobre el `AlertDialog` de shadcn.
  No se arma otro diálogo de confirmación a mano ni se usa `Dialog` para confirmar.
- **Estructura oficial obligatoria** (composición de la documentación de shadcn):
  `AlertDialogContent` → `AlertDialogHeader` con `AlertDialogMedia` (ícono de la acción),
  `AlertDialogTitle` y `AlertDialogDescription` → `AlertDialogFooter` con
  `AlertDialogCancel` y `AlertDialogAction`. El ícono es obligatorio (`icon`) y repite el
  de la acción en el resto de la app (Publicar = `Send`); en tono destructivo el media va
  en `destructive/10`. Sin detalles se usa `size="sm"`; con detalles, `default` y los
  detalles van en **un solo** bloque entre encabezado y pie (`confirm-action-details`),
  nunca dentro del encabezado ni del pie. El diálogo se abre controlado (`open`) porque
  nace de un arrastre, un menú o un formulario; por eso no hay `AlertDialogTrigger`.
- **Texto:** el título nombra la acción y a quién afecta («¿Mover a Ana Pérez a
  Screening?»); la descripción dice la consecuencia sin repetir el título («Pasa de Nuevos
  a Screening. El cambio queda en su historial.»); el botón usa el verbo de la acción
  («Mover», «Descartar candidato»), nunca «Aceptar» ni «Sí». Acciones destructivas en tono
  `destructive`.
- **Seguridad del clic:** el foco inicial está en «Cancelar», así un Enter o un doble clic
  accidental no confirma; mientras se ejecuta, los dos botones se bloquean y el principal
  muestra el progreso («Moviendo…»). Cancelar no escribe nada; en un arrastre, la tarjeta
  vuelve a su lugar.
- **Cuando la confirmación ya pide datos** (motivo de descarte, mensaje al candidato), esos
  campos van dentro del mismo `ConfirmActionDialog`; no se encadenan dos diálogos.
- **Errores y conflictos** siguen las reglas de cada flujo (recarga sin repetir la acción,
  toasts de la sección 12); el diálogo se cierra al confirmar con éxito.

## 19. Usar cada componente de shadcn como lo indica su documentación

Origen: el usuario revisó las primeras confirmaciones y notó que «a los alert dialogs les
falta estructura, según la documentación oficial»: faltaba `AlertDialogMedia`, no se usaba
`size="sm"` y los detalles quedaban sueltos.

- **Antes de usar un componente por primera vez** (o de crear un componente propio sobre
  él), leer su página en `ui.shadcn.com/docs/components/base/<componente>` o consultar el
  MCP de shadcn (`get_item_examples_from_registries`, `view_items_in_registries`) y anotar
  la sección **Composition** (el árbol de partes), los ejemplos y las props (`size`,
  `variant`).
- **Respetar el árbol completo de la composición.** Cada parte va dentro de la que indica
  el árbol (por ejemplo `AlertDialogMedia` dentro de `AlertDialogHeader`, `CardAction`
  dentro de `CardHeader`). Si una parte opcional aporta a la decisión del usuario (ícono,
  descripción, acción), se usa.
- **Toda desviación se justifica por escrito** en el comentario del componente o en estas
  reglas (por ejemplo: diálogo controlado sin `Trigger` porque nace de un arrastre). Una
  desviación sin justificación es un defecto.
- **Revisar los estados que trae cada parte, no solo su estructura.** Ejemplo: `FieldLabel`
  pinta un fondo cuadrado cuando su casilla está marcada (`has-data-checked:bg-input/30`)
  porque está pensado para «tarjetas de opción» con borde redondeado. Usado como fila de
  una lista (casillas dentro de un desplegable), se ve como un bloque cuadrado pegado al
  borde. En listas, cada fila es un resaltado tipo menú: `rounded-lg px-2`, `hover:bg-muted`
  y marcado con `has-data-checked:bg-primary/5`, con aire respecto del borde del contenedor.
  Revisar hover, foco, marcado y deshabilitado en el navegador antes de cerrar.
- **Los tests fijan la composición** a través de los `data-slot` oficiales (por ejemplo,
  media → título dentro del encabezado, y el pie después), además del comportamiento.
- Un componente propio que envuelve uno de shadcn (como `ConfirmActionDialog`) es el único
  lugar donde se arma esa composición; las pantallas no la rearman a mano.

## 20. Ubicaciones


- Usar siempre `LocationField` (`src/features/geo/location-field.tsx`), nunca ubicación
  de texto libre. Guardar códigos como strings (con ceros iniciales); mostrar los
  nombres del catálogo del servidor, no nombres inventados ni códigos como etiquetas.
- Profundidad por contexto: vacante hasta municipio con CP opcional; empresa hasta
  municipio con CP; candidato hasta municipio, sin CP. `required` declara los niveles
  obligatorios del contexto. El CP se ofrece solo con profundidad municipio porque
  necesita una pareja estado/municipio; fuera de México se muestra solo el país.
- El CP **precarga, nunca bloquea**. Si resuelve varios municipios, la persona elige
  uno. Cambiar a una pareja incompatible quita el CP y explica por qué junto al campo.
- Composición oficial (§19): `FieldSet` + `FieldLegend` + `FieldGroup`; cada selector
  usa `FieldLabel` y el Combobox simple (`Input`, `Content`, `Empty`, `List`, `Item`).
  El CP usa `InputGroup` + `InputGroupInput`. Errores con `FieldError` y
  `aria-invalid`; cargas con skeleton del campo; fallos con «Reintentar» explícito.
- Referencias oficiales guardadas en `docs/design/shadcn-reference/`: `combobox.md`,
  `field.md`, `input-group.md`. En Base UI instalado, `itemToStringLabel` muestra el
  nombre y `itemToStringValue` serializa el código; escribir en el filtro no modifica
  la ubicación hasta elegir una opción.
- **Ubicación opcional** (`OptionalLocationField`, rechazado el patrón «Agregar ubicación» con el
  select bloqueado — usuario, 2026-10-20): el campo País se muestra habilitado y vacío con el
  placeholder «Elige un país», sin México por defecto, así nunca se guarda un país que nadie
  eligió; al elegir México aparecen código postal (si aplica), estado y municipio. Sin país, se
  guarda `null`. Para borrar una ubicación ya guardada hay una acción «Quitar ubicación» discreta
  (botón `ghost`), solo cuando hay un país elegido. Nunca un botón para «habilitar» el campo.
- **Ubicación dentro de un diálogo** (editar la ubicación de la empresa): composición oficial de
  `Dialog` (`docs/design/shadcn-reference/dialog.md`, ejemplo `dialog-demo`): `DialogHeader` con
  `DialogTitle` y `DialogDescription`, el campo como cuerpo sin repetir el título como leyenda,
  `DialogFooter` con `DialogClose` «Cancelar» (outline) y la acción principal; botón de cerrar
  visible. Los errores van en su campo y en el toast (sección 12), nunca un texto suelto en el pie.
- **Sin scroll horizontal:** las columnas de una grilla con campos (estado/municipio) llevan
  `[&>*]:min-w-0` para poder achicarse; un contenedor con `overflow-y-auto` usa `-mx-1 px-1`
  para que el anillo de foco no lo desborde. Revisar los diálogos angostos (`sm:max-w-md`).

## 21. El diseño validado no se cambia al implementar funcionalidad

Origen (usuario, 2026-10-19): «no se por que te da por cambiar el diseno de la ui cada vez que
implementamos funcionalidades, la mayoria de lo que esta hecho (ui) no funciona o no esta
implementado pero el diseno YA ESTA VALIDADO, por favor, no lo cambies». Caso: al conectar el
perfil del candidato al backend se reescribió su pantalla (barra, pestañas, encabezado).

- **Conectar datos, guardar, validar o migrar un contrato NO autoriza cambiar la UI.** Se
  conserva la estructura, las clases, los textos, el orden y los componentes de la pantalla tal
  como están en `main`. Solo cambia lo que la funcionalidad exige de verdad (por ejemplo, un
  campo de texto que pasa a ser `LocationField` en el mismo lugar y con el mismo ancho).
- **Antes de tocar una pantalla existente** se compara con `main` (`git diff main -- <archivo>`)
  y, si hay un cambio visual, se justifica en el commit. Un cambio visual sin pedido del usuario
  es un defecto.
- **Rediseñar es una tarea aparte**, que solo existe cuando el usuario la pide (con una
  referencia o una captura) y se valida en la cola como cualquier otro cambio.
- Al delegar a un subagente, la tarea lo dice explícitamente: «no cambies el diseño de la
  pantalla; solo conecta …».

## 22. Estados de pantalla completa en una tarjeta con `Empty`

Origen (usuario, 2026-10-19): el estado «Todavía no tienes perfil» era «un mensaje muy pobre».
Pedido: usar `Empty` de shadcn dentro de una tarjeta centrada, como el pipeline de una vacante en
borrador, para errores, prohibiciones y mensajes de ese estilo, con botones en el lugar correcto
y acciones alternativas cuando hagan falta.

- **Cuándo:** cada vez que una pantalla o sección completa no puede mostrar su contenido: error
  al cargar, sin permiso, no encontrado, sesión vencida, servicio no disponible y vacíos
  sin datos todavía. No aplica a errores de un campo (`FieldError`), a resultados de una acción
  (toast, sección 12) ni a avisos dentro de un formulario.
- **Con qué:** el componente compartido `StateCard`
  (`src/components/feedback/state-card.tsx`): una `Card` centrada con la composición oficial de
  `Empty` según el ejemplo `empty-demo` (`docs/design/shadcn-reference/empty.md`):
  `EmptyHeader` → `EmptyMedia variant="icon"` (ícono del motivo) + `EmptyTitle` +
  `EmptyDescription` → `EmptyContent` con la acción principal y, si aplica, una secundaria
  `outline` en la misma fila → un enlace alternativo discreto debajo (`variant="link"`). Las
  pantallas no rearman esta composición a mano.
- **Texto:** el título dice qué pasa en lenguaje llano («No pudimos cargar tu perfil»); la
  descripción, qué significa para la persona y qué no se perdió («Tus datos no cambiaron.»);
  nunca jerga técnica ni códigos (el código va solo en la referencia del toast cuando exista).
- **Acciones:** la principal resuelve el problema (Reintentar, Iniciar sesión, Crear …); la
  secundaria es el siguiente camino útil (Volver a …, Ir al inicio); el enlace alternativo es
  opcional (Contactar soporte, Ver ayuda). Reintentar nunca es automático.
- **Tono del ícono:** error y sin permiso usan `destructive/10`; vacíos y no encontrado usan
  `muted`; información (en borrador, pendiente) usa `primary/10`.
