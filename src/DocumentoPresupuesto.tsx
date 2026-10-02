import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import logo from './assets/mova-logo.jpg'
import { moneda, fechaCorta } from './gestionFormat'
import { configActual, lineaContacto, textoCondicion } from './config'
import { textoMedios } from './formasPago'
import { COLOR_MARCA_HEX, agruparPorTipo, completarDatosDocumento, lineasRecomendaciones, type DatosPdf } from './pdfPresupuesto'
import { formatoPct, importeBruto, importeNeto, partirDescripcion, pctItem } from './presupuestoCalculos'
import { antesYAhora, etiquetaModificacion } from './presupuestoModificaciones'
import { mensajeEstado, PCT_ANTICIPO, totalAPagarHoy, type EstadoPresupuesto, type PasoLinea } from './estadoObra'
import { codigoPresupuesto } from './codigoPresupuesto'
import { supabase } from './supabase'

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
          <div key={c.e} style={{ ...s.tarjeta, borderRadius: '13px', padding: '12px 14px', ...(fondo ? { background: fondo, borderColor: fondo } : {}) }}>
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
const diaMes = (f: string) => fechaCorta(f).replace(/\/\d{4}$/, '')

// Franja destacada: los pasos de pago unidos de izquierda a derecha.
function FranjaLinea({ e }: { e: EstadoPresupuesto }) {
  const pasos: PasoLinea[] = e.linea.length > 6 ? [e.linea[0], ...e.linea.slice(-5)] : e.linea
  const color = (p: PasoLinea) => (p.estado === 'ok' ? VERDE : p.estado === 'pendiente' ? NARANJA : '#DADDE2')
  const pct = e.totalActualizado > 0 ? Math.min(100, (e.cobrado / e.totalActualizado) * 100) : 0
  return (
    <div style={{ background: AVISO_FONDO, border: `1px solid ${AVISO_BORDE}`, borderRadius: '14px', padding: '16px 10px 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${pasos.length}, minmax(0, 1fr))` }}>
        {pasos.map((p, i) => (
          <div key={`${p.tipo}-${i}`} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '0 3px' }}>
            {i > 0 && <span style={{ position: 'absolute', top: '11px', right: '50%', width: '100%', height: '3px', background: p.estado === 'futuro' ? '#DADDE2' : color(p) }} />}
            <span style={{ background: '#fff', borderRadius: '50%', padding: '2px', position: 'relative', zIndex: 1, margin: '-2px 0 0' }}><Icono estado={p.estado} tam={22} /></span>
            <strong style={{ color: OSCURO, fontSize: '12px', marginTop: '8px', lineHeight: 1.2 }}>{p.tipo === 'anticipo' ? `Anticipo ${PCT_ANTICIPO}%` : p.tipo === 'final' ? (e.terminada ? 'Obra finalizada' : 'Al finalizar') : `Avance ${p.porcentaje ?? 0}%`}</strong>
            <span style={{ fontSize: '10.5px', color: GRIS }}>{p.tipo === 'avance' && p.fecha ? diaMes(p.fecha) : p.tipo === 'anticipo' ? 'Al confirmar' : e.terminada ? '' : 'Saldo final'}</span>
            <strong style={{ color: OSCURO, fontSize: '11.5px', marginTop: '3px', overflowWrap: 'anywhere' }}>{p.tipo === 'anticipo' ? moneda(p.importe) : `+ ${moneda(p.importe)}`}</strong>
            <span style={{ fontSize: '10.5px', fontWeight: 700, color: p.estado === 'ok' ? VERDE : p.estado === 'futuro' ? GRIS : NARANJA_OSC, overflowWrap: 'anywhere' }}>{p.estado === 'ok' ? (p.tipo === 'anticipo' ? 'Pagado' : 'Al día') : p.estado === 'futuro' ? 'Pendiente' : `Falta ${moneda(p.falta)}`}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '14px', padding: '0 4px', fontSize: '12px', fontWeight: 700 }}>
        <span style={{ color: OSCURO }}>Pagado {moneda(e.cobrado)} de {moneda(e.totalActualizado)}</span>
        <Barra pct={pct} color={VERDE} />
        <span style={{ color: e.pendienteHoy > 0.5 ? NARANJA_OSC : VERDE }}>{e.pendienteHoy > 0.5 ? `A pagar hoy (obra): ${moneda(e.pendienteHoy)}` : 'Obra al día'}</span>
      </div>
      {e.linea.length > pasos.length && <div style={{ ...s.chico, fontSize: '10.5px', padding: '4px 4px 0' }}>Se muestran el anticipo y los últimos {pasos.length - 1} avances.</div>}
    </div>
  )
}

function EstadoCuenta({ e }: { e: EstadoPresupuesto }) {
  const msg = mensajeEstado(e, moneda)
  const hoy = totalAPagarHoy(e)
  const nPend = e.gastosExtra.filter((g) => !g.devuelto).length
  const ok = msg.tono === 'ok'
  return <>
    <Seccion texto="Estado de cuenta">
      <Tarjetas cifras={[
        { e: 'Pendiente de la obra', v: moneda(e.pendienteHoy), s: `Según el avance (${e.avance}%)`, color: e.pendienteHoy > 0.5 ? OSCURO : VERDE },
        { e: 'Gastos a reintegrar', v: moneda(e.gastoExtraPendiente), s: nPend ? `${nPend} ${nPend === 1 ? 'gasto pendiente' : 'gastos pendientes'}` : 'Sin gastos pendientes' },
        hoy > 0.5
          ? { e: 'Total a pagar hoy', v: moneda(hoy), s: e.gastoExtraPendiente > 0.5 ? 'Obra + gastos' : 'Según el avance', destacada: 'naranja' }
          : { e: 'Total a pagar hoy', v: moneda(0), s: 'Estás al día', destacada: 'verde' },
      ]} />
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: ok ? VERDE_SUAVE : AVISO_FONDO, border: `1px solid ${ok ? '#C7E3D4' : AVISO_BORDE}`, borderRadius: '11px', padding: '11px 13px', marginTop: '12px', color: ok ? VERDE : '#7A4A07' }}>
        <Icono estado={ok ? 'ok' : 'pendiente'} tam={20} />
        <div><strong style={{ color: ok ? VERDE : NARANJA_OSC }}>{msg.titulo}.</strong> {msg.detalle}</div>
      </div>
    </Seccion>

    <Seccion texto="Línea de tiempo de pagos">
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
    { e: 'Condiciones', n: `Seña ${PCT_ANTICIPO}%`, l: ['Saldo al finalizar', `Validez ${validez} ${validez === 1 ? 'día' : 'días'}`] },
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '12px 0 0', fontSize: '12px' }}>
            <span>Avance de la obra <strong style={{ color: OSCURO }}>{e.avance}%</strong></span>
            <Barra pct={e.avance} />
            <span style={{ color: GRIS }}>{e.avances.length ? `Último informe ${diaMes(e.avances[e.avances.length - 1].fecha)} · ${e.avances[e.avances.length - 1].titulo}` : 'Sin informes de avance todavía'}</span>
          </div>
        </> : (
          <Tarjetas cifras={[
            { e: 'Total del presupuesto', v: moneda(Number(d.total)), s: 'Precio final', destacada: 'naranja' },
            { e: `Seña para confirmar (${PCT_ANTICIPO}%)`, v: moneda(Math.round(Number(d.total) * PCT_ANTICIPO) / 100), s: 'Reserva la fecha y los materiales' },
            { e: 'Válido hasta', v: venceEl, s: `${validez} ${validez === 1 ? 'día' : 'días'} desde la emisión` },
          ]} />
        )}
      </div>

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
        {grupos.length === 0 ? <p style={{ color: GRIS }}>Sin ítems.</p> : grupos.map((g) => (
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
                      {pct > 0 && <span style={{ display: 'inline-block', marginLeft: '5px', background: NARANJA_SUAVE, color: NARANJA_OSC, fontWeight: 700, borderRadius: '999px', padding: '0 7px', fontSize: '11px' }}>−{formatoPct(pct)}%</span>}
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
                <strong style={{ color: OSCURO, fontSize: '12.5px' }}>{c.titulo}</strong>
                <p style={{ margin: '2px 0 0', fontSize: '11.5px', lineHeight: 1.5 }}>{textoCondicion(c, d.validez_dias)}</p>
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
