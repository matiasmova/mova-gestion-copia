import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import logo from './assets/mova-logo.jpg'
import { moneda, fechaCorta } from './gestionFormat'
import { configActual, lineaContacto, textoCondicion } from './config'
import { textoMedios } from './formasPago'
import { COLOR_MARCA_HEX, agruparPorTipo, completarDatosDocumento, lineasRecomendaciones, type DatosPdf } from './pdfPresupuesto'
import { formatoPct, importeBruto, importeNeto, partirDescripcion, pctItem } from './presupuestoCalculos'
import { antesYAhora, etiquetaModificacion } from './presupuestoModificaciones'
import { mensajeEstado, PCT_ANTICIPO, totalAPagarHoy, type EstadoPresupuesto } from './estadoObra'
import { codigoPresupuesto } from './codigoPresupuesto'
import { incluyeDe, partesConItems, totalItems } from './resumenDocumento'
import { supabase } from './supabase'
import { estadoLinkPago, urlPago } from './pagoLink'

// Documento del presupuesto en pantalla (ficha, vista previa y estado de obra).
// Mismo contenido y diseño que el PDF (pdfPresupuesto.ts), en HTML directo.

type Props = {
  datos: DatosPdf
  embebido?: boolean
  // Ya no se usa (antes se mostraba el PDF en un visor). Se acepta para no romper llamadas.
  archivoUrl?: string
}

// Paleta (igual que el PDF)
const NARANJA = COLOR_MARCA_HEX
const NARANJA_SUAVE = '#FFEEDD'
const NARANJA_OSC = '#A85008'
const AVISO_FONDO = '#FFF6EC'
const AVISO_BORDE = '#F6D6B3'
const OSCURO = '#14181E'
const TEXTO = '#5B6270'
const GRIS = '#8A93A0'
const LINEA = '#E8EAEE'
const LINEA_SUAVE = '#F1F2F4'
const VERDE = '#23764E'
const VERDE_SUAVE = '#E8F5EE'
const VERDE_CLARO = '#7FD1A3'

const base: CSSProperties = { background: '#fff', color: TEXTO, fontFamily: 'Helvetica, Arial, sans-serif', fontSize: '13.5px', lineHeight: 1.45, minWidth: 0 }
const s: Record<string, CSSProperties> = {
  documento: { ...base, border: `1px solid ${LINEA}`, borderRadius: '14px', padding: 'clamp(16px, 4vw, 40px)', marginTop: '20px' },
  embebido: base,
  et: { fontSize: '10px', fontWeight: 700, letterSpacing: '1.3px', textTransform: 'uppercase', color: GRIS },
  tarjeta: { border: `1px solid ${LINEA}`, borderRadius: '11px', padding: '11px 13px', minWidth: 0, background: '#fff' },
  fila: { display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '11px 2px', borderBottom: `1px solid ${LINEA_SUAVE}` },
  chico: { fontSize: '12px', color: GRIS },
}

function Seccion({ texto, children, mt = 28 }: { texto: string; children: ReactNode; mt?: number }) {
  return (
    <section style={{ marginTop: `${mt}px` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '0 0 10px' }}>
        <span style={{ fontSize: '11.5px', fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: OSCURO, whiteSpace: 'nowrap' }}>{texto}</span>
        <span style={{ flex: 1, height: '1px', background: LINEA }} />
      </div>
      {children}
    </section>
  )
}

function Icono({ estado, tam = 22 }: { estado: 'ok' | 'pendiente' | 'futuro'; tam?: number }) {
  const fondo = estado === 'ok' ? VERDE : estado === 'pendiente' ? NARANJA : '#fff'
  return (
    <span style={{ flex: `0 0 ${tam}px`, width: `${tam}px`, height: `${tam}px`, borderRadius: '50%', background: fondo, border: estado === 'futuro' ? '1.6px solid #C4C9D1' : 'none', boxSizing: 'border-box', color: '#fff', display: 'grid', placeItems: 'center', fontSize: `${Math.round(tam / 2)}px`, fontWeight: 800, position: 'relative', zIndex: 1 }}>
      {estado === 'ok' ? '✓' : estado === 'pendiente' ? '!' : ''}
    </span>
  )
}

function Insignia({ n }: { n: number }) {
  return <span style={{ flex: '0 0 24px', width: '24px', height: '24px', borderRadius: '7px', background: NARANJA_SUAVE, color: NARANJA_OSC, fontWeight: 700, fontSize: '11px', display: 'grid', placeItems: 'center' }}>{String(n).padStart(2, '0')}</span>
}

// Tres tarjetas de cifras; la destacada va llena (naranja, o verde si está al día).
function Tarjetas({ cifras }: { cifras: { e: string; v: string; s?: string; destacada?: 'naranja' | 'verde'; color?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
      {cifras.map((c) => {
        const fondo = c.destacada === 'naranja' ? NARANJA : c.destacada === 'verde' ? VERDE : undefined
        return (
          <div key={c.e} className={c.destacada === 'naranja' ? 'tarjetaViva' : undefined} style={{ ...s.tarjeta, borderRadius: '13px', padding: '12px 14px', ...(fondo ? { background: fondo, borderColor: fondo } : {}) }}>
            <div style={{ ...s.et, color: fondo ? '#fff' : GRIS }}>{c.e}</div>
            <strong style={{ display: 'block', fontSize: 'clamp(18px, 5vw, 21px)', color: fondo ? '#fff' : c.color ?? OSCURO, marginTop: '4px', whiteSpace: 'nowrap' }}>{c.v}</strong>
            {c.s && <div style={{ fontSize: '11.5px', color: fondo ? '#fff' : GRIS, opacity: fondo ? 0.92 : 1, marginTop: '2px' }}>{c.s}</div>}
          </div>
        )
      })}
    </div>
  )
}

function Barra({ pct, color = NARANJA }: { pct: number; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: '60px', height: '6px', borderRadius: '9px', background: '#EEF0F3', overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', background: color, borderRadius: '9px' }} />
    </div>
  )
}

// Caja negra de totales.
function CajaNegra({ filas, etiqueta, total }: { filas: { t: string; v: string; verde?: boolean }[]; etiqueta: string; total: string }) {
  return (
    <div style={{ background: OSCURO, color: '#fff', borderRadius: '13px', padding: '14px 18px', minWidth: 0 }}>
      {filas.map((f) => (
        <div key={f.t} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontSize: '12.5px', color: f.verde ? VERDE_CLARO : '#C9CED6', padding: '2px 0' }}><span>{f.t}</span><span style={{ whiteSpace: 'nowrap' }}>{f.v}</span></div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', ...(filas.length ? { borderTop: '1px solid #39404B', marginTop: '8px', paddingTop: '10px' } : {}) }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.6px' }}>{etiqueta}</span>
        <strong style={{ fontSize: 'clamp(19px, 5.4vw, 23px)', whiteSpace: 'nowrap' }}>{total}</strong>
      </div>
    </div>
  )
}

// Abre el comprobante de un gasto (link temporal del archivo guardado).
async function verComprobante(ruta: string) {
  const { data, error } = await supabase.storage.from('comprobantes').createSignedUrl(ruta, 600)
  if (error || !data?.signedUrl) { window.alert('No se pudo abrir el comprobante.'); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

const conSigno = (n: number) => (n < 0 ? `− ${moneda(Math.abs(n))}` : `+ ${moneda(n)}`)

// Línea de pagos en plata, de $ 0 al total: seña · por avance (hoy) · al terminar.
function FranjaLinea({ e }: { e: EstadoPresupuesto }) {
  const total = Math.max(1, e.totalActualizado)
  const porAvance = Math.max(0, e.corresponde - e.anticipo)
  const restoFinal = Math.max(0, e.totalActualizado - e.corresponde)
  const faltaSena = Math.max(0, e.anticipo - e.cobrado)
  const pctDe = (n: number) => `${Math.max(0, Math.min(100, (n / total) * 100))}%`
  const pasos = [
    { e: `1 · Seña ${PCT_ANTICIPO}%`, v: moneda(e.anticipo), s: faltaSena > 0.5 ? `Falta ${moneda(faltaSena)}` : 'Pagada', c: NARANJA, t: faltaSena > 0.5 ? NARANJA_OSC : VERDE },
    { e: '2 · Por avance (hoy)', v: `+ ${moneda(porAvance)}`, s: porAvance > 0.5 ? 'lo hecho supera la seña' : `hecho ${moneda(e.trabajoHecho)}: lo cubre la seña`, c: '#F2A65E', t: GRIS },
    { e: e.terminada ? '3 · Obra finalizada' : '3 · Al terminar', v: `+ ${moneda(restoFinal)}`, s: e.terminada ? 'Obra terminada' : 'El resto, con la obra al 100%', c: '#DADDE2', t: GRIS },
  ]
  return (
    <div>
      <div style={{ position: 'relative', paddingTop: '20px' }}>
        <span style={{ position: 'absolute', top: 0, left: pctDe(e.cobrado), transform: 'translateX(-50%)', fontSize: '10.5px', fontWeight: 800, color: VERDE, whiteSpace: 'nowrap' }}>Pagado {moneda(e.cobrado)}</span>
        <div style={{ display: 'flex', height: '14px', borderRadius: '8px', overflow: 'hidden', background: '#E8EBEF' }}>
          <i style={{ width: pctDe(e.anticipo), background: NARANJA }} />
          <i style={{ width: pctDe(porAvance), background: '#F2A65E' }} />
        </div>
        <span style={{ position: 'absolute', left: pctDe(e.cobrado), top: '15px', width: '2px', height: '24px', background: VERDE, transform: 'translateX(-50%)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: GRIS, marginTop: '4px' }}><span>$ 0</span><strong>100% = {moneda(e.totalActualizado)}</strong></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', marginTop: '10px' }}>
        {pasos.map((p) => (
          <div key={p.e} style={{ background: '#F7F8FA', borderRadius: '10px', padding: '10px 12px', boxShadow: `inset 3px 0 0 ${p.c}`, minWidth: 0 }}>
            <div style={{ fontSize: '9.5px', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: GRIS }}>{p.e}</div>
            <strong style={{ display: 'block', color: OSCURO, fontSize: '15px', overflowWrap: 'anywhere' }}>{p.v}</strong>
            <span style={{ fontSize: '11px', fontWeight: 700, color: p.t }}>{p.s}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Detalle por ítem: cuánto avanzó cada uno y lo que suma hoy.
function DetalleAvance({ e }: { e: EstadoPresupuesto }) {
  const det = e.detalleAvance ?? []
  const suma = det.reduce((t, x) => t + x.hecho, 0)
  const th = { fontSize: '9.5px', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' as const, color: GRIS, textAlign: 'left' as const, padding: '0 6px 6px', borderBottom: '1px solid #E8EBEF' }
  const td = { padding: '8px 6px', borderBottom: '1px solid #F1F3F5', verticalAlign: 'middle' as const }
  return <>
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
        <thead><tr><th style={th}>Ítem</th><th style={{ ...th, textAlign: 'right' }}>Valor</th><th style={th}>Avance</th><th style={{ ...th, textAlign: 'right' }}>Hecho</th></tr></thead>
        <tbody>
          {det.map((it) => {
            const fin = it.avance >= 100
            const porUnidad = it.cantidad > 1 && Number.isInteger(it.cantidad) && it.cantidad <= 50
            const tAv = fin ? '✓ Terminado' : porUnidad ? `${Math.round(it.cantidad * it.avance / 100)} de ${it.cantidad}` : `${Math.round(it.avance)}%`
            return <tr key={it.id}>
              <td style={{ ...td, fontWeight: 700, color: OSCURO }}>{it.descripcion}</td>
              <td style={{ ...td, textAlign: 'right', color: GRIS, whiteSpace: 'nowrap' }}>{moneda(it.valor)}</td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 700, fontSize: '11.5px', color: fin ? VERDE : it.avance > 0 ? NARANJA_OSC : GRIS }}><span style={{ display: 'inline-flex', width: '60px', marginRight: '2px' }}><Barra pct={it.avance} color={fin ? VERDE : NARANJA} /></span>{tAv}</span></td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: it.hecho > 0.5 ? OSCURO : GRIS, whiteSpace: 'nowrap' }}>{moneda(it.hecho)}</td>
            </tr>
          })}
        </tbody>
        <tfoot><tr><td style={{ ...td, borderBottom: 0, fontWeight: 800, color: OSCURO }} colSpan={3}>Trabajo hecho</td><td style={{ ...td, borderBottom: 0, textAlign: 'right', fontWeight: 800, color: OSCURO, whiteSpace: 'nowrap' }}>{moneda(suma)}</td></tr></tfoot>
      </table>
    </div>
    <p style={{ ...s.chico, margin: '6px 0 0' }}>La seña ({moneda(e.anticipo)}) cubre el trabajo hasta ese monto. Cuando lo hecho la supera, se paga la diferencia, hasta completar el total del trabajo.</p>
  </>
}

// Antes de aceptar: cómo se va a pagar (seña hoy, el resto según avance, el final).
function PlanPagos({ total }: { total: number }) {
  const sena = Math.round(total * PCT_ANTICIPO) / 100
  const resto = Math.max(0, Math.round((total - sena) * 100) / 100)
  const pasos: { estado: 'pendiente' | 'futuro'; t: string; sub: string; monto: string; est: string }[] = [
    { estado: 'pendiente', t: `Seña ${PCT_ANTICIPO}%`, sub: 'Hoy, para aceptar', monto: moneda(sena), est: 'Pagás ahora' },
    { estado: 'futuro', t: 'Durante la obra', sub: 'Según el avance', monto: `+ hasta ${moneda(resto)}`, est: 'Más adelante' },
    { estado: 'futuro', t: 'Al finalizar', sub: 'Se completa el 100%', monto: `Total ${moneda(total)}`, est: 'Más adelante' },
  ]
  return (
    <div style={{ background: AVISO_FONDO, border: `1px solid ${AVISO_BORDE}`, borderRadius: '14px', padding: '16px 10px 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {pasos.map((p, i) => (
          <div key={i} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '0 3px' }}>
            {i > 0 && <span style={{ position: 'absolute', top: '11px', right: '50%', width: '100%', height: '3px', background: '#DADDE2' }} />}
            <span style={{ background: '#fff', borderRadius: '50%', padding: '2px', position: 'relative', zIndex: 1, margin: '-2px 0 0' }}><Icono estado={p.estado} tam={22} /></span>
            <strong style={{ color: OSCURO, fontSize: '12px', marginTop: '8px', lineHeight: 1.2 }}>{p.t}</strong>
            <span style={{ fontSize: '10.5px', color: GRIS }}>{p.sub}</span>
            <strong style={{ color: OSCURO, fontSize: '11.5px', marginTop: '3px', overflowWrap: 'anywhere' }}>{p.monto}</strong>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: p.estado === 'pendiente' ? NARANJA_OSC : GRIS }}>{p.est}</span>
          </div>
        ))}
      </div>
      <p style={{ margin: '12px 4px 0', fontSize: '12.5px', lineHeight: 1.5, color: '#7A4A07' }}>
        <strong>Hoy pagás la seña del {PCT_ANTICIPO}% ({moneda(sena)})</strong> para aceptar el presupuesto y reservar la fecha y los materiales. El {100 - PCT_ANTICIPO}% restante ({moneda(resto)}) se paga a medida que avanza la obra, hasta completar el total.
      </p>
    </div>
  )
}

function EstadoCuenta({ e }: { e: EstadoPresupuesto }) {
  const msg = mensajeEstado(e, moneda)
  const hoy = totalAPagarHoy(e)
  const nPend = e.gastosExtra.filter((g) => !g.devuelto).length
  const ok = msg.tono === 'ok'
  return <>
    <Seccion texto="Cuánto corresponde hoy">
      <Tarjetas cifras={[
        { e: `Seña ${PCT_ANTICIPO}%`, v: moneda(e.anticipo), s: 'Al confirmar el trabajo' },
        { e: 'Trabajo hecho', v: moneda(e.trabajoHecho), s: e.corresponde > e.anticipo + 0.5 ? `Supera la seña en ${moneda(e.corresponde - e.anticipo)}` : `Obra al ${e.avance}% · lo cubre la seña` },
        hoy > 0.5
          ? { e: 'A pagar hoy', v: moneda(hoy), s: `Ya pagaste ${moneda(e.cobrado)}`, destacada: 'naranja' }
          : { e: 'A pagar hoy', v: moneda(0), s: 'Estás al día', destacada: 'verde' },
      ]} />
      {e.gastoExtraPendiente > 0.5 && <p style={{ ...s.chico, margin: '6px 0 0' }}>Incluye {moneda(e.gastoExtraPendiente)} de gastos a reintegrar ({nPend} {nPend === 1 ? 'gasto' : 'gastos'}, detalle más abajo).</p>}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: ok ? VERDE_SUAVE : AVISO_FONDO, border: `1px solid ${ok ? '#C7E3D4' : AVISO_BORDE}`, borderRadius: '11px', padding: '11px 13px', marginTop: '12px', color: ok ? VERDE : '#7A4A07' }}>
        <Icono estado={ok ? 'ok' : 'pendiente'} tam={20} />
        <div><strong style={{ color: ok ? VERDE : NARANJA_OSC }}>{msg.titulo}.</strong> {msg.detalle}</div>
      </div>
    </Seccion>

    {e.detalleAvance && e.detalleAvance.length > 0 && <Seccion texto="Detalle del avance"><DetalleAvance e={e} /></Seccion>}

    <Seccion texto="Línea de pagos">
      <FranjaLinea e={e} />
    </Seccion>

    {e.gastosExtra.length > 0 && (
      <Seccion texto="Gastos a reintegrar">
        <p style={{ ...s.chico, margin: '0 0 4px' }}>Materiales que compramos para tu obra y nos devolvés aparte del presupuesto. Los pendientes se suman al total a pagar; los ya reintegrados, no.</p>
        {e.gastosExtra.map((g) => (
          <div key={g.id} style={{ ...s.fila, alignItems: 'center' }}>
            <Icono estado={g.devuelto ? 'ok' : 'pendiente'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{g.descripcion}</strong>
              <div style={s.chico}>{fechaCorta(g.fecha)}</div>
              {g.comprobante && <button type="button" onClick={() => void verComprobante(g.comprobante!)} style={{ marginTop: '4px', border: 0, background: NARANJA, color: '#fff', borderRadius: '6px', padding: '4px 9px', fontSize: '11.5px', fontWeight: 700, cursor: 'pointer' }}>⬇ Ver comprobante</button>}
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <strong style={{ color: OSCURO }}>{moneda(g.importe)}</strong>
              <div style={{ fontSize: '12px', fontWeight: 700, color: g.devuelto ? VERDE : NARANJA_OSC }}>{g.devuelto ? 'Reintegrado' : 'Pendiente'}</div>
              <div style={{ ...s.chico, fontSize: '11px' }}>{g.devuelto ? 'no suma' : 'suma al total'}</div>
            </div>
          </div>
        ))}
        {e.gastoExtraPendiente > 0.5 && <div style={{ textAlign: 'right', marginTop: '8px', fontWeight: 700, color: NARANJA_OSC }}>Pendiente de reintegro {moneda(e.gastoExtraPendiente)}</div>}
      </Seccion>
    )}
  </>
}

export default function DocumentoPresupuesto({ datos, embebido = false }: Props) {
  const [completos, setCompletos] = useState<DatosPdf | null>(null)
  // Botón "Pagar ahora": el mismo link de pago que va en el PDF (si está activo).
  const [linkPago, setLinkPago] = useState<string | null>(null)
  useEffect(() => {
    let vigente = true
    void estadoLinkPago(datos.id).then((l) => { if (vigente) setLinkPago(l && l.activo ? urlPago(l.token) : null) })
    return () => { vigente = false }
  }, [datos])
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    setError('')
    completarDatosDocumento(datos)
      .then((d) => { if (vigente) setCompletos(d) })
      .catch((e) => { console.error(e); if (vigente) setError('No se pudo cargar el estado completo del presupuesto. Cerrá y volvé a abrir para reintentar.') })
    return () => { vigente = false }
  }, [datos])

  if (error) return <p role="alert">{error}</p>
  if (!completos) return <p role="status" style={{ color: GRIS }}>Cargando documento…</p>

  const d = completos
  const e = d.estado ?? null
  const contacto = d.contacto ?? null
  const soluciones = d.soluciones ?? []
  const codigo = codigoPresupuesto(d.id)
  const grupos = agruparPorTipo(d.items)
  const resumido = d.resumenDoc?.modo === 'resumido' ? d.resumenDoc : null
  const notas = (d.notas ?? '').trim()
  const recos = lineasRecomendaciones(d.recomendaciones)
  const hayObra = !!d.obra && d.obra !== 'Sin obra asociada'
  const sumaNeta = d.items.reduce((acc, it) => acc + importeNeto(it), 0)
  const sumaBruta = d.items.reduce((acc, it) => acc + importeBruto(it), 0)
  const ahorro = Math.round((sumaBruta - Number(d.total)) * 100) / 100
  const validez = d.validez_dias ?? configActual().presupuestos.validezDias
  const venceEl = fechaCorta(new Date(new Date(`${d.fecha.slice(0, 10)}T12:00:00`).getTime() + validez * 86400000).toISOString().slice(0, 10))
  const aPagarHoy = e ? totalAPagarHoy(e) : 0
  const condiciones = configActual().presupuestos.condiciones.filter((c) => c.titulo.trim() || c.texto.trim())
  let numero = 0

  const partes = [
    { e: 'Cliente', n: d.cliente, l: [contacto?.telefono ? `Tel. ${contacto.telefono}` : null, contacto?.email ?? null, contacto?.documento ? `${contacto.documento.etiqueta}: ${contacto.documento.valor}` : null, contacto?.direccionCliente ?? null] },
    { e: hayObra ? 'Obra' : 'Presupuesto', n: hayObra ? d.obra : codigo, l: [hayObra ? (contacto?.direccionObra || contacto?.direccionCliente || null) : null, e ? (e.terminada ? 'Obra finalizada' : e.enObra ? `En obra · avance ${e.avance}%` : 'Presupuesto aceptado') : `Válido hasta el ${venceEl}`] },
    { e: 'Condiciones', n: `Seña ${PCT_ANTICIPO}%`, l: ['Resto según avance', `Validez ${validez} ${validez === 1 ? 'día' : 'días'}`] },
  ]

  return (
    <div style={embebido ? s.embebido : s.documento}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <img src={logo} alt="MOVA Tecnología Smart" style={{ width: '160px', maxWidth: '100%', height: 'auto', objectFit: 'contain' }} />
        <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
          <div style={{ color: NARANJA, fontWeight: 700, fontSize: '10px', letterSpacing: '1.8px' }}>{e ? 'PRESUPUESTO Y ESTADO DE OBRA' : 'PRESUPUESTO'}</div>
          <div style={{ color: OSCURO, fontWeight: 700, fontSize: '23px', lineHeight: 1.2, margin: '2px 0' }}>{codigo}</div>
          <div style={s.chico}>Emitido {fechaCorta(d.fecha)} · {e ? `Actualizado ${fechaCorta(e.ultimaActualizacion)}` : `Válido hasta ${venceEl}`}</div>
        </div>
      </div>
      <div style={{ height: '3px', borderRadius: '2px', background: `linear-gradient(90deg, ${NARANJA} 0 18%, #EEF0F3 18%)`, margin: '14px 0 18px' }} />

      {/* Cliente / obra / condiciones */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
        {partes.map((p) => (
          <div key={p.e} style={s.tarjeta}>
            <div style={s.et}>{p.e}</div>
            <strong style={{ display: 'block', color: OSCURO, fontSize: '14.5px', margin: '3px 0 2px', overflowWrap: 'anywhere' }}>{p.n}</strong>
            {p.l.filter(Boolean).map((x) => <div key={x} style={{ fontSize: '12px', overflowWrap: 'anywhere' }}>{x}</div>)}
          </div>
        ))}
      </div>

      {/* Título */}
      <h3 style={{ fontSize: '22px', fontWeight: 700, color: OSCURO, margin: '22px 0 3px', overflowWrap: 'anywhere' }}>{d.titulo}</h3>
      {d.descripcion && <p style={{ color: GRIS, margin: 0, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{d.descripcion}</p>}

      {/* Cifras principales */}
      <div style={{ marginTop: '16px' }}>
        {e ? <>
          <Tarjetas cifras={[
            { e: 'Total de la obra', v: moneda(e.totalActualizado), s: e.modificaciones.length ? 'Con modificaciones' : 'Presupuesto aceptado' },
            { e: 'Ya pagaste', v: moneda(e.cobrado), s: `${e.totalActualizado > 0 ? Math.round(Math.min(1, e.cobrado / e.totalActualizado) * 100) : 0}% del total`, color: e.cobrado > 0 ? VERDE : OSCURO },
            aPagarHoy > 0.5
              ? { e: 'A pagar hoy', v: moneda(aPagarHoy), s: e.gastoExtraPendiente > 0.5 ? 'Obra + gastos a reintegrar' : 'Según el avance de la obra', destacada: 'naranja' }
              : { e: 'A pagar hoy', v: moneda(0), s: 'Estás al día', destacada: 'verde' },
          ]} />
        </> : (
          <Tarjetas cifras={[
            { e: 'Total del presupuesto', v: moneda(Number(d.total)), s: 'Precio final', destacada: 'naranja' },
            { e: `Seña para confirmar (${PCT_ANTICIPO}%)`, v: moneda(Math.round(Number(d.total) * PCT_ANTICIPO) / 100), s: 'Reserva la fecha y los materiales' },
            { e: 'Válido hasta', v: venceEl, s: `${validez} ${validez === 1 ? 'día' : 'días'} desde la emisión` },
          ]} />
        )}
      </div>
      {linkPago && (!e || aPagarHoy > 0.5) && (
        <a href={linkPago} target="_blank" rel="noreferrer" className="docPagarAhora">
          <span className="ico">$</span>
          <span className="txt"><b>{e ? 'PAGAR AHORA' : `PAGAR LA SEÑA (${PCT_ANTICIPO}%)`}</b><small>{e ? 'Tocá acá · transferencia o efectivo' : 'Para aceptar el presupuesto · transferencia o efectivo'}</small></span>
          <span className="pill">{moneda(e ? aPagarHoy : Math.round(Number(d.total) * PCT_ANTICIPO) / 100)} ›</span>
        </a>
      )}
      {!e && Number(d.total) > 0 && (
        <Seccion texto="Cómo se paga">
          <PlanPagos total={Number(d.total)} />
        </Seccion>
      )}

      {/* Qué vas a disfrutar */}
      {soluciones.length > 0 && (
        <Seccion texto="Qué vas a disfrutar">
          {soluciones.map((sol) => (
            <div key={sol.titulo} style={{ ...s.tarjeta, display: 'flex', gap: '10px', marginBottom: '8px' }}>
              <Icono estado="ok" tam={20} />
              <div><strong style={{ color: OSCURO }}>{sol.titulo}</strong><div style={{ fontSize: '12.5px', lineHeight: 1.55, whiteSpace: 'pre-line' }}>{sol.descripcion}</div></div>
            </div>
          ))}
        </Seccion>
      )}

      {/* Ítems */}
      <Seccion texto={e ? 'Presupuesto aceptado' : 'Detalle del presupuesto'}>
        {grupos.length > 0 && resumido && grupos.map((g) => {
          // Resumido: un texto por parte y el total de la sección, sin precio por ítem.
          const partes = partesConItems(resumido, g.clave, g.items, d.items).filter((p) => p.items.length)
          return (
            <div key={`r-${g.clave}`} style={{ padding: '8px 2px 12px', borderBottom: `1px solid ${LINEA_SUAVE}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                <span style={{ color: NARANJA, fontWeight: 700, fontSize: '10px', letterSpacing: '1.4px', textTransform: 'uppercase' }}>{g.titulo}</span>
                {resumido.subtotales && <strong style={{ color: OSCURO, fontSize: '14px', whiteSpace: 'nowrap' }}>{moneda(totalItems(g.items))}</strong>}
              </div>
              {partes.map((p) => (
                <div key={p.id} style={{ marginTop: '8px' }}>
                  {partes.length > 1 && p.nombre.trim() && <strong style={{ display: 'block', color: OSCURO }}>{p.nombre}</strong>}
                  {p.texto.trim() && <div style={{ whiteSpace: 'pre-line', lineHeight: 1.55 }}>{p.texto.trim()}</div>}
                  {incluyeDe(p, resumido).length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={s.et}>Incluye</div>
                      <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {incluyeDe(p, resumido).map((t, i) => <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', color: OSCURO, fontSize: '13px' }}><Icono estado="ok" tam={14} /><span>{t}</span></li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })}
        {grupos.length === 0 ? <p style={{ color: GRIS }}>Sin ítems.</p> : !resumido && grupos.map((g) => (
          <div key={`g-${g.clave}`}>
            <div style={{ color: NARANJA, fontWeight: 700, fontSize: '10px', letterSpacing: '1.4px', textTransform: 'uppercase', padding: '8px 2px 0' }}>{g.titulo}</div>
            {g.items.map((it) => {
              numero++
              const { titulo, detalle } = partirDescripcion(it.descripcion)
              const pct = pctItem(it)
              return (
                <div key={`${g.clave}-${it.id ?? numero}`} style={s.fila}>
                  <Insignia n={numero} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{titulo}</strong>
                    {detalle && <div style={{ ...s.chico, whiteSpace: 'pre-line' }}>{detalle}</div>}
                    <div style={{ ...s.chico, marginTop: '2px' }}>
                      {Number(it.cantidad).toLocaleString('es-AR')} × {moneda(it.precio_unitario)}
                      {pct > 0 && <span style={{ display: 'inline-block', marginLeft: '5px', background: NARANJA_SUAVE, color: NARANJA_OSC, fontWeight: 700, borderRadius: '999px', padding: '0 7px', fontSize: '11px' }}>{formatoPct(pct)}% de descuento</span>}
                      {e?.avanceItems && it.id != null && e.avanceItems[it.id] != null && (() => { const av = Math.round(e.avanceItems[it.id]); return <span style={{ display: 'inline-block', marginLeft: '5px', background: av >= 100 ? '#E6F4EC' : '#EEF1F5', color: av >= 100 ? VERDE : '#4A5361', fontWeight: 700, borderRadius: '999px', padding: '0 7px', fontSize: '11px' }}>{av >= 100 ? '✓ Terminado' : `Avance ${av}%`}</span> })()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: OSCURO, fontSize: '14px' }}>{moneda(importeNeto(it))}</strong>
                    {pct > 0 && <div style={{ ...s.chico, fontSize: '11.5px', textDecoration: 'line-through' }}>{moneda(importeBruto(it))}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
        {/* Formas de pago + total */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginTop: '14px', alignItems: 'stretch' }}>
          {d.formasPago && d.formasPago.medios.length > 0 ? (
            <div style={{ ...s.tarjeta, borderRadius: '13px' }}>
              <div style={s.et}>Formas de pago</div>
              <strong style={{ display: 'block', color: OSCURO, marginTop: '4px' }}>{textoMedios(d.formasPago)}</strong>
              {d.formasPago.nota && <div style={{ fontSize: '12px', marginTop: '2px' }}>{d.formasPago.nota}</div>}
            </div>
          ) : <span />}
          <CajaNegra
            filas={ahorro > 0.5 ? [{ t: 'Subtotal', v: moneda(sumaBruta) }, { t: 'Te ahorrás (descuentos)', v: `− ${moneda(ahorro)}`, verde: true }]
              : Math.abs(sumaNeta - Number(d.total)) > 0.5 ? [{ t: 'Subtotal', v: moneda(sumaNeta) }, { t: 'Ajuste', v: conSigno(Number(d.total) - sumaNeta) }] : []}
            etiqueta={e ? 'TOTAL ACEPTADO' : 'TOTAL'}
            total={moneda(Number(d.total))}
          />
        </div>
      </Seccion>

      {/* Modificaciones */}
      {e && e.modificaciones.length > 0 && (
        <Seccion texto="Modificaciones durante la obra">
          <p style={{ ...s.chico, margin: '0 0 4px' }}>El presupuesto de arriba se mantiene tal como fue aceptado. Estos son los cambios registrados después:</p>
          {e.modificaciones.map((m) => {
            const { antes, ahora } = antesYAhora(m, moneda)
            return (
              <div key={m.id} style={s.fila}>
                <span style={{ flex: '0 0 24px', width: '24px', height: '24px', borderRadius: '7px', background: m.importe < 0 ? VERDE_SUAVE : NARANJA_SUAVE, color: m.importe < 0 ? VERDE : NARANJA_OSC, fontWeight: 800, display: 'grid', placeItems: 'center' }}>{m.importe < 0 ? '−' : '+'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{m.descripcion}</strong>
                  <div style={s.chico}>{fechaCorta(m.fecha)} · {etiquetaModificacion(m)}</div>
                  {antes && <div style={{ ...s.chico, overflowWrap: 'anywhere' }}>Antes: {antes}</div>}
                  {ahora && <div style={{ fontSize: '12px', overflowWrap: 'anywhere' }}>Ahora: {ahora}</div>}
                  {m.motivo && <div style={s.chico}>Motivo: {m.motivo}</div>}
                </div>
                <strong style={{ color: m.importe < 0 ? VERDE : OSCURO, whiteSpace: 'nowrap' }}>{m.importe === 0 ? moneda(0) : conSigno(m.importe)}</strong>
              </div>
            )
          })}
          <div style={{ marginLeft: 'auto', width: 'min(360px, 100%)', marginTop: '12px' }}>
            <CajaNegra filas={[{ t: 'Total original aceptado', v: moneda(e.totalOriginal) }, { t: 'Modificaciones', v: conSigno(e.totalCambios), verde: e.totalCambios < 0 }]} etiqueta="TOTAL ACTUALIZADO" total={moneda(e.totalActualizado)} />
          </div>
        </Seccion>
      )}

      {/* Pagos recibidos */}
      {e && (
        <Seccion texto="Pagos recibidos">
          {e.pagos.length === 0 ? <p style={{ color: GRIS, margin: 0 }}>Todavía no registramos pagos.</p> : <>
            {e.pagos.map((p) => (
              <div key={p.id} style={{ ...s.fila, alignItems: 'center' }}>
                <Icono estado="ok" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ color: OSCURO }}>Pago recibido{p.medio ? ` · ${p.medio.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}` : ''}</strong>
                  <div style={s.chico}>{fechaCorta(p.fecha)}{p.referencia ? ` · ${p.referencia}` : ''}</div>
                </div>
                <strong style={{ color: VERDE, whiteSpace: 'nowrap' }}>{moneda(p.monto)}</strong>
              </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: '8px', fontWeight: 700, color: VERDE }}>Total pagado {moneda(e.cobrado)}</div>
          </>}
        </Seccion>
      )}

      {e && <EstadoCuenta e={e} />}

      {recos.length > 0 && (
        <Seccion texto="Formas de uso y recomendaciones">
          <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.7 }}>
            {recos.map((r, i) => <li key={i} style={{ color: TEXTO }}>{r}</li>)}
          </ul>
        </Seccion>
      )}

      {notas && (
        <Seccion texto="Notas">
          <div style={{ background: '#F6F7F9', borderRadius: '11px', padding: '12px 14px', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{notas}</div>
        </Seccion>
      )}

      {condiciones.length > 0 && (
        <Seccion texto="Condiciones generales">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px 26px' }}>
            {condiciones.map((c, i) => (
              <div key={`${i}-${c.titulo}`}>
                <strong style={{ color: OSCURO, fontSize: '11.5px' }}>{c.titulo}</strong>
                <p style={{ margin: '2px 0 0', fontSize: '10.5px', lineHeight: 1.45 }}>{textoCondicion(c, d.validez_dias)}</p>
              </div>
            ))}
          </div>
        </Seccion>
      )}

      <footer style={{ marginTop: '28px', paddingTop: '10px', borderTop: `1px solid ${LINEA}`, position: 'relative', fontSize: '11px' }}>
        <span style={{ position: 'absolute', top: '-1px', left: 0, width: '40px', height: '2px', background: NARANJA }} />
        <strong style={{ color: OSCURO }}>{configActual().empresa.nombre}</strong>
        <div style={{ color: GRIS }}>{lineaContacto()}</div>
      </footer>
    </div>
  )
}
