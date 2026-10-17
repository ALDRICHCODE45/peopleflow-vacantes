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
| Área scrolleable interna (columnas Kanban) | `ScrollArea` | **No instalado → consultar registry** |
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
lo ausente (`HoverCard`, `ScrollArea`, `Command`).

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
- [ ] ¿La pantalla tiene presencia visual: jerarquía, profundidad, iconografía,
      densidad y acento semántico (sección 10)?
- [ ] ¿Si la vista ofrece dos modos, cada modo tiene una arquitectura distinta y no
      comparte la misma grilla de datos (sección 10.7)?
- [ ] ¿El `CardFooter` se usa solo para metadatos y como máximo **una** acción directa, y
      las entidades con dos o más acciones pares agrupan esas acciones en un `DropdownMenu`
      dentro del `CardAction` (sección 6), en lugar de una bandeja de botones?

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

- Representar la estructura que llegará: filas de tabla, cards, encabezados o formulario.
  Reservar tamaños y mantener la misma grilla responsive para evitar saltos de layout.
- Componer el primitive `@/components/ui/skeleton`; no crear divs con `animate-pulse`
  como sustituto, ni usar una pantalla genérica de carga para todo el sistema.
- Marcar los bloques decorativos con `aria-hidden="true"`; el contenedor lleva
  `aria-busy="true"` y un solo texto de estado accesible. No anunciar cada bloque.
- En refetch, conservar el contenido útil y el foco cuando sea posible. No volver a
  vaciar toda la pantalla ni desmontar un formulario que la persona está editando.
- No agregar timers, latencias ni skeletons a datos locales ya disponibles. Un
  `loading.tsx` representa una espera real del segmento; no reemplaza automáticamente
  la carga de consultas del cliente.

```tsx
<section aria-busy="true" aria-label="Listado de vacantes" className="flex flex-col gap-3">
  <span role="status" className="sr-only">Cargando vacantes</span>
  <Skeleton aria-hidden="true" className="h-6 w-48" />
  <Skeleton aria-hidden="true" className="h-24 w-full" />
</section>
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
| Resultado de una acción (guardar, crear, cargar) | Toast de Sileo arriba a la derecha | `notifyActionResult` (`@/components/feedback/notify`) |
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
- Un `Dialog` que confirma una acción importante muestra primero lo que falta (lista
  agrupada por dónde se completa, con un enlace «Completar» por ítem) o, si está todo,
  un resumen con ícono + etiqueta + valor y la consecuencia de confirmar. Su
  `DialogFooter` usa `ActionBar` como cualquier pie de acciones (sección 12).
- Si el resultado de la acción es incierto (sin respuesta), el diálogo ofrece
  «Comprobar», que solo lee el estado; nunca reintenta solo.

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
- Cada tarjeta tiene su propio bloqueo de escritura y su `ActionStatusSlot` reservado.
  Al cambiar de columna, recuperar el foco de teclado perdido en su menú, sin robarlo
  de otro control que la persona haya usado durante la espera.
- Una salida con consecuencias se confirma con el `Dialog` instalado (sección 13.8),
  no requiere agregar otro primitive. El resultado de otra tarjeta nunca cierra esa
  confirmación.
- Ante resultado incierto, respuesta no reconocida o conflicto que exige reconciliar,
  conservar el tablero y leerlo **una vez**, sin repetir la escritura. Si la lectura
  falla, bloquear movimientos sobre la copia desactualizada y ofrecer «Reintentar»
  solo para leer. Los resultados mantienen toast y estado persistente junto a la acción.
- Si coinciden escrituras independientes y el resumen global no tiene versión propia
  (por ejemplo cobertura), hacer una sola lectura al terminar todas: las respuestas
  pueden llegar fuera de orden. No convertir esa lectura en un reintento de escritura.
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

El detalle de composición del tablero y la ficha se completa con la referencia de v0
(`docs/design/v0/pipeline-board-and-candidate-sheet.md`) antes de implementarlos.
