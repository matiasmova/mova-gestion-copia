import type { ItemPresupuesto } from './NuevoPresupuesto'

// Cálculos compartidos entre el formulario, la vista previa y el PDF.

type ItemMonto = {
  cantidad: number
  precio_unitario: number
  descuento_pct?: number | null
}

export const redondear = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100

// Importe del ítem a precio de lista (cantidad x precio unitario).
export const importeBruto = (item: ItemMonto) =>
  Number(item.cantidad || 0) * Number(item.precio_unitario || 0)

// Porcentaje de descuento del ítem, limitado entre 0 y 100.
export const pctItem = (item: ItemMonto) => {
  const p = Number(item.descuento_pct ?? 0)

  if (!Number.isFinite(p) || p <= 0) return 0

  return Math.min(p, 100)
}

// Descuento del ítem en pesos.
export const descuentoItem = (item: ItemMonto) =>
  redondear((importeBruto(item) * pctItem(item)) / 100)

// Importe del ítem ya con su descuento.
export const importeNeto = (item: ItemMonto) =>
  redondear(importeBruto(item) - descuentoItem(item))

// Suma de los descuentos de todos los ítems.
export const descuentoItems = (items: ItemMonto[]) =>
  redondear(items.reduce((suma, item) => suma + descuentoItem(item), 0))

// 10 -> "10", 12.5 -> "12,5"
export function formatoPct(p: number): string {
  return String(Math.round(p * 100) / 100).replace('.', ',')
}

// Texto del porcentaje para la línea de bonificación: " (9%)".
// Con 1% o más se muestra entero; por debajo se muestran decimales.
export function textoPorcentaje(
  descuento: number,
  subtotal: number
): string {
  if (subtotal <= 0 || descuento <= 0) return ''

  const pct = (descuento / subtotal) * 100

  if (pct >= 1) return ` (${Math.round(pct)}%)`

  const redondeado = Math.round(pct * 100) / 100

  if (redondeado <= 0) return ' (<0,01%)'

  return ` (${String(redondeado).replace('.', ',')}%)`
}

export type GrupoItems = {
  clave: 'dispositivos' | 'mano_obra' | 'otros'
  titulo: string
  items: ItemPresupuesto[]
  // Subtotal a precio de lista (sin descuentos).
  subtotal: number
}

// Agrupa en el mismo orden en todas las vistas.
export function agruparItems(items: ItemPresupuesto[]): GrupoItems[] {
  const grupos: GrupoItems[] = [
    {
      clave: 'dispositivos',
      titulo: 'Dispositivos y materiales',
      items: [],
      subtotal: 0,
    },
    {
      clave: 'mano_obra',
      titulo: 'Mano de obra e instalación',
      items: [],
      subtotal: 0,
    },
    {
      clave: 'otros',
      titulo: 'Otros conceptos',
      items: [],
      subtotal: 0,
    },
  ]

  for (const item of items) {
    const tipo = (item.tipo || 'otro').trim().toLowerCase()

    const grupo =
      tipo === 'producto' || tipo === 'material'
        ? grupos[0]
        : tipo === 'servicio' || tipo === 'mano_obra'
          ? grupos[1]
          : grupos[2]

    grupo.items.push(item)
    grupo.subtotal += importeBruto(item)
  }

  return grupos.filter((grupo) => grupo.items.length > 0)
}

// Separa "Nombre — descripción" (así se arma al elegir del catálogo)
// para mostrar el nombre destacado y la descripción debajo.
export function partirDescripcion(texto: string): {
  titulo: string
  detalle: string
} {
  const t = (texto ?? '').trim()

  const indice = t.indexOf(' — ')

  if (indice > 0) {
    return {
      titulo: t.slice(0, indice).trim(),
      detalle: t.slice(indice + 3).trim(),
    }
  }

  const salto = t.indexOf('\n')

  if (salto > 0) {
    return {
      titulo: t.slice(0, salto).trim(),
      detalle: t.slice(salto + 1).trim(),
    }
  }

  return { titulo: t, detalle: '' }
}
