# Decisión: Frontend Hosting — Proyecto 04: Plataforma Pública de Vacantes

Frontend: **Next.js (App Router, SSR/RSC)** desplegado en **AWS Amplify Hosting**.

Este documento registra la decisión de hosting del frontend, las alternativas evaluadas,
el manejo de ISR/revalidation y el modelo de costo. Cierra el debate de si mover el
frontend a ECS/Fargate.

Documentos relacionados:

- `docs/arquitectura-backend-proyecto-04.md` — backend Go (monolito modular)
- `docs/modelo-de-datos-proyecto-04.md` — modelo de datos Postgres (9 tablas)
- Memoria `architecture/proyecto-04-vacantes-aws` — arquitectura AWS completa

---

## 1. Decisión

**Amplify Hosting para el frontend Next.js. Se descarta correr Next en ECS/Fargate.**

Esto confirma la arquitectura AWS original (que ya marcaba "NO meter Next.js en ECS"),
pero ahora con fundamento técnico y de costo explícito tras evaluar la alternativa a fondo.

Reparto de aprendizaje AWS (objetivo paralelo: examen Developer Associate):

- **ECS/Fargate** se aprende con el **backend Go**.
- **Amplify Hosting** se aprende con el **frontend Next.js**.

## 2. Alternativa evaluada: Next en ECS/Fargate + CloudFront

Propuesta: contenedor `next start` en Fargate, CloudFront delante cacheando estáticos,
para que las tasks solo hagan SSR/procesamiento.

**Por qué se descartó** (para este perfil de proyecto):

- CloudFront delante del contenedor NO saca los estáticos de las tasks: en cada cache miss
  (primer request, post-deploy, TTL expirado, nuevo PoP) el request cae igual al contenedor.
  Para offload real haría falta S3 como segundo origin (behaviors por path), más config propia.
- Tres trampas de operar Next en contenedores:
  1. **Image Optimization (`next/image`)**: corre en el server (sharp) → consume CPU/memoria
     de las tasks; sin cache compartido cada task re-optimiza la misma imagen.
  2. **ISR / on-demand revalidation**: el cache de ISR vive en el filesystem LOCAL del
     contenedor. Con multi-task + contenedores efímeros, cada task tiene su propio cache y
     se pierde en cada deploy. Exige un `cacheHandler` custom respaldado por S3 o Redis.
  3. **Costo baseline always-on**: Fargate corre 24/7 (mínimo 2 tasks por HA); se paga aun
     con cero tráfico.
- Amplify ya resuelve los tres puntos de forma manejada: corre Next en cómputo serverless
  (Lambda) con cache de ISR administrado y coherente, e image optimization incluida.

**Conclusión**: la "extra ops" de ECS no se justifica acá. El driver de consistencia +
aprendizaje se cubre igual (ECS con el backend), y Amplify entrega gratis justo el trabajo
más doloroso de Next en contenedores.

## 3. ISR — estrategia de revalidation

Se usa **On-Demand Revalidation** (`revalidateTag` / `revalidatePath`), NO TTL por fetch.

Disparadores previstos:

- Candidato actualiza su perfil → invalidar el perfil público afectado.
- Reclutador edita una vacante ya publicada → invalidar esa vacante (`revalidateTag('job-<id>')`).

**Por qué importa el hosting acá**: en multi-task auto-hospedado, on-demand revalidation se
ROMPE sin un cache handler compartido (la invalidación toca el cache de UNA sola task; las
demás sirven contenido viejo sin TTL que las rescate). Amplify maneja un cache de ISR
coherente y administrado, así que este problema NO existe en Amplify. Es la razón técnica
de mayor peso a favor de Amplify para este proyecto.

## 4. Modelo de costo (rate card AWS Amplify Hosting)

Fuera del free tier:

| Concepto              | Precio                                  |
| --------------------- | --------------------------------------- |
| Build (Standard)      | $0.01/min (1000 min/mes gratis)         |
| Data storage (CDN)    | $0.023/GB/mes                           |
| Data transfer out     | $0.15/GB servido                        |
| SSR request count     | $0.30 por 1M requests                   |
| SSR request duration  | $0.20 por GB-hora                       |
| WAF                   | $15/mes por app + costos WAF            |
| **Per-seat**          | **$0 — no existe**                      |

Ejemplos oficiales de AWS:

- 300 usuarios activos diarios → **~$8/mes**
- 10,000 usuarios activos diarios → **~$66/mes** (dominado por egress: ~439 GB servidos)

### Por qué Amplify NO replica el "cliff" de Vercel

Vercel se vuelve caro al escalar por: (1) per-seat pricing, (2) markup de bandwidth sobre
AWS (corre encima de AWS con margen propio), (3) salto forzado Pro → Enterprise.

Amplify no comparte ese modelo:

- **Sin per-seat**: mismo costo con 5 o 50 devs.
- **Sin markup de middleman**: es AWS first-party, precio cercano al costo real.
- **Sin cliff de planes**: precio lineal con el uso (pendiente modelable, no precipicio).

### Qué vigilar

- El driver dominante al escalar es el **data transfer out ($0.15/GB)** — egress físico,
  no markup; se paga en cualquier plataforma.
- El ISR/cache reduce la línea de SSR (páginas cacheadas no re-invocan cómputo), dejando la
  factura dominada por egress predecible.

### Escape hatch

Si a gran escala el egress de Amplify aprieta, se migra la MISMA app Next a CloudFront+Lambda
(OpenNext) o a ECS propio: mismo cloud, sin reescribir. Es un problema-bueno-de-tener y la
salida ya está disponible por ser todo AWS. (Con Vercel no existiría esta salida.)

## 5. Nota / caveat honesto

Amplify históricamente va un poco atrás de las versiones de Next y tiene algún edge case
ocasional de ISR. Para on-demand revalidation estándar funciona, pero no es magia perfecta.
