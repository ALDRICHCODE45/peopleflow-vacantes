# Mensaje en una postulación del candidato

## Alcance

Ejemplo solicitado en `/candidato/dashboard`, dentro de **Postulaciones recientes**, para **Ingeniera Frontend · Acme**.

- Una insignia «Nuevo mensaje» destaca la postulación y un botón «Ver mensaje» abre el contenido.
- El mensaje identifica empresa, equipo de selección y vacante; no inventa contactos personales.
- Abrirlo retira la insignia durante la visita; el botón permite volver a leerlo.
- La asociación usa el ID exacto de la postulación, no coincidencias por título o nombre.
- Se conservan el dashboard, sus métricas, los enlaces y las demás postulaciones.

## Límites

Datos de ejemplo independientes del pipeline del empleador. No hay conexión entre ambos, envío, respuesta ni persistencia del estado de lectura. Estos límites se documentan aquí, no como avisos de prototipo en la interfaz.

Composición con primitives instalados, sin nuevas dependencias. La aceptación visual corresponde al usuario después de su push. Las comprobaciones se limitan al comportamiento agregado y tipos, sin repetir suites completas.

## Comprobación

El escritor reportó 35 pruebas enfocadas aprobadas (componente, overview y ruta) y TypeScript sin errores. Una revisión independiente de solo lectura no encontró defectos introducidos. No se ejecutaron pruebas de navegador ni revisión visual para este cambio.
