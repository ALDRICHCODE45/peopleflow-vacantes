# Competidores y funciones con IA — análisis (octubre 2026)

Para tener en la mira, no para decidir. PeopleFlow aún no está en producción: cualquier idea de aquí puede entrar, salir
o cambiar. Fuentes oficiales consultadas el 2026-10-31; lo no verificado se marca con «?».

## En una frase

El mercado ya resolvió **«que nadie se quede sin respuesta»** (agentes por WhatsApp y entrevistas por voz a escala).
Nadie conecta bien la **evidencia** —psicometría, criterios de la vacante, entrevista— en una sola historia que una
persona pueda defender al decidir. Ahí está el hueco de PeopleFlow.

## Quién es quién

| Competidor | Posicionamiento | Mercado |
| --- | --- | --- |
| **Viterbit** | ATS + agentes de IA: MIA (WhatsApp) y EVA (entrevista por voz) | España/LATAM; hostelería, retail, ETT, mid-market. Desde 259 € |
| **HireVue** | Entrevistas y evaluaciones con IA para enterprise, con gobierno de IA fuerte | Enterprise global; español incluido |
| **Paradox (Workday)** | ATS conversacional para contratación masiva de primera línea | Enterprise frontline; comprado por Workday (oct. 2025) |
| **Teamtailor** | ATS con marca empleadora y «Co-pilot» (OpenAI) | Pymes y mid-market, Europa/LATAM |
| **Manatal** | ATS barato con recomendaciones y scoring por IA | Pymes y agencias; desde 15 USD/usuario/mes |
| **Pandapé** | ATS de Computrabajo; publica nativo en **Computrabajo y OCC** | LATAM/México; el competidor local real |
| **OCC Mundial** | Bolsa de empleo; IA para redactar vacantes; su ATS es Pandapé | México |

## Matriz de funciones

✓ ofrece · ✗ no ofrece (según fuentes oficiales) · ? no verificado · PeopleFlow = estado actual del repo

| Función | Viterbit | HireVue | Paradox | Teamtailor | Manatal | Pandapé | OCC | **PeopleFlow** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Entrevista con IA | ✓ voz, asíncrona | ✓ voz, conversacional | ✓ chat | ✗ (resume reuniones) | ✗ | ? | ✗ | ✗ |
| Agente conversacional de screening | ✓ MIA | ? | ✓ | ✓ pide datos faltantes | ✗ | ? | ✗ | ✗ |
| Canal WhatsApp | ✓ | ? | ✓ (SMS/WhatsApp) | ? | ? | ? | ✗ | ✗ |
| Parsing de CV con IA | ✓ | ? | ? | ✓ | ✓ | ✓ | ? | ✗ (carga manual) |
| Redacción de vacantes con IA | ✓ | ? | ? | ✓ | ? | ✓ | ✓ | ✗ |
| Matching / ranking en base de talento | ✓ | ? | ? | ✓ | ✓ scoring | ✓ «grado de adecuación» | ? | ✗ (filtros) |
| Psicometría / evaluación de competencias | ✓ Talent Assessments | ✓ | ? | ? | ✗ | ✓ gamificadas + «Genoma» | ✗ | ✓ **propia, por competencia** |
| Guía de entrevista estructurada | ✓ preguntas sugeridas | ✓ | ? | ? | ? | ? | ✗ | ✓ **STAR desde el perfil** |
| Automatizaciones por etapa | ✓ | ? | ✓ | ✓ | ✓ (Enterprise) | ✓ | ✗ | ✗ |
| Autoagendado de entrevistas | ✓ | ? | ✓ | ✓ | ? | ? | ✗ | ✗ |
| Volumen / turnos / sucursales | ✓ | ? | ✓ | ✗ | ✗ | ? | ✗ | parcial (geo) |
| Sitio de empleo | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | n/a | ✓ |
| Checklist de criterios por vacante | ? | ? | ? | ? | ? | ? | ✗ | ✓ |
| Precio público | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ (publicación) | — |

## Lo que nos enseña cada uno

- **Viterbit / Paradox**: el cuello de botella en volumen es la *contactabilidad*. Viterbit afirma que solo 38 de cada
  100 candidatos se contactan a tiempo; Compass Group contrata 160 000 personas al año con 20 recruiters gracias a
  Paradox. Para restaurantes y retail, el primer contacto automático vale más que cualquier gráfica.
- **HireVue**: el estándar de confianza. Publica *explainability statement*, auditorías de sesgo (regla 4/5, NYC LL144),
  opción de no usar IA, resúmenes **no evaluativos** y bitácora de cambios del guion. Si hacemos IA de evaluación,
  este es el piso, no el techo.
- **Teamtailor / Manatal**: la IA como copiloto barato (parsing, redacción, sugerencias). Es lo mínimo esperado en un
  ATS de 2026.
- **Pandapé**: su ventaja no es la IA sino la **distribución** (Computrabajo + OCC). Compite por ser «donde ya están los
  candidatos en México».

## Huecos que nadie cubre bien

1. **Evidencia conectada**: psicometría → guía STAR → entrevista → checklist → comparación, con citas que una persona
   pueda revisar. Todos tienen piezas sueltas; nadie la historia completa.
2. **Explicación para el candidato**: qué se evaluó y por qué, sin cajas negras.
3. **IA que no decide**: casi todos entregan un *score* o una recomendación de avanzar; pocos se limitan a
   evidencia y preguntas.

## Oportunidades para PeopleFlow (orden sugerido, sin compromiso)

| # | Idea | Por qué nosotros | Esfuerzo / riesgo |
| --- | --- | --- | --- |
| 1 | **Entrevista asíncrona guiada por evidencia** (texto o voz): preguntas desde el perfil del puesto, el resultado psicométrico y el checklist; entrega evidencia por competencia con citas, «aspectos a validar» y preguntas para la entrevista humana; **sin score de contratar/no contratar** | Ya tenemos perfil, competencias, guía STAR y checklist; nadie los conecta | Alto / alto (legal y sesgo) |
| 2 | **Copiloto del recruiter**: CV → perfil (encima de la carga manual), redacción de vacantes, sugerencias desde la base de talento | Mínimo de mercado; acelera todo lo demás | Medio / bajo |
| 3 | **Automatizaciones por etapa**: al entrar a una etapa, enviar psicometría, mensaje o enlace para agendar | Pipeline personalizable ya existe | Medio / bajo |
| 4 | **Primer contacto por WhatsApp** para perfiles operativos | En México es el canal; abre restaurantes/retail | Alto / medio (costo por conversación, Meta) |
| 5 | **Volumen por turno y sucursal** (filtros por disponibilidad, distancia) | Ya tenemos geolocalización | Medio / bajo |

## Antes de construir cualquier cosa con IA

- **Legal (UE)**: la IA para seleccionar o evaluar candidatos es de **alto riesgo** (AI Act, Anexo III). Las
  obligaciones para estos sistemas se aplazaron del 2026-08-02 al **2027-12-02**. Aplica si vendemos en la UE.
- **Legal (México)**: nueva **LFPDPPP** (DOF 2025-03-20, reforma 2025-11-14): aviso de privacidad, consentimiento y
  derecho de oposición. Confirmar con abogado qué exige ante decisiones automatizadas.
- **Contenido, no voz**: analizar *qué* dice el candidato es defendible; analizar *cómo* lo dice (tono, emoción) entra
  en biometría y sesgo. No ir ahí.
- **Costo por entrevista**: transcripción + modelo + (si responde con voz) síntesis. Modelarlo antes de prometerlo en
  planes.
- **Piso de confianza** (estilo HireVue): opción de no usar IA, revisión humana, guion versionado, bitácora, auditoría
  de impacto adverso.

## Fuentes

- Viterbit EVA: https://help.viterbit.com/es/articles/15590263-eva-asistente-de-entrevistas-por-voz-de-viterbit
- Viterbit MIA: https://help.viterbit.com/es/articles/15652294-como-funciona-mia
- Viterbit planes: https://viterbit.com/planes/ · automatizaciones: https://viterbit.com/gestion/consigue-llegar-a-todo-automatizando-acciones-y-tareas/
- Viterbit blog (38/100): https://viterbit.com/es-MX/blog/ia-en-entrevistas/
- HireVue AI Interviewer: https://www.hirevue.com/solutions/ai-interviewer · explainability: https://www.hirevue.com/wp-content/uploads/2025/10/HV_2025_AI-Explainability-Statement.pdf
- Workday + Paradox: https://newsroom.workday.com/2025-10-01-Workday-Completes-Acquisition-of-Paradox · Compass Group: https://www.workday.com/en-us/customer-stories/a-h/compass-high-volume-hiring-with-conversational-ai.html
- Teamtailor Co-pilot: https://support.teamtailor.com/en/articles/8403166-co-pilot-ai-features-overview
- Manatal precios: https://www.manatal.com/pricing
- Pandapé: https://www.pandape.com/ · OCC + Pandapé: https://recursos-empresas.occ.com.mx/contactanos-occ-con-pandape · IA en OCC: https://supportcenter.occ.com.mx/hc/es/articles/41245634907409
- AI Act Anexo III: https://ai-act-service-desk.ec.europa.eu/en/ai-act/annex-3 · aplazamiento: https://www.cuatrecasas.com/en/global/labor-and-employment/art/digital-omnibus-on-ai-how-does-it-impact-employment-relations
- LFPDPPP: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
