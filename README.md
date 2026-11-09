# Agente conversacional · Órdenes de Compra SAP

Agente conversacional para preparar y crear órdenes de compra en un SAP simulado. Lee los fixtures del reto, valida controles administrativos, prepara evidencia de aprobación, construye el payload SAP y requiere confirmación humana para excepciones.

## Requisitos

- [Bun](https://bun.sh) 1.4 o superior.
- Una clave de Google AI Studio para usar Gemini en el chat.

## Arranque local

```bash
bun install
copy .env.example .env
bun run start
```

Completa `GEMINI_API_KEY` dentro de `.env`. Este archivo está excluido por `.gitignore`; no debe compartirse ni subirse al repositorio.

Abre [http://localhost:3000](http://localhost:3000) para usar el chat.

Para desarrollo con recarga automática:

```bash
bun run dev
```

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---:|---|
| `GEMINI_API_KEY` | Sí, para chat | Clave de Google AI Studio usada únicamente por el backend. |
| `GEMINI_MODEL` | No | Modelo Gemini. El ejemplo usa `gemini-3.8-flash`. |
| `PORT` | No | Puerto HTTP; por defecto `3000`. |

## Demo sin modelo

La demo no usa Gemini ni requiere clave:

```bash
bun run demo
```

Procesa los seis casos, imprime bloqueos, confirmaciones y retroactividad; crea `sol-001` dos veces para demostrar idempotencia y procesa `sol-004` con confirmación explícita.

## Comprobaciones

```bash
bun check
bun run demo
```

## API

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/` | Interfaz de chat. |
| `POST` | `/api/chat` | Recibe `{ "sessionId", "message" }` y responde con `reply`, `toolCalls` y `needsConfirmation`. |
| `GET` | `/api/sessions/:id` | Historial de una sesión en memoria. |
| `GET` | `/api/health` | Estado del backend, proveedor y modelo sin exponer secretos. |

Ejemplo:

```bash
curl -X POST http://localhost:3000/api/chat ^
  -H "content-type: application/json" ^
  -d "{\"sessionId\":\"demo\",\"message\":\"Procesa la solicitud sol-001.\"}"
```

## Estado de prueba de Gemini

La API de salud y el backend fueron comprobados localmente. La llamada end-to-end a Gemini queda pendiente de reintento: la clave fue aceptada, pero `gemini-3.8-flash` respondió `503 UNAVAILABLE` por alta demanda al momento de la prueba. La demo de herramientas sí es determinista y funciona sin proveedor LLM.

## Estructura

```text
agent/prompt.md        System prompt del agente
src/tools/oc.ts        Herramientas y controles de negocio
src/sap/               Contrato y SAP simulado
src/llm/               Adaptador independiente y Gemini
src/server.ts           API y ciclo del agente
web/                    Interfaz de chat
fixtures/               Datos entregados, solo lectura
out/                    Evidencias, trazabilidad, control y auditoría generados
demo.ts                 Ejecución verificable sin LLM
```

## Despliegue

Pendiente de publicación. Para la defensa local, ejecutar `bun run start`. El despliegue público debe configurar `GEMINI_API_KEY` como secreto del proveedor y usar `bun run start` como comando de arranque.
