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
- Carga → `Skeleton`/`Progress` (instalados); `Spinner` (**hoy no instalado**).
- Estados/etiquetas → `Badge` (no `span` con color propio).
- Tooltips/info → `Tooltip`/`Popover` (instalados); `HoverCard` (**hoy no instalado**).

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

Regla operativa: si el primitivo no está instalado, **primero** se consulta en el
registry (herramientas MCP en solo lectura) y **no se implementa a mano**. Agregarlo
requiere autorización humana normal y revisión del paquete/registro (sección 1): no hay
instalación automática. La columna "Estado" es un inventario y no convierte en instalado
lo ausente (`HoverCard`, `Spinner`, `ScrollArea`, `Command`).

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
