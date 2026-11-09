import { createHash } from "node:crypto"
import { join } from "node:path"
import { z } from "zod"
import { ordenCompraSchema, type OrdenCompra } from "../sap/adapter.ts"
import { SapMockAdapter } from "../sap/mock.ts"
import type { CentroCosto, Paquete, Proveedor, Solicitud, ToolContext, Validacion } from "../types.ts"

const correoSchema = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
})

const solicitudSchema = z.object({
  solicitud_id: z.string(),
  solicitante: z.string(),
  proveedor_nombre: z.string(),
  proveedor_nit: z.string().optional(),
  descripcion: z.string(),
  centro_costo: z.string(),
  subarea: z.string(),
  cantidad: z.number(),
  valor_unitario: z.number(),
  valor_total: z.number(),
  moneda: z.string(),
  indicador_iva: z.string().optional(),
  condiciones_pago: z.string().optional(),
  fecha_solicitud: z.string(),
})

const aprobacionSchema = z.object({
  de: z.string(),
  fecha: z.string(),
  cuerpo: z.string(),
})

const readJson = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
  const content = await Bun.file(path).text()
  return schema.parse(JSON.parse(content))
}

const readOptionalText = async (path: string): Promise<string | null> => {
  const file = Bun.file(path)
  return (await file.exists()) ? file.text() : null
}

const parseNumber = (value: string): number | null => {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")
  const result = Number(normalized)
  return Number.isFinite(result) ? result : null
}

const parseCotizacion = (texto: string): Paquete["cotizacion"] => {
  const proveedor = texto.match(/^Proveedor:\s*(.+)$/im)?.[1]?.trim()
  const nit = texto.match(/^NIT:\s*([\d.\-]+)/im)?.[1]?.replace(/\D/g, "") ?? null
  const totalMatch = texto.match(/^TOTAL.*?:\s*([A-Z]+)\s*([\d.,]+)/im)
  const total = totalMatch?.[2] ? parseNumber(totalMatch[2]) : null
  const validezDias = texto.match(/Validez de la oferta:\s*(\d+)\s*días/im)?.[1]

  if (!proveedor || !totalMatch || total === null) {
    return null
  }

  return {
    proveedor,
    nit,
    total,
    moneda: totalMatch[1] ?? "COP",
    validez_hasta: validezDias ? `${validezDias} días desde la cotización` : null,
    texto,
  }
}

const parseFactura = (texto: string): Paquete["factura"] => {
  const numero = texto.match(/(?:Factura(?:\s+Electrónica(?:\s+de\s+Venta)?)?\s*(?:No\.)?|N[úu]mero)\s*[:#-]?\s*([\w-]+)/i)?.[1]
  const fecha = texto.match(/Fecha(?:\s+de\s+emisión)?\s*:\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
  const totalMatch = texto.match(/TOTAL.*?:\s*([A-Z]+)\s*([\d.,]+)/im)
  const total = totalMatch?.[2] ? parseNumber(totalMatch[2]) : null

  return numero && fecha && total !== null ? { numero, fecha, total } : null
}

const proveedorSchema = z.object({
  codigo_sap: z.string(),
  nit: z.string(),
  nombre: z.string(),
  condiciones_pago_default: z.string(),
  indicador_iva_default: z.string(),
  activo: z.boolean(),
})

const centroCostoSchema = z.object({
  centro_costo: z.string(),
  subareas: z.array(z.string()),
  aprobadores: z.array(z.object({
    email: z.string(),
    nombre: z.string(),
    tope: z.number(),
  })),
})

const normalizar = (value: string): string => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim()

export const leer_paquete = {
  description: "Lee y normaliza el correo, solicitud, cotización, aprobación y factura opcional de un caso.",
  args: {
    caso: z.string().describe("Nombre de la carpeta del caso en fixtures/solicitudes/"),
  },
  async execute(args: { caso: string }, ctx: ToolContext): Promise<string> {
    try {
      const caseDirectory = join(ctx.directory, "fixtures", "solicitudes", args.caso)
      const correo = await readJson(join(caseDirectory, "correo.json"), correoSchema)
      const solicitud = await readJson<Solicitud>(join(caseDirectory, "solicitud.json"), solicitudSchema)
      const cotizacionTexto = await readOptionalText(join(caseDirectory, "cotizacion.txt"))
      const aprobacionFile = Bun.file(join(caseDirectory, "aprobacion.json"))
      const facturaTexto = await readOptionalText(join(caseDirectory, "factura.txt"))
      const aprobacionRaw = (await aprobacionFile.exists())
        ? await readJson(join(caseDirectory, "aprobacion.json"), aprobacionSchema)
        : null

      const faltantes = [
        !cotizacionTexto && "cotización",
        !aprobacionRaw && "aprobación",
      ].filter((value): value is string => Boolean(value))

      const paquete: Paquete = {
        correo,
        solicitud,
        cotizacion: cotizacionTexto ? parseCotizacion(cotizacionTexto) : null,
        aprobacion: aprobacionRaw
          ? {
              de: aprobacionRaw.de,
              fecha: aprobacionRaw.fecha,
              aprobado: /\baprobado\b/i.test(aprobacionRaw.cuerpo),
              texto: aprobacionRaw.cuerpo,
            }
          : null,
        factura: facturaTexto ? parseFactura(facturaTexto) : null,
      }

      return JSON.stringify({ ok: true, data: paquete, faltantes })
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible leer el paquete."
      return JSON.stringify({ ok: false, error: message })
    }
  },
}

const getCaseOutputPath = (directory: string, caso: string, file: string): string => join(directory, "out", caso, file)

const getCotizacionReferencia = (texto: string | undefined): string | null => (
  texto?.match(/COTIZACIÓN\s+([^\r\n]+)/i)?.[1]?.trim() ?? null
)

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex")

export const validar = {
  description: "Valida un paquete de orden de compra contra los maestros y devuelve bloqueos, confirmaciones y valores derivados.",
  args: {
    caso: z.string().describe("Nombre del caso para asociar la validación"),
    paquete: z.custom<Paquete>().describe("Paquete normalizado devuelto por oc_leer_paquete"),
  },
  async execute(args: { caso: string; paquete: Paquete }, ctx: ToolContext): Promise<string> {
    try {
      const maestrosDirectory = join(ctx.directory, "fixtures", "maestros")
      const proveedores = await readJson(join(maestrosDirectory, "proveedores.json"), z.array(proveedorSchema)) as Proveedor[]
      const centros = await readJson(join(maestrosDirectory, "centros-costo.json"), z.array(centroCostoSchema)) as CentroCosto[]
      const { solicitud, cotizacion, aprobacion, factura } = args.paquete
      const bloqueos: string[] = []
      const confirmaciones: string[] = []
      const derivados: Validacion["derivados"] = {}
      const proveedor = proveedores.find((candidate) => (
        solicitud.proveedor_nit
          ? candidate.nit === solicitud.proveedor_nit.replace(/\D/g, "")
          : normalizar(candidate.nombre) === normalizar(solicitud.proveedor_nombre)
      ))
      const centro = centros.find((candidate) => candidate.centro_costo === solicitud.centro_costo)

      if (!proveedor) {
        bloqueos.push("RC1: el proveedor no existe en el maestro.")
      } else if (!proveedor.activo) {
        bloqueos.push("RC1: el proveedor existe pero está inactivo.")
      } else {
        derivados.proveedor = proveedor
        if (!solicitud.indicador_iva) {
          derivados.indicador_iva = proveedor.indicador_iva_default
          confirmaciones.push(`RC6: se derivó el indicador IVA ${proveedor.indicador_iva_default} del proveedor; requiere confirmación.`)
        }
        if (!solicitud.condiciones_pago) {
          derivados.condiciones_pago = proveedor.condiciones_pago_default
        }
      }

      if (!centro) {
        bloqueos.push("RC2/RC4: el centro de costo no existe en el maestro.")
      } else {
        if (!centro.subareas.includes(solicitud.subarea)) {
          bloqueos.push(`RC4: la subárea ${solicitud.subarea} no pertenece al centro ${solicitud.centro_costo}.`)
        }

        const aprobador = aprobacion
          ? centro.aprobadores.find((candidate) => normalizar(candidate.email) === normalizar(aprobacion.de))
          : undefined

        if (!aprobacion || !aprobacion.aprobado) {
          bloqueos.push("RC2: no existe una aprobación válida con la palabra Aprobado.")
        } else if (!aprobador) {
          bloqueos.push("RC2: quien aprobó no está autorizado para el centro de costo.")
        } else if (solicitud.valor_total > aprobador.tope) {
          bloqueos.push(`RC3: el valor ${solicitud.valor_total} supera el tope de ${aprobador.tope} del aprobador.`)
        }
      }

      if (!cotizacion) {
        confirmaciones.push("RC5: no hay cotización legible; requiere confirmación humana.")
      } else {
        const diferencia = Math.abs(cotizacion.total - solicitud.valor_total) / solicitud.valor_total
        if (diferencia > 0.02) {
          confirmaciones.push(`RC5: cotización ${cotizacion.total} y solicitud ${solicitud.valor_total} difieren ${(diferencia * 100).toFixed(2)}%; requiere confirmación.`)
        }
      }

      const retroactiva = Boolean(factura && factura.fecha < solicitud.fecha_solicitud)
      if (retroactiva) {
        confirmaciones.push("RC8: existe una factura anterior a la solicitud; la OC es retroactiva y requiere confirmación.")
      }

      if (aprobacion && aprobacion.fecha.slice(0, 10) < solicitud.fecha_solicitud) {
        confirmaciones.push("RC9: la aprobación es anterior a la solicitud; requiere confirmación.")
      }

      if (Math.abs(solicitud.cantidad * solicitud.valor_unitario - solicitud.valor_total) > 1) {
        bloqueos.push("RC10: cantidad × valor unitario no coincide con el valor total.")
      }

      const data: Validacion = {
        apta: bloqueos.length === 0,
        bloqueos,
        confirmaciones,
        derivados,
        retroactiva,
      }

      return JSON.stringify({ ok: true, data })
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible validar el paquete."
      return JSON.stringify({ ok: false, error: message })
    }
  },
}

export const generar_evidencia = {
  description: "Genera el archivo de evidencia de la aprobación y calcula su hash SHA-256.",
  args: {
    caso: z.string().describe("Nombre del caso que contiene la aprobación"),
    paquete: z.custom<Paquete>().describe("Paquete normalizado con la aprobación a evidenciar"),
  },
  async execute(args: { caso: string; paquete: Paquete }, ctx: ToolContext): Promise<string> {
    try {
      const aprobacion = args.paquete.aprobacion
      if (!aprobacion) return JSON.stringify({ ok: false, error: "No hay aprobación disponible para generar la evidencia." })
      const content = [`De: ${aprobacion.de}`, `Para: ${args.paquete.solicitud.solicitante}`, `Fecha: ${aprobacion.fecha}`, `Asunto: Aprobación de ${args.paquete.solicitud.solicitud_id}`, "", aprobacion.texto].join("\n")
      const hash = sha256(content)
      const path = getCaseOutputPath(ctx.directory, args.caso, "aprobacion.txt")
      await Bun.write(path, `${content}\n\nsha256: ${hash}\n`)
      return JSON.stringify({ ok: true, data: { ruta: path, sha256: hash } })
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible generar la evidencia."
      return JSON.stringify({ ok: false, error: message })
    }
  },
}

export const construir_payload = {
  description: "Construye y valida el payload de una orden de compra SAP, guardando su trazabilidad.",
  args: {
    caso: z.string().describe("Nombre del caso para guardar la trazabilidad"),
    paquete: z.custom<Paquete>().describe("Paquete normalizado de la solicitud"),
    derivados: z.custom<Validacion["derivados"]>().describe("Valores derivados por oc_validar"),
    validacion: z.custom<Validacion>().describe("Resultado de controles para incluir excepciones"),
    evidencia_sha256: z.string().describe("Hash SHA-256 generado por oc_generar_evidencia"),
  },
  async execute(args: { caso: string; paquete: Paquete; derivados: Validacion["derivados"]; validacion: Validacion; evidencia_sha256: string }, ctx: ToolContext): Promise<string> {
    try {
      const { solicitud, correo, cotizacion, aprobacion } = args.paquete
      const proveedor = args.derivados.proveedor
      if (!proveedor || !aprobacion) return JSON.stringify({ ok: false, error: "No se puede construir el payload sin proveedor derivado y aprobación." })
      const indicadorIva = solicitud.indicador_iva ?? args.derivados.indicador_iva
      const condicionesPago = solicitud.condiciones_pago ?? args.derivados.condiciones_pago
      if (!indicadorIva || !condicionesPago) return JSON.stringify({ ok: false, error: "Faltan indicador de IVA o condiciones de pago para construir la OC." })
      const payload = ordenCompraSchema.parse({
        referencia: { solicitud_id: solicitud.solicitud_id, correo_id: correo.id, cotizacion_ref: getCotizacionReferencia(cotizacion?.texto) },
        sociedad: "1000", organizacion_compras: "1000",
        proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
        moneda: solicitud.moneda, condiciones_pago: condicionesPago,
        aprobador: { email: aprobacion.de, fecha_aprobacion: aprobacion.fecha, evidencia_sha256: args.evidencia_sha256 },
        posiciones: [{ numero: 10, descripcion: solicitud.descripcion.slice(0, 40), cantidad: solicitud.cantidad, unidad: "UN", precio_unitario: solicitud.valor_unitario, centro_costo: solicitud.centro_costo, subarea: solicitud.subarea, indicador_iva: indicadorIva }],
        excepciones: args.validacion.confirmaciones.map((detalle) => ({ codigo: detalle.slice(0, 3), detalle, confirmado_por: null })),
      })
      const trazabilidadPath = getCaseOutputPath(ctx.directory, args.caso, "trazabilidad.json")
      await Bun.write(trazabilidadPath, JSON.stringify({ referencia: "solicitud y correo", proveedor: "maestro.proveedores", condiciones_pago: solicitud.condiciones_pago ? "solicitud" : "derivado.proveedor", indicador_iva: solicitud.indicador_iva ? "solicitud" : "derivado.proveedor", aprobador: "aprobacion", posiciones: "solicitud" }, null, 2))
      return JSON.stringify({ ok: true, data: { payload, trazabilidad_ruta: trazabilidadPath } })
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible construir el payload."
      return JSON.stringify({ ok: false, error: message })
    }
  },
}

const appendControl = async (directory: string, row: string[]): Promise<void> => {
  const path = join(directory, "out", "control.csv")
  const file = Bun.file(path)
  const previous = (await file.exists()) ? await file.text() : "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"
  const quote = (value: string): string => `"${value.replaceAll("\"", "\"\"")}"`
  await Bun.write(path, `${previous}${row.map(quote).join(",")}\n`)
}

export const crear = {
  description: "Crea una orden en el SAP simulado solo si no hay bloqueos y las confirmaciones fueron aprobadas.",
  args: {
    caso: z.string().describe("Nombre del caso asociado a la orden"),
    payload: ordenCompraSchema.describe("Payload SAP validado de la orden"),
    validacion: z.custom<Validacion>().describe("Resultado de oc_validar para controlar bloqueos y confirmaciones"),
    confirmado: z.boolean().optional().describe("Indica si la persona confirmó las excepciones pendientes"),
  },
  async execute(args: { caso: string; payload: OrdenCompra; validacion: Validacion; confirmado?: boolean }, ctx: ToolContext): Promise<string> {
    try {
      const now = new Date().toISOString()
      const solicitudId = args.payload.referencia.solicitud_id
      if (!args.validacion.apta) {
        await appendControl(ctx.directory, [solicitudId, "bloqueado", "", String(args.validacion.retroactiva), args.validacion.bloqueos.join(" | "), args.validacion.confirmaciones.join(" | "), now])
        return JSON.stringify({ ok: false, error: "La OC no puede crearse porque hay bloqueos.", bloqueos: args.validacion.bloqueos })
      }
      if (args.validacion.confirmaciones.length > 0 && !args.confirmado) {
        await appendControl(ctx.directory, [solicitudId, "pendiente_confirmacion", "", String(args.validacion.retroactiva), "", args.validacion.confirmaciones.join(" | "), now])
        return JSON.stringify({ ok: false, error: "La OC requiere confirmación humana antes de crearla.", confirmaciones: args.validacion.confirmaciones })
      }
      const sap = new SapMockAdapter(ctx.directory)
      const previous = await sap.buscarOrdenPorReferencia(solicitudId)
      const created = await sap.crearOrden(args.payload)
      await appendControl(ctx.directory, [solicitudId, previous ? "idempotente" : "creado", created.numero_oc, String(args.validacion.retroactiva), "", args.validacion.confirmaciones.join(" | "), now])
      return JSON.stringify({ ok: true, data: { ...created, idempotente: Boolean(previous) } })
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible crear la OC."
      return JSON.stringify({ ok: false, error: message })
    }
  },
}
