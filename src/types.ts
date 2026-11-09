export type Solicitud = {
  solicitud_id: string
  solicitante: string
  proveedor_nombre: string
  proveedor_nit?: string
  descripcion: string
  centro_costo: string
  subarea: string
  cantidad: number
  valor_unitario: number
  valor_total: number
  moneda: string
  indicador_iva?: string
  condiciones_pago?: string
  fecha_solicitud: string
}

export type Paquete = {
  correo: {
    id: string
    de: string
    asunto: string
    fecha: string
  }
  solicitud: Solicitud
  cotizacion: {
    proveedor: string
    nit: string | null
    total: number
    moneda: string
    validez_hasta: string | null
    texto: string
  } | null
  aprobacion: {
    de: string
    fecha: string
    aprobado: boolean
    texto: string
  } | null
  factura: {
    numero: string
    fecha: string
    total: number
  } | null
}

export type ToolContext = {
  directory: string
  sessionId: string
}

export type Proveedor = {
  codigo_sap: string
  nit: string
  nombre: string
  condiciones_pago_default: string
  indicador_iva_default: string
  activo: boolean
}

export type CentroCosto = {
  centro_costo: string
  subareas: string[]
  aprobadores: Array<{ email: string; nombre: string; tope: number }>
}

export type Validacion = {
  apta: boolean
  bloqueos: string[]
  confirmaciones: string[]
  derivados: {
    proveedor?: Proveedor
    indicador_iva?: string
    condiciones_pago?: string
  }
  retroactiva: boolean
}
