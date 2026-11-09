import { join } from "node:path"
import type { OrdenCompra, SapAdapter } from "./adapter.ts"

type OrdenGuardada = OrdenCompra & {
  numero_oc: string
  fecha: string
}

const FIRST_ORDER_NUMBER = 4_500_000_001

export class SapMockAdapter implements SapAdapter {
  constructor(private readonly directory: string) {}

  private get ordersPath(): string {
    return join(this.directory, "out", "sap", "ordenes.jsonl")
  }

  private async readOrders(): Promise<OrdenGuardada[]> {
    const file = Bun.file(this.ordersPath)
    if (!(await file.exists())) return []

    const content = await file.text()
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OrdenGuardada)
  }

  async consultarProveedor(_nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    return null
  }

  async buscarOrdenPorReferencia(solicitudId: string): Promise<{ numero_oc: string } | null> {
    const existing = (await this.readOrders()).find((order) => order.referencia.solicitud_id === solicitudId)
    return existing ? { numero_oc: existing.numero_oc } : null
  }

  async crearOrden(orden: OrdenCompra): Promise<{ numero_oc: string; fecha: string }> {
    const existing = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id)
    if (existing) {
      const saved = (await this.readOrders()).find((order) => order.numero_oc === existing.numero_oc)
      return { numero_oc: existing.numero_oc, fecha: saved?.fecha ?? new Date().toISOString() }
    }

    const orders = await this.readOrders()
    const numero_oc = String(FIRST_ORDER_NUMBER + orders.length)
    const fecha = new Date().toISOString()
    const saved: OrdenGuardada = { ...orden, numero_oc, fecha }

    await Bun.write(this.ordersPath, `${[...orders, saved].map((item) => JSON.stringify(item)).join("\n")}\n`)
    return { numero_oc, fecha }
  }
}
