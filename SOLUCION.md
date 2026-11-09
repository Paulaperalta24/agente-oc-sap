# Solución · Agente de Órdenes de Compra SAP

## 1. Problema

La analista administrativa debe transcribir y validar manualmente datos de cada solicitud de compra en SAP; esto consume tiempo, permite errores en controles y no mide las órdenes creadas de forma retroactiva.

## 2. Arquitectura

```text
Analista
   │ chat HTTP
   ▼
Frontend web ──► Backend Bun
                    │
                    ├── Prompt: agent/prompt.md
                    ├── Adaptador LLM: Gemini
                    ├── Herramientas Zod: src/tools/oc.ts
                    │       ├── fixtures/ (lectura)
                    │       └── out/ (evidencia, trazabilidad y control)
                    └── SAP mock: out/sap/ordenes.jsonl
```

El comportamiento del agente vive en `agent/prompt.md`; las reglas ejecutables y el acceso a datos viven en `src/tools/oc.ts`; el adaptador SAP está aislado en `src/sap/`. El backend no contiene reglas de negocio de OC.

## 3. Ciclo del agente

`POST /api/chat` conserva una sesión en memoria y ejecuta un ciclo modelo → herramienta → resultado de herramienta → modelo con un máximo de ocho iteraciones por turno. Los resultados de las herramientas son la única fuente de valores que puede usar el modelo. Las llamadas quedan visibles en el frontend y se registran en `out/log.jsonl`.

Cuando hay confirmaciones, el prompt ordena terminar el turno con una pregunta explícita. El backend registra ese estado y únicamente transforma el siguiente mensaje de confirmación explícita en autorización para crear con `confirmado: true`. Un bloqueo nunca se convierte en creación.

## 4. Elección del modelo

Se eligió Google Gemini mediante el SDK oficial `@google/genai` y el modelo configurable `gemini-3.8-flash`.

- **Razón:** velocidad, disponibilidad de function calling y posibilidad de usar una cuota de Google AI Studio para una demo.
- **Costo estimado:** depende de la tarifa/cupo vigente de Google y del número de iteraciones. El backend limita a ocho iteraciones para evitar consumo ilimitado. En este diseño, la carga de datos y los cálculos quedan en herramientas deterministas, reduciendo tokens.
- **Estado de prueba:** la clave y la conexión se comprobaron; durante la prueba end-to-end el proveedor respondió `503 UNAVAILABLE` por alta demanda. La demo sin modelo pasa de forma determinista.

## 5. Matriz de controles

| Regla | Implementación | Resultado |
|---|---|---|
| RC1 | Busca proveedor por NIT o nombre normalizado y verifica que esté activo. | Bloqueo. |
| RC2 | Verifica aprobación, palabra “Aprobado” y correo autorizado para el centro. | Bloqueo. |
| RC3 | Compara valor total con tope del aprobador. | Bloqueo. |
| RC4 | Valida que subárea pertenezca al centro de costo. | Bloqueo. |
| RC5 | Compara total de cotización contra solicitud con tolerancia de 2 %. | Confirmación. |
| RC6 | Deriva IVA del proveedor cuando falta. | Derivado + confirmación. |
| RC7 | Deriva condiciones de pago del proveedor cuando faltan. | Derivado informado. |
| RC8 | Marca retroactividad si factura antecede a solicitud. | Confirmación + control. |
| RC9 | Detecta aprobación anterior a solicitud. | Confirmación. |
| RC10 | Comprueba cantidad × valor unitario con tolerancia de una unidad. | Bloqueo. |

La parte más delicada fue RC8: la factura llega como texto normalizado y sus rótulos pueden variar. El parser reconoce `Factura Electrónica de Venta`, `No.` y `Fecha de emisión` antes de comparar la fecha con la solicitud.

## 6. Diseño del adaptador SAP real

La primera opción sería integrar **SAP S/4HANA OData `API_PURCHASEORDER_PROCESS_SRV`**, validando previamente que esté disponible y autorizado. Es preferible a automatizar SAP GUI porque ofrece contrato HTTP, trazabilidad y manejo de errores.

El mapeo propuesto sería:

- `referencia.solicitud_id` → referencia externa/campo de seguimiento de la cabecera.
- Sociedad y organización de compras → cabecera de OC.
- Proveedor, moneda y condiciones de pago → cabecera.
- Posiciones → ítem de compra con cantidad, precio, imputación a centro de costo, subárea e IVA.
- Aprobador, hash y excepciones → adjunto/servicio documental y campos de seguimiento o tabla Z según diseño SAP.

Las credenciales no viven en el prompt ni en el agente: se almacenan en un vault corporativo y se inyectan al adaptador por identidad administrada o secretos de la plataforma. La idempotencia usaría `solicitud_id` como referencia externa, verificando primero si ya existe una OC. Frente a un error parcial, el adaptador consultaría SAP por esa referencia antes de reintentar y dejaría el caso en revisión si no puede determinar el estado.

Si OData no es viable, el plan B genera el payload validado y una plantilla de carga masiva o de pegado para SAP, junto con la evidencia y control; así se elimina la mayor parte de la digitación manual sin escribir directamente en SAP.

## 7. Lectura del proceso y OC retroactivas

Las OC retroactivas evidencian que el control se está aplicando después de que el gasto ya ocurrió. La marca `retroactiva` no debe ocultar la compra ni bloquearla automáticamente sin política aprobada: debe alimentar un indicador por centro de costo, proveedor, aprobador y motivo.

Se recomienda fijar un punto de control antes de comprometer gasto: solicitud y cotización cargadas antes de la orden o servicio, con excepciones justificadas y aprobadas. Dirección debería definir un umbral de retroactividad, revisar el indicador mensualmente y actuar sobre las áreas o tipos de compra recurrentes.

## 8. Decisiones y trade-offs

1. **Herramientas deterministas en vez de dejar validaciones al modelo.** Se descartó que Gemini calcule montos o decida controles: reduce alucinaciones y permite ejecutar `demo.ts` sin clave.
2. **Archivos y SAP mock en vez de base de datos.** Se descartó una base de datos porque el reto pide persistencia simple y fixtures locales; para producción se requiere almacenamiento transaccional y auditoría centralizada.
3. **Frontend HTML/CSS/JS sin framework.** Se descartó React para reducir dependencias y tiempo de arranque; el alcance actual es un chat de una pantalla.
4. **Gemini con adaptador propio.** Se descartó acoplar el servidor al SDK: `LlmAdapter` permite sustituir el proveedor sin tocar el ciclo de negocio.

## 9. Supuestos

- Los maestros entregados representan la fuente completa para el reto.
- El correo de aprobación es evidencia válida y “Aprobado” es la señal requerida.
- Una solicitud tiene una única posición simplificada, unidad `UN` y moneda COP o USD.
- Las fechas normalizadas de los fixtures son comparables en formato ISO.
- La política final sobre OC retroactivas la decide dirección, no el agente.

## 10. Cobertura

| Historia | Estado | Evidencia / pendiente |
|---|---|---|
| HU-1 Leer paquete | Hecho | `oc_leer_paquete` normaliza correo, solicitud, cotización, aprobación y factura. |
| HU-2 Validar maestros | Hecho | RC1–RC10 y demo de los seis casos. |
| HU-3 Construir payload | Hecho | Zod y `out/<caso>/trazabilidad.json`. |
| HU-4 Evidencia | Hecho P0 | `aprobacion.txt` y SHA-256; PDF P1 no implementado. |
| HU-5 Crear OC | Hecho | SAP mock, CSV de control e idempotencia. |
| HU-6 Errores | Parcial | Herramientas devuelven `{ ok:false, error }`; falta suite de pruebas automatizada completa. |
| Chat y tool calls | Parcial | UI y backend implementados; falta prueba end-to-end estable con Gemini. |
| Link público | No hecho | Requiere despliegue y secreto configurado. |

Para producción faltan autenticación, autorización por rol, almacenamiento transaccional, monitoreo, gestión documental, auditoría centralizada, pruebas automatizadas, protección contra prompt injection y una integración SAP real certificada.

## 11. Uso de IA

Se utilizó PERXIA como asistente de construcción para interpretar el PRD, generar estructura inicial, implementar TypeScript, revisar errores de compilación y redactar documentación. Se consultó documentación actualizada del SDK Google Gen AI para function calling. Se descartó permitir que el modelo valide o modifique montos: esos resultados se implementaron como herramientas deterministas y esquemas Zod. La persona responsable debe poder explicar y revisar cada archivo antes de la entrega.

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Modelo inventa o altera datos | Herramientas como fuente única, payload Zod y prompt explícito. |
| Clave expuesta | `.env` excluido, `.env.example` sin valor y secretos de plataforma en despliegue. |
| Doble creación por reintento | Búsqueda por `solicitud_id` e idempotencia en mock/adaptador real. |
| Falla parcial de SAP | Consultar por referencia antes de reintentar y enviar a revisión si el estado es ambiguo. |
| Gemini no disponible | Demo sin modelo para controles; adaptador intercambiable y mensajes claros al usuario. |
| Aprobación inválida o manipulada | Validar origen contra maestro; en producción, conservar correo firmado/metadatos y política de auditoría. |
| OC retroactiva se normaliza | Marcar en control, medirla y exigir decisión de política a dirección. |
