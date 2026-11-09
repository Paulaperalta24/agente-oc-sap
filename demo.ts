import { rm } from "node:fs/promises"
import { join } from "node:path"
import { construir_payload, crear, generar_evidencia, leer_paquete, validar } from "./src/tools/oc.ts"
import type { OrdenCompra } from "./src/sap/adapter.ts"
import type { Paquete, Validacion } from "./src/types.ts"

type ToolResult<T> = { ok: boolean; data?: T; error?: string }

type CasoProcesado = {
  paquete: Paquete
  validacion: Validacion
  payload?: OrdenCompra
  error?: string
}

const directory = import.meta.dir
const context = { directory, sessionId: "demo" }

const parseResult = <T>(result: string): ToolResult<T> => JSON.parse(result) as ToolResult<T>

const procesarCaso = async (caso: string): Promise<CasoProcesado> => {
  const lectura = parseResult<Paquete>(await leer_paquete.execute({ caso }, context))
  if (!lectura.ok || !lectura.data) throw new Error(lectura.error ?? "Lectura fallida")

  const resultadoValidacion = parseResult<Validacion>(await validar.execute({ caso, paquete: lectura.data }, context))
  if (!resultadoValidacion.ok || !resultadoValidacion.data) throw new Error(resultadoValidacion.error ?? "Validación fallida")

  if (!resultadoValidacion.data.apta) {
    return { paquete: lectura.data, validacion: resultadoValidacion.data }
  }

  const evidencia = parseResult<{ sha256: string }>(await generar_evidencia.execute({ caso, paquete: lectura.data }, context))
  if (!evidencia.ok || !evidencia.data) throw new Error(evidencia.error ?? "Evidencia fallida")

  const resultadoPayload = parseResult<{ payload: OrdenCompra }>(await construir_payload.execute({
    caso,
    paquete: lectura.data,
    derivados: resultadoValidacion.data.derivados,
    validacion: resultadoValidacion.data,
    evidencia_sha256: evidencia.data.sha256,
  }, context))
  if (!resultadoPayload.ok || !resultadoPayload.data) throw new Error(resultadoPayload.error ?? "Payload fallido")

  return { paquete: lectura.data, validacion: resultadoValidacion.data, payload: resultadoPayload.data.payload }
}

const imprimirResumen = (caso: string, resultado: CasoProcesado): void => {
  console.log(`\n${caso}`)
  console.log(`  apta: ${resultado.validacion.apta}`)
  console.log(`  bloqueos: ${resultado.validacion.bloqueos.length ? resultado.validacion.bloqueos.join(" | ") : "ninguno"}`)
  console.log(`  confirmaciones: ${resultado.validacion.confirmaciones.length ? resultado.validacion.confirmaciones.join(" | ") : "ninguna"}`)
  console.log(`  retroactiva: ${resultado.validacion.retroactiva}`)
}

await rm(join(directory, "out"), { recursive: true, force: true })

const resultados = new Map<string, CasoProcesado>()
for (const caso of ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"]) {
  const resultado = await procesarCaso(caso)
  resultados.set(caso, resultado)
  imprimirResumen(caso, resultado)
}

const sol001 = resultados.get("sol-001")
if (!sol001?.payload) throw new Error("sol-001 debe generar un payload")
console.log("\nsol-001 — primera creación:")
console.log(await crear.execute({ caso: "sol-001", payload: sol001.payload, validacion: sol001.validacion }, context))
console.log("sol-001 — segunda creación (idempotencia):")
console.log(await crear.execute({ caso: "sol-001", payload: sol001.payload, validacion: sol001.validacion }, context))

const sol004 = resultados.get("sol-004")
if (!sol004?.payload) throw new Error("sol-004 debe generar un payload")
console.log("\nsol-004 — intento sin confirmación:")
console.log(await crear.execute({ caso: "sol-004", payload: sol004.payload, validacion: sol004.validacion }, context))
console.log("sol-004 — creación con confirmación explícita:")
console.log(await crear.execute({ caso: "sol-004", payload: sol004.payload, validacion: sol004.validacion, confirmado: true }, context))
