import { configActual } from './config'

// Links de WhatsApp (wa.me) con el mensaje ya escrito. El número se normaliza
// al formato argentino para celulares: 54 9 + característica + número.
export function numeroWhatsApp(telefono: string | null | undefined): string | null {
  let d = (telefono || '').replace(/\D/g, '')
  if (d.length < 8) return null
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('54')) return d.startsWith('549') ? d : `549${d.slice(2)}`
  if (d.startsWith('0')) d = d.slice(1)
  // Quita el "15" de los celulares escritos a la antigua (ej.: 261 15 5557970).
  const m = /^(\d{2,4})15(\d{6,8})$/.exec(d)
  if (m && (m[1] + m[2]).length === 10) d = m[1] + m[2]
  return `549${d}`
}

export function linkWhatsApp(telefono: string | null | undefined, texto: string): string | null {
  const n = numeroWhatsApp(telefono)
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`
}

const primerNombre = (n: string) => n.trim().split(/\s+/)[0] || ''
const empresa = () => configActual().empresa.nombre || 'MOVA'

export function mensajeEnvioPresupuesto(o: { cliente: string; titulo: string; codigo: string; validezDias: number | null; linkPago?: string | null }) {
  return `¡Hola ${primerNombre(o.cliente)}! Te escribo de ${empresa()}. Te comparto el presupuesto "${o.titulo}" (${o.codigo})`
    + `${o.validezDias ? `, válido por ${o.validezDias} días` : ''}. Cualquier duda o ajuste que necesites, avisame.`
    + `${o.linkPago ? `\n\nPara confirmar con la seña podés pagar acá (transferencia o efectivo): ${o.linkPago}` : ''}\n\n¡Gracias!`
}

export function mensajeSeguimientoPresupuesto(o: { cliente: string; titulo: string; codigo: string; fecha: string; vencido: boolean }) {
  const base = `¡Hola ${primerNombre(o.cliente)}! ¿Cómo estás? Te escribo de ${empresa()} por el presupuesto "${o.titulo}" (${o.codigo}) que te enviamos el ${o.fecha}. ¿Pudiste verlo?`
  return o.vencido
    ? `${base} Ya pasó su validez, pero si te interesa lo actualizamos sin problema.`
    : `${base} Si tenés alguna duda o querés ajustar algo, lo vemos. ¡Quedo atento!`
}

export function mensajeEstadoObra(o: { cliente: string; obra: string; codigo: string; linkPago?: string | null }) {
  return `¡Hola ${primerNombre(o.cliente)}! Te escribo de ${empresa()}. Te comparto el presupuesto y estado actualizado de tu obra "${o.obra}" (${o.codigo}): ahí ves los avances, los pagos y lo que queda pendiente.`
    + `${o.linkPago ? `\n\nPodés pagar lo pendiente acá (transferencia o efectivo): ${o.linkPago}` : ''}\n\nCualquier duda, avisame. ¡Gracias!`
}
