import { useEffect, useState, type CSSProperties } from 'react'
import logo from './assets/mova-logo.jpg'
import { moneda, fechaCorta } from './gestionFormat'
import { configActual, lineaContacto, textoCondicion } from './config'
import { COLOR_MARCA_HEX, agruparPorTipo, completarDatosDocumento, type DatosPdf } from './pdfPresupuesto'
import { formatoPct, importeNeto, partirDescripcion, pctItem } from './presupuestoCalculos'
import { antesYAhora, etiquetaModificacion } from './presupuestoModificaciones'
import { mensajeEstado, PCT_ANTICIPO, type EstadoPresupuesto } from './estadoObra'
import { codigoPresupuesto } from './codigoPresupuesto'

// Documento del presupuesto en pantalla (ficha, vista previa y estado de obra).
// Mismo contenido y diseño que el PDF (pdfPresupuesto.ts), en HTML directo.

type Props = {
  datos: DatosPdf
  embebido?: boolean
  // Ya no se usa (antes se mostraba el PDF en un visor). Se acepta para no romper llamadas.
  archivoUrl?: string
}

const NARANJA = COLOR_MARCA_HEX
const NARANJA_SUAVE = '#FFF6EC'
const OSCURO = '#101318'
const TEXTO = '#333a45'
const GRIS = '#78828f'
const GRIS_CLARO = '#F6F7F9'
const LINEA = '#E6E8EC'
const VERDE = '#23764e'
const VERDE_SUAVE = '#ECF6F1'

const T_GRANDE = '22px'
const T_NORMAL = '13.5px'
const T_CHICO = '11px'

const base: CSSProperties = { background: '#fff', color: TEXTO, fontFamily: 'Helvetica, Arial, sans-serif', fontSize: T_NORMAL, lineHeight: 1.45, minWidth: 0 }
const s: Record<string, CSSProperties> = {
  documento: { ...base, border: `1px solid ${LINEA}`, borderRadius: '12px', padding: 'clamp(16px, 4vw, 40px)', marginTop: '20px' },
  embebido: base,
  etiqueta: { fontSize: T_CHICO, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: GRIS },
  caja: { background: GRIS_CLARO, borderRadius: '6px', padding: '12px 14px', minWidth: 0 },
  tablaWrap: { overflowX: 'auto', margin: '0 0 6px' },
  tabla: { width: '100%', minWidth: '520px', borderCollapse: 'collapse', fontSize: T_NORMAL },
  th: { background: GRIS_CLARO, color: GRIS, fontSize: T_CHICO, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: `1.5px solid ${NARANJA}` },
  td: { padding: '9px 10px', borderBottom: `1px solid ${LINEA}`, verticalAlign: 'top' },
  num: { textAlign: 'right', whiteSpace: 'nowrap' },
  filaTotal: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '3px 12px' },
}

function TituloSeccion({ texto }: { texto: string }) {
  return <h4 style={{ borderLeft: `3px solid ${NARANJA}`, paddingLeft: '10px', margin: '0 0 12px', fontSize: T_NORMAL, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: OSCURO }}>{texto}</h4>
}

function Tilde({ estado }: { estado: 'ok' | 'pendiente' | 'futuro' }) {
  const fondo = estado === 'ok' ? VERDE : estado === 'pendiente' ? NARANJA : '#fff'
  return (
    <span style={{ flex: '0 0 22px', width: '22px', height: '22px', borderRadius: '50%', background: fondo, border: estado === 'futuro' ? `1.5px solid ${GRIS}` : 'none', color: '#fff', display: 'grid', placeItems: 'center', fontSize: T_CHICO, fontWeight: 700, position: 'relative', zIndex: 1 }}>
      {estado === 'ok' ? '✓' : estado === 'pendiente' ? '!' : ''}
    </span>
  )
}

const conSigno = (n: number) => (n < 0 ? `− ${moneda(Math.abs(n))}` : `+ ${moneda(n)}`)

function CajaTotales({ filas, total, etiquetaTotal }: { filas: { t: string; v: string; color?: string }[]; total: number; etiquetaTotal: string }) {
  return (
    <div style={{ marginLeft: 'auto', width: 'min(330px, 100%)', marginTop: '12px' }}>
      {filas.map((f) => (
        <div key={f.t} style={{ ...s.filaTotal, color: f.color ?? GRIS }}><span>{f.t}</span><span style={{ whiteSpace: 'nowrap', color: f.color ?? TEXTO }}>{f.v}</span></div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', background: NARANJA_SUAVE, borderLeft: `3px solid ${NARANJA}`, borderRadius: '0 6px 6px 0', padding: '10px 14px', marginTop: '8px' }}>
        <span style={{ fontSize: T_CHICO, fontWeight: 700, letterSpacing: '0.8px', color: NARANJA }}>{etiquetaTotal}</span>
        <strong style={{ fontSize: T_GRANDE, color: OSCURO, whiteSpace: 'nowrap' }}>{moneda(total)}</strong>
      </div>
    </div>
  )
}

function EstadoObra({ e }: { e: EstadoPresupuesto }) {
  const msg = mensajeEstado(e, moneda)
  const total = Math.max(e.totalActualizado, 1)
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / total) * 100))}%`
  return (
    <section style={{ margin: '0 0 30px' }}>
      <TituloSeccion texto="Estado de tu obra" />
      <div style={{ ...s.caja, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
        <div><div style={s.etiqueta}>Total de la obra</div><strong style={{ fontSize: T_GRANDE, color: OSCURO }}>{moneda(e.totalActualizado)}</strong></div>
        <div><div style={s.etiqueta}>Ya pagaste</div><strong style={{ fontSize: T_GRANDE, color: VERDE }}>{moneda(e.cobrado)}</strong></div>
        <div><div style={s.etiqueta}>Pendiente a hoy</div><strong style={{ fontSize: T_GRANDE, color: e.pendienteHoy > 0.5 ? NARANJA : VERDE }}>{moneda(e.pendienteHoy)}</strong></div>
      </div>

      {/* Avance de la obra: "Hoy vamos por acá" según el último informe */}
      <div style={{ margin: '20px 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={s.etiqueta}>Avance de la obra</span>
        <strong style={{ color: NARANJA }}>{e.avance}%</strong>
      </div>
      <div style={{ position: 'relative', paddingTop: '30px' }}>
        <div style={{ position: 'absolute', top: 0, left: `clamp(62px, ${e.avance}%, calc(100% - 62px))`, transform: 'translateX(-50%)', background: NARANJA, color: '#fff', fontSize: T_CHICO, fontWeight: 700, padding: '3px 9px', borderRadius: '999px', whiteSpace: 'nowrap', boxShadow: '0 4px 12px -4px rgba(228,123,0,0.6)' }}>
          📍 Hoy vamos por acá
        </div>
        <span style={{ position: 'absolute', top: '21px', left: `${e.avance}%`, transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: `6px solid ${NARANJA}` }} />
        <div style={{ height: '10px', background: '#EEF0F3', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{ width: `${e.avance}%`, height: '100%', background: `linear-gradient(90deg, #FFB547, ${NARANJA})`, borderRadius: '999px' }} />
        </div>
      </div>
      <div style={{ fontSize: T_CHICO, color: GRIS, marginTop: '6px' }}>
        {e.avances.length ? `Último informe: ${fechaCorta(e.avances[e.avances.length - 1].fecha)} · ${e.avances[e.avances.length - 1].titulo}` : 'Todavía no hay informes de avance cargados.'}
      </div>

      {/* Pagos: pagado (verde) vs. lo que corresponde a hoy, con el anticipo marcado */}
      <div style={{ margin: '18px 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <span style={s.etiqueta}>Pagos</span>
        <strong style={{ color: VERDE, fontSize: T_CHICO }}>
          {e.cobrado > total + 0.5 ? `Pagado 100% · saldo a favor ${moneda(e.cobrado - total)}` : `Pagado ${Math.round((e.cobrado / total) * 100)}% del total`}
        </strong>
      </div>
      <div style={{ position: 'relative' }}>
        <div style={{ height: '10px', background: '#EEF0F3', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{ width: pct(e.cobrado), height: '100%', background: VERDE, borderRadius: '999px' }} />
        </div>
        <span style={{ position: 'absolute', left: pct(e.anticipo), top: '-4px', width: '3px', height: '18px', background: NARANJA, borderRadius: '2px', transform: 'translateX(-50%)' }} />
        <span style={{ position: 'absolute', left: pct(e.corresponde), top: '-4px', width: '3px', height: '18px', background: OSCURO, borderRadius: '2px', transform: 'translateX(-50%)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', fontSize: T_CHICO, marginTop: '8px' }}>
        <span><span style={{ display: 'inline-block', width: '9px', height: '9px', background: NARANJA, borderRadius: '2px', marginRight: '6px' }} />Anticipo ({PCT_ANTICIPO}%): {moneda(e.anticipo)}</span>
        <strong style={{ color: OSCURO }}><span style={{ display: 'inline-block', width: '9px', height: '9px', background: OSCURO, borderRadius: '2px', marginRight: '6px' }} />A pagar a hoy: {moneda(e.corresponde)}</strong>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: msg.tono === 'ok' ? VERDE_SUAVE : NARANJA_SUAVE, borderLeft: `3px solid ${msg.tono === 'ok' ? VERDE : NARANJA}`, borderRadius: '0 6px 6px 0', padding: '10px 14px', margin: '14px 0 22px' }}>
        <Tilde estado={msg.tono === 'ok' ? 'ok' : 'pendiente'} />
        <div><strong style={{ color: msg.tono === 'ok' ? VERDE : NARANJA }}>{msg.titulo}</strong><div>{msg.detalle}</div></div>
      </div>

      <TituloSeccion texto="Línea de tiempo de pagos y avances" />
      <div style={{ position: 'relative' }}>
        {e.linea.map((p, i) => (
          <div key={`${p.tipo}-${i}`} style={{ position: 'relative', display: 'flex', gap: '12px', padding: '0 0 16px' }}>
            {i < e.linea.length - 1 && <span style={{ position: 'absolute', left: '10px', top: '22px', bottom: 0, width: '2px', background: LINEA }} />}
            <Tilde estado={p.estado} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ color: OSCURO }}>{p.fecha && p.tipo !== 'anticipo' ? `${fechaCorta(p.fecha)} · ` : ''}{p.titulo}{p.tipo === 'avance' && p.porcentaje != null ? ` · ${p.porcentaje}%` : ''}</strong>
              {p.detalle && <div style={{ color: GRIS, fontSize: T_CHICO }}>{p.detalle}</div>}
              {p.tipo !== 'anticipo' && <div style={{ color: GRIS, fontSize: T_CHICO }}>A pagar hasta acá: {moneda(p.acumulado)}</div>}
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <strong style={{ color: OSCURO }}>{p.tipo === 'anticipo' ? moneda(p.importe) : `+ ${moneda(p.importe)}`}</strong>
              <div style={{ fontSize: T_CHICO, fontWeight: 700, color: p.estado === 'ok' ? VERDE : p.estado === 'futuro' ? GRIS : NARANJA }}>
                {p.estado === 'ok' ? (p.tipo === 'anticipo' ? 'Recibido' : 'Al día') : p.estado === 'futuro' ? 'Al finalizar' : `Falta ${moneda(p.falta)}`}
              </div>
            </div>
          </div>
        ))}
      </div>

      {e.gastosExtra.length > 0 && (
        <div style={{ marginTop: '10px' }}>
          <TituloSeccion texto="Gastos a reintegrar (aparte del total)" />
          {e.gastosExtra.map((g) => (
            <div key={g.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${LINEA}` }}>
              <Tilde estado={g.devuelto ? 'ok' : 'pendiente'} />
              <span style={{ flex: 1, minWidth: 0 }}>{fechaCorta(g.fecha)} · {g.descripcion}</span>
              <strong style={{ whiteSpace: 'nowrap' }}>{moneda(g.importe)}</strong>
              <span style={{ width: '90px', textAlign: 'right', fontSize: T_CHICO, fontWeight: 700, color: g.devuelto ? VERDE : NARANJA }}>{g.devuelto ? 'Reintegrado' : 'Pendiente'}</span>
            </div>
          ))}
          {e.gastoExtraPendiente > 0.5 && <div style={{ marginTop: '6px', fontWeight: 700, color: NARANJA }}>Pendiente de reintegro: {moneda(e.gastoExtraPendiente)}</div>}
        </div>
      )}
    </section>
  )
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
  const hayObra = !!d.obra && d.obra !== 'Sin obra asociada'
  const hayDescuento = d.items.some((it) => pctItem(it) > 0)
  const sumaNeta = d.items.reduce((acc, it) => acc + importeNeto(it), 0)
  const bonificacion = Math.round((sumaNeta - Number(d.total)) * 100) / 100
  const columnas = hayDescuento ? 6 : 5
  let numero = 0

  return (
    <div style={embebido ? s.embebido : s.documento}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <img src={logo} alt="MOVA Tecnología Smart" style={{ width: '170px', maxWidth: '100%', height: 'auto', objectFit: 'contain' }} />
        <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
          <div style={{ color: NARANJA, fontWeight: 700, fontSize: T_CHICO, letterSpacing: '0.8px' }}>{e ? 'PRESUPUESTO Y ESTADO DE OBRA' : 'PRESUPUESTO'}</div>
          <div style={{ color: OSCURO, fontWeight: 700, fontSize: T_GRANDE, lineHeight: 1.2, margin: '2px 0' }}>{codigo}</div>
          <div style={{ color: GRIS, fontSize: T_CHICO }}>Fecha: {fechaCorta(d.fecha)}</div>
          {e ? <div style={{ color: NARANJA, fontSize: T_CHICO, fontWeight: 700 }}>Última actualización: {fechaCorta(e.ultimaActualizacion)}</div>
            : d.validez_dias ? <div style={{ color: GRIS, fontSize: T_CHICO }}>Validez: {d.validez_dias} {d.validez_dias === 1 ? 'día' : 'días'}</div> : null}
        </div>
      </div>
      <div style={{ position: 'relative', height: '1px', background: LINEA, margin: '16px 0 20px' }}>
        <span style={{ position: 'absolute', left: 0, top: '-1px', width: '70px', height: '2px', background: NARANJA }} />
      </div>

      {/* Cliente y obra */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '22px' }}>
        <div style={s.caja}>
          <div style={s.etiqueta}>Cliente</div>
          <strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{d.cliente}</strong>
          <div style={{ fontSize: T_CHICO, marginTop: '4px', lineHeight: 1.6 }}>
            {contacto?.telefono && <div>Tel.: {contacto.telefono}</div>}
            {contacto?.email && <div>Email: {contacto.email}</div>}
            {contacto?.documento && <div>{contacto.documento.etiqueta}: {contacto.documento.valor}</div>}
            {contacto?.direccionCliente && <div>Domicilio: {contacto.direccionCliente}</div>}
          </div>
        </div>
        <div style={s.caja}>
          <div style={s.etiqueta}>{hayObra ? 'Obra' : 'Presupuesto'}</div>
          <strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{hayObra ? d.obra : codigo}</strong>
          <div style={{ fontSize: T_CHICO, marginTop: '4px', lineHeight: 1.6 }}>
            {hayObra && (contacto?.direccionObra || contacto?.direccionCliente) && <div>Ubicación: {contacto?.direccionObra || contacto?.direccionCliente}</div>}
            {e && <div>Estado: {e.terminada ? 'Obra finalizada' : e.enObra ? `En obra · avance ${e.avance}%` : 'Presupuesto aceptado'}</div>}
          </div>
        </div>
      </div>

      {/* Título */}
      <h3 style={{ fontSize: T_GRANDE, fontWeight: 700, color: OSCURO, margin: '0 0 6px', overflowWrap: 'anywhere' }}>{d.titulo}</h3>
      {d.descripcion && <p style={{ color: GRIS, margin: '0 0 22px', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{d.descripcion}</p>}

      {/* Qué vas a disfrutar */}
      {soluciones.length > 0 && (
        <section style={{ margin: '0 0 28px' }}>
          <TituloSeccion texto="Qué vas a disfrutar con este proyecto" />
          {soluciones.map((sol) => (
            <div key={sol.titulo} style={{ display: 'flex', gap: '10px', border: `1px solid ${LINEA}`, borderLeft: `3px solid ${NARANJA}`, borderRadius: '0 8px 8px 0', padding: '12px 14px', marginBottom: '8px' }}>
              <Tilde estado="ok" />
              <div><strong style={{ color: OSCURO }}>{sol.titulo}</strong><div style={{ fontSize: T_CHICO, lineHeight: 1.55, whiteSpace: 'pre-line' }}>{sol.descripcion}</div></div>
            </div>
          ))}
        </section>
      )}

      {/* Ítems */}
      <TituloSeccion texto={e ? 'Presupuesto aceptado' : 'Detalle del presupuesto'} />
      {grupos.length === 0 ? <p style={{ color: GRIS }}>Sin ítems.</p> : (
        <div style={s.tablaWrap}>
          <table style={s.tabla}>
            <thead>
              <tr>
                <th style={{ ...s.th, width: '34px' }}>#</th>
                <th style={s.th}>Descripción</th>
                <th style={{ ...s.th, ...s.num }}>Cant.</th>
                <th style={{ ...s.th, ...s.num }}>P. unitario</th>
                {hayDescuento && <th style={{ ...s.th, ...s.num }}>Desc.</th>}
                <th style={{ ...s.th, ...s.num }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => [
                <tr key={`g-${g.clave}`}><td colSpan={columnas} style={{ color: NARANJA, fontWeight: 700, fontSize: T_CHICO, letterSpacing: '0.6px', textTransform: 'uppercase', padding: '12px 10px 4px' }}>{g.titulo}</td></tr>,
                ...g.items.map((it) => {
                  numero++
                  const { titulo, detalle } = partirDescripcion(it.descripcion)
                  return (
                    <tr key={`${g.clave}-${it.id ?? numero}`}>
                      <td style={{ ...s.td, color: GRIS }}>{String(numero).padStart(2, '0')}</td>
                      <td style={s.td}><strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{titulo}</strong>{detalle && <div style={{ color: GRIS, fontSize: T_CHICO, whiteSpace: 'pre-line' }}>{detalle}</div>}</td>
                      <td style={{ ...s.td, ...s.num }}>{Number(it.cantidad)}</td>
                      <td style={{ ...s.td, ...s.num }}>{moneda(it.precio_unitario)}</td>
                      {hayDescuento && <td style={{ ...s.td, ...s.num, color: pctItem(it) > 0 ? NARANJA : GRIS }}>{pctItem(it) > 0 ? `${formatoPct(pctItem(it))}%` : '—'}</td>}
                      <td style={{ ...s.td, ...s.num }}><strong style={{ color: OSCURO }}>{moneda(importeNeto(it))}</strong></td>
                    </tr>
                  )
                }),
              ])}
            </tbody>
          </table>
        </div>
      )}
      <CajaTotales
        filas={[{ t: 'Subtotal', v: moneda(sumaNeta) }, ...(bonificacion > 0.5 ? [{ t: 'Bonificación', v: `− ${moneda(bonificacion)}`, color: NARANJA }] : [])]}
        etiquetaTotal={e ? 'TOTAL ACEPTADO' : 'TOTAL'}
        total={Number(d.total)}
      />

      {/* Modificaciones */}
      {e && e.modificaciones.length > 0 && (
        <section style={{ marginTop: '32px' }}>
          <TituloSeccion texto="Modificaciones durante la obra" />
          <p style={{ color: GRIS, fontSize: T_CHICO, margin: '0 0 10px' }}>El presupuesto de arriba se mantiene tal como fue aceptado. Estos son los cambios registrados después:</p>
          <div style={s.tablaWrap}>
            <table style={s.tabla}>
              <thead><tr><th style={{ ...s.th, width: '90px' }}>Fecha</th><th style={s.th}>Concepto</th><th style={{ ...s.th, ...s.num }}>Importe</th></tr></thead>
              <tbody>
                {e.modificaciones.map((m) => {
                  const { antes, ahora } = antesYAhora(m, moneda)
                  return (
                    <tr key={m.id}>
                      <td style={s.td}>{fechaCorta(m.fecha)}</td>
                      <td style={s.td}>
                        <div style={s.etiqueta}>{etiquetaModificacion(m)}</div>
                        <strong style={{ color: OSCURO }}>{m.descripcion}</strong>
                        {antes && <div style={{ color: GRIS, fontSize: T_CHICO }}>Antes: {antes}</div>}
                        {ahora && <div style={{ fontSize: T_CHICO }}>Ahora: {ahora}</div>}
                        {m.motivo && <div style={{ color: GRIS, fontSize: T_CHICO }}>Motivo: {m.motivo}</div>}
                      </td>
                      <td style={{ ...s.td, ...s.num }}><strong style={{ color: m.importe < 0 ? VERDE : OSCURO }}>{m.importe === 0 ? moneda(0) : conSigno(m.importe)}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <CajaTotales
            filas={[{ t: 'Total original aceptado', v: moneda(e.totalOriginal) }, { t: 'Modificaciones', v: conSigno(e.totalCambios), color: e.totalCambios < 0 ? VERDE : OSCURO }]}
            etiquetaTotal="TOTAL ACTUALIZADO"
            total={e.totalActualizado}
          />
        </section>
      )}

      {/* Pagos recibidos */}
      {e && (
        <section style={{ marginTop: '32px' }}>
          <TituloSeccion texto="Pagos recibidos" />
          {e.pagos.length === 0 ? <p style={{ color: GRIS }}>Todavía no registramos pagos.</p> : <>
            <div style={s.tablaWrap}>
              <table style={s.tabla}>
                <thead><tr><th style={s.th}>Fecha</th><th style={s.th}>Medio</th><th style={s.th}>Referencia</th><th style={{ ...s.th, ...s.num }}>Monto</th></tr></thead>
                <tbody>
                  {e.pagos.map((p) => (
                    <tr key={p.id}>
                      <td style={s.td}>{fechaCorta(p.fecha)}</td>
                      <td style={{ ...s.td, textTransform: 'capitalize' }}>{(p.medio ?? '—').replace('_', ' ')}</td>
                      <td style={{ ...s.td, color: GRIS }}>{p.referencia || '—'}</td>
                      <td style={{ ...s.td, ...s.num }}><strong style={{ color: OSCURO }}>{moneda(p.monto)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ ...s.filaTotal, marginLeft: 'auto', width: 'min(330px, 100%)', fontWeight: 700 }}><span style={{ color: OSCURO }}>Total pagado</span><span style={{ color: VERDE }}>{moneda(e.cobrado)}</span></div>
          </>}
        </section>
      )}

      {e && <div style={{ marginTop: '32px' }}><EstadoObra e={e} /></div>}

      {e?.terminada && (
        <section style={{ marginTop: '28px' }}>
          <TituloSeccion texto="Formas de uso y recomendaciones" />
          <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 1.7 }}>
            <li>Control desde el celular con la app correspondiente (Tuya / SmartLife o eWeLink / Sonoff según los equipos).</li>
            <li>Creación de escenas y automatizaciones (horarios, sensores, riego programado).</li>
            <li>Control por voz con asistentes compatibles (Alexa / Google / Siri) al vincular la cuenta.</li>
            <li>Ante cortes de energía o internet, los equipos se reconectan solos al volver el servicio.</li>
            <li>Mantené buena señal de WiFi en las zonas con dispositivos smart.</li>
          </ul>
        </section>
      )}

      {/* Notas y vigencia */}
      {(notas || !e) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '30px' }}>
          {notas && <div style={s.caja}><div style={{ ...s.etiqueta, color: NARANJA, marginBottom: '4px' }}>Notas</div><div style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{notas}</div></div>}
          {!e && <div style={s.caja}><div style={{ ...s.etiqueta, color: NARANJA, marginBottom: '4px' }}>Vigencia</div><div>Este presupuesto tiene una validez de {d.validez_dias ?? configActual().presupuestos.validezDias} días corridos desde su emisión.</div></div>}
        </div>
      )}

      {configActual().presupuestos.condiciones.length > 0 && (
        <section style={{ marginTop: '28px' }}>
          <TituloSeccion texto="Condiciones generales" />
          {configActual().presupuestos.condiciones.filter((c) => c.titulo.trim() || c.texto.trim()).map((c, i) => (
            <div key={`${i}-${c.titulo}`} style={{ marginBottom: '10px' }}>
              <strong style={{ color: OSCURO }}>{c.titulo}</strong>
              <p style={{ margin: '2px 0 0', color: GRIS, fontSize: T_CHICO, lineHeight: 1.55 }}>
                {textoCondicion(c, d.validez_dias)}
              </p>
            </div>
          ))}
        </section>
      )}

      <footer style={{ marginTop: '28px', paddingTop: '10px', borderTop: `1px solid ${LINEA}`, position: 'relative', fontSize: T_CHICO }}>
        <span style={{ position: 'absolute', top: '-2px', left: 0, width: '46px', height: '2px', background: NARANJA }} />
        <strong style={{ color: OSCURO }}>{configActual().empresa.nombre}</strong>
        <div style={{ color: GRIS }}>{lineaContacto()}</div>
      </footer>
    </div>
  )
}
