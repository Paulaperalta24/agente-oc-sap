import { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "./src/tools/oc.ts"
import type { OrdenCompra } from "./src/sap/adapter.ts"
import type { Paquete, Validacion } from "./src/types.ts"

const context = { directory: import.meta.dir, sessionId: "demo" }

type ToolResult<T> = { ok: boolean; data?: T; error?: string }

const procesar = async (caso: string) => {
  const lectura = JSON.parse(await leer_paquete.execute({ caso }, context)) as ToolResult<Paquete>
  if (!lectura.ok || !lectura.data) throw new Error(lectura.error ?? "Lectura fallida")
  const validacion = JSON.parse(await validar.execute({ caso, paquete: lectura.data }, context)) as ToolResult<Validacion>
  if (!validacion.ok || !validacion.data) throw new Error(validacion.error ?? "Validación fallida")
  const evidencia = JSON.parse(await generar_evidencia.execute({ caso, paquete: lectura.data }, context)) as ToolResult<{ sha256: string }>
  if (!evidencia.ok || !evidencia.data) throw new Error(evidencia.error ?? "Evidencia fallida")
  const payload = JSON.parse(await construir_payload.execute({ caso, paquete: lectura.data, derivados: validacion.data.derivados, validacion: validacion.data, evidencia_sha256: evidencia.data.sha256 }, context)) as ToolResult<{ payload: OrdenCompra }>
  if (!payload.ok || !payload.data) throw new Error(payload.error ?? "Payload fallido")
  return { validacion: validacion.data, payload: payload.data.payload }
}

const sol001 = await procesar("sol-001")
console.log("SOL-001, primera creación:", await crear.execute({ caso: "sol-001", payload: sol001.payload, validacion: sol001.validacion }, context))
console.log("SOL-001, segunda creación (idempotencia):", await crear.execute({ caso: "sol-001", payload: sol001.payload, validacion: sol001.validacion }, context))

const sol004 = await procesar("sol-004")
console.log("SOL-004, sin confirmación:", await crear.execute({ caso: "sol-004", payload: sol004.payload, validacion: sol004.validacion }, context))
