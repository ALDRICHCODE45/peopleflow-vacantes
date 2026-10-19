# Board filters sheet and header progress (frontend)
Move every board filter into a «Filtros» Sheet built on one generic multi-select filter model, and make the board header's coverage and delivery indicators read as one designed group.
Branch feat/pipeline-board-filters-ui from main (d5cce32, items 1-9 approved and integrated). Frontend only; no contract change today (client-side filtering over ≤1,000 board items). Rules: docs/frontend-ui-design-rules.md (§9, §11, §13.10, §13.12, §14, §15, §16).

## Specs
- S1. User request (L1, verbatim): «siento que las dos cosas nuevas, el filtro de sub estados y el indicatos de "Entrega "x" de "y"" estan sobre puestos, siento que no embonan, que estan ahi por accidente, aparte de que no estoy seguro de dejar el boton "sub estados" suelto, porque lo que si es seguro es que habran otros muchos multi filtros, y no quiero que todos se amontonen en este espacio, va a hacer una peor ui y no se vera nada bien. entonces propongo un sheet, en el que al tocar un boton "filtros" salga y dentro de el, se encuentren los filtros, ojo, todos los filtros deben ser multi filtro … porque TODOS los filtros de este apartado seran multi filtro, o multi select». «no quiero pedirle a v0 un rediseno sobre esto … lo peudes hacer tu.» Screenshot: /home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-10-18-23-03-57_5360x2520.png
- S2. Filter semantics (agreed with the backend session): every dimension is multi-select; OR within a dimension, AND across dimensions; «Sin X» is a value of its dimension when it applies. Today filtering is client-side with a generic model {key, label, options[{value,label}], match(item, values)}; substates are the first dimension. Future server-side convention: repeated query params per value (`?substate=a&substate=b&substate=none`).
- S3. One «Filtros» button in the board toolbar (with the active-value count) opens a right Sheet listing every dimension as a multi-select group; applied filters show as removable chips under the toolbar only when active, plus «Limpiar filtros»; columns keep «X de Y» and the empty filtered-column copy.
- S4. Header: coverage and delivery become one coherent progress group (same anatomy, alignment and density), not two stacked unrelated widgets.

## Tasks
- T1 [pending] S1-S4 | writer | Generic filter model + Filtros Sheet + chips; header progress group; tests; rule update. | commit: -
- T2 [pending] S1-S4 | parent | Commits, guide step, queue item 1. | commit: -

## Log
- L1. User approved queue items 1-9 («todo esta bien, me gusta, aprobado»); parent fast-forwarded local main to d5cce32 and told the backend to integrate its rows. Then the user asked for the Filtros Sheet and a header that does not look accidental (S1). Parent proposed the shared multi-select strategy to the backend (S2).
