/**
 * Plain Spanish messages of the local draft editor.
 *
 * One shared source keeps the visible copy, the accessible error text and the
 * later tests in step. None of these strings is a backend error code or a claim
 * that anything was saved.
 */

export const TITLE_ERROR = "El título supera los 200 caracteres permitidos.";
export const LOCATION_ERROR = "La ubicación supera los 300 caracteres permitidos.";
export const WORK_MODE_ERROR = "La modalidad seleccionada no es válida.";
export const ENUM_ERROR = "Selecciona una opción válida.";
export const REQUIREMENTS_ERROR =
  "Los requisitos superan el tamaño permitido por el formato.";
export const LIST_ITEM_EMPTY_ERROR = "Escribe un valor o quita la fila.";
export const LIST_ITEM_TOO_LONG_ERROR = "El valor supera los 200 caracteres permitidos.";
export const LIST_ITEM_DUPLICATE_ERROR = "Ya agregaste este valor.";
export const BENEFITS_ERROR = "Revisa las prestaciones seleccionadas.";
export const SCREENING_EMPTY_ERROR = "Escribe la pregunta o quita la fila.";
export const SCREENING_TOO_LONG_ERROR =
  "La pregunta supera los 2000 caracteres permitidos.";

/** v2 screening editor messages. Local copy only, not backend error codes. */
export const SCREENING_V2_TYPE_ERROR = "Elige un tipo de pregunta válido.";
export const SCREENING_V2_QUESTION_LIMIT_ERROR =
  "Puedes agregar hasta 100 preguntas.";
export const SCREENING_V2_QUESTION_ID_ERROR =
  "Se repitió una pregunta; quita la fila duplicada.";
export const SCREENING_V2_OPTIONS_MIN_ERROR = "Agrega al menos 2 opciones.";
export const SCREENING_V2_OPTIONS_MAX_ERROR = "Puedes agregar hasta 8 opciones.";
export const SCREENING_V2_OPTION_EMPTY_ERROR = "Escribe la opción o quita la fila.";
export const SCREENING_V2_OPTION_TOO_LONG_ERROR =
  "La opción supera los 200 caracteres permitidos.";
export const SCREENING_V2_OPTION_DUPLICATE_ERROR = "Ya agregaste esta opción.";
export const SCREENING_V2_OPTION_ID_ERROR =
  "Se repitió una opción; quita la fila duplicada.";
export const SCREENING_V2_CORRECT_ERROR = "Elige exactamente una opción correcta.";
/** Truthful notice when the candidate preview cannot be rendered yet. */
export const SCREENING_V2_PREVIEW_INVALID =
  "Corrige las preguntas marcadas para ver la vista previa de la persona candidata.";

/** Candidate simulation dialog of the local draft editor. Local preview only. */
export const QUESTIONNAIRE_DIALOG_TITLE = "Probar cuestionario";
export const QUESTIONNAIRE_DIALOG_DESCRIPTION =
  "Así vería una persona candidata las preguntas de filtro. Es una simulación local: las respuestas no se envían ni se guardan.";
export const QUESTIONNAIRE_DIALOG_OPEN = "Probar cuestionario";
export const REQUESTER_ERROR = "Revisa el solicitante.";
export const LANGUAGE_REQUIRED_ERROR = "Elige un idioma.";
export const LANGUAGE_NAME_TOO_LONG_ERROR =
  "El nombre del idioma supera los 200 caracteres permitidos.";
export const COMPENSATION_AMOUNT_ERROR =
  "Usa solo números con hasta 2 decimales, sin espacios (por ejemplo, 30000.50).";
export const COMPENSATION_RANGE_ERROR =
  "El máximo debe ser mayor o igual que el mínimo.";
export const COMPENSATION_ERROR = "Revisa la compensación.";
export const DESCRIPTION_ERROR = "La descripción no cumple el formato permitido.";
export const GENERIC_ERROR = "Revisa este campo.";
export const MODEL_ERROR = "No se pudo validar el borrador completo.";

/** Single local-only warning of the surface. */
export const LOCAL_ONLY_NOTICE =
  "Este borrador es solo local. Si sales o recargas la página, perderás los cambios.";
/** Truthful success text: validation happened, nothing was saved. */
export const VALIDATION_SUCCESS =
  "Borrador local válido. Recuerda que no se guarda en el servidor.";
/** Truthful copy for the not-yet-connected requester catalog. */
export const REQUESTER_CATALOG_UNAVAILABLE =
  "El catálogo de solicitantes todavía no está conectado. Conservamos el solicitante actual mientras no lo cambies.";
