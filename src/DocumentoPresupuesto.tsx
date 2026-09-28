import { useEffect, useState, type CSSProperties } from 'react'
import logo from './assets/mova-logo.jpg'
import { moneda, fechaCorta } from './gestionFormat'
import { CONDICIONES_GENERALES } from './condicionesGenerales'
import { COLOR_MARCA_HEX, agruparPorTipo, type DatosPdf } from './pdfPresupuesto'
import { formatoPct, importeNeto, partirDescripcion, pctItem } from './presupuestoCalculos'
import {
  antesYAhora,
  cargarResumenModificaciones,
  etiquetaModificacion,
  type ResumenModificaciones,
} from './presupuestoModificaciones'
import { cargarSolucionesPresupuesto, type SolucionPresupuesto } from './presupuestoSoluciones'

// Documento del presupuesto en pantalla (ficha y vista previa).
// Mismo diseño que el PDF (pdfPresupuesto.ts). Solo tres tamaños de letra.

type Props = {
  datos: DatosPdf
  // Sin borde ni márgenes propios (cuando ya está dentro de una hoja).
  embebido?: boolean
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

// Los tres tamaños de letra del documento.
const T_GRANDE = '22px'
const T_NORMAL = '13.5px'
const T_CHICO = '11px'

const base: CSSProperties = { background: '#fff', color: TEXTO, fontFamily: 'Helvetica, Arial, sans-serif', fontSize: T_NORMAL, lineHeight: 1.45, minWidth: 0 }

const s: Record<string, CSSProperties> = {
  documento: { ...base, border: `1px solid ${LINEA}`, borderRadius: '12px', padding: 'clamp(16px, 4vw, 40px)', marginTop: '24px' },
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
  return (
    <h4 style={{ borderLeft: `3px solid ${NARANJA}`, paddingLeft: '10px', margin: '0 0 12px', fontSize: T_NORMAL, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', color: OSCURO }}>
      {texto}
    </h4>
  )
}

const conSigno = (n: number) => (n < 0 ? `− ${moneda(Math.abs(n))}` : `+ ${moneda(n)}`)
const colorImporte = (n: number) => (n < 0 ? VERDE : n > 0 ? NARANJA : TEXTO)

// Total destacado de forma sutil: fondo suave, acento naranja y monto grande.
function CajaTotales({ filas, total, etiquetaTotal }: { filas: { t: string; v: string; color?: string }[]; total: number; etiquetaTotal: string }) {
  return (
    <div style={{ marginLeft: 'auto', width: 'min(330px, 100%)', marginTop: '12px' }}>
      {filas.map((f) => (
        <div key={f.t} style={{ ...s.filaTotal, color: f.color ?? GRIS }}>
          <span>{f.t}</span><span style={{ whiteSpace: 'nowrap', color: f.color ?? TEXTO }}>{f.v}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', background: NARANJA_SUAVE, borderLeft: `3px solid ${NARANJA}`, borderRadius: '0 6px 6px 0', padding: '10px 14px', marginTop: '8px' }}>
        <span style={{ fontSize: T_CHICO, fontWeight: 700, letterSpacing: '0.8px', color: NARANJA }}>{etiquetaTotal}</span>
        <strong style={{ fontSize: T_GRANDE, color: OSCURO, whiteSpace: 'nowrap' }}>{moneda(total)}</strong>
      </div>
    </div>
  )
}

function SeccionSoluciones({ soluciones }: { soluciones: SolucionPresupuesto[] }) {
  return (
    <section style={{ margin: '0 0 28px' }}>
      <TituloSeccion texto="Qué vas a disfrutar con este proyecto" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px' }}>
        {soluciones.map((sol) => (
          <div key={sol.titulo} style={{ display: 'flex', gap: '10px', border: `1px solid ${LINEA}`, borderRadius: '8px', padding: '12px 14px', breakInside: 'avoid' }}>
            <span style={{ flex: '0 0 20px', width: '20px', height: '20px', borderRadius: '50%', background: NARANJA, color: '#fff', display: 'grid', placeItems: 'center', fontSize: T_CHICO, fontWeight: 700 }}>✓</span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ color: OSCURO, display: 'block' }}>{sol.titulo}</strong>
              <span style={{ color: GRIS, fontSize: T_CHICO, lineHeight: 1.5, display: 'block', marginTop: '2px', whiteSpace: 'pre-line' }}>{sol.descripcion}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SeccionModificaciones({ resumen }: { resumen: ResumenModificaciones }) {
  const hayCambios = resumen.modificaciones.length > 0
  const pendiente = resumen.saldo > 0
  const tarjeta = (etiqueta: string, valor: string, color: string, fondo = GRIS_CLARO, acento = LINEA) => (
    <div style={{ ...s.caja, background: fondo, borderLeft: `3px solid ${acento}`, borderRadius: '0 6px 6px 0' }}>
      <div style={s.etiqueta}>{etiqueta}</div>
      <strong style={{ fontSize: T_GRANDE, color }}>{valor}</strong>
    </div>
  )
  return <>
    {hayCambios && (
      <section style={{ marginTop: '32px' }}>
        <TituloSeccion texto="Modificaciones durante la obra" />
        <p style={{ color: GRIS, fontSize: T_CHICO, margin: '0 0 10px' }}>
          El presupuesto de arriba se mantiene tal como fue aceptado. Estos son los cambios registrados después:
        </p>
        <div style={s.tablaWrap}>
          <table style={s.tabla}>
            <thead><tr><th style={{ ...s.th, width: '90px' }}>Fecha</th><th style={s.th}>Concepto</th><th style={{ ...s.th, ...s.num }}>Importe</th></tr></thead>
            <tbody>
              {resumen.modificaciones.map((m) => {
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
                    <td style={{ ...s.td, ...s.num }}><strong style={{ color: colorImporte(m.importe) }}>{m.importe === 0 ? moneda(0) : conSigno(m.importe)}</strong></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <CajaTotales
          filas={[
            { t: 'Total original aceptado', v: moneda(resumen.totalOriginal) },
            { t: 'Modificaciones', v: conSigno(resumen.totalCambios), color: colorImporte(resumen.totalCambios) },
          ]}
          etiquetaTotal="NUEVO TOTAL"
          total={resumen.nuevoTotal}
        />
      </section>
    )}

    <section style={{ marginTop: '32px' }}>
      <TituloSeccion texto="Estado de cuenta" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
        {tarjeta(hayCambios ? 'Nuevo total' : 'Total', moneda(resumen.nuevoTotal), OSCURO)}
        {tarjeta('Cobrado hasta hoy', moneda(resumen.cobrado), VERDE)}
        {tarjeta(resumen.saldo >= 0 ? 'Saldo pendiente' : 'Saldo a favor', moneda(Math.abs(resumen.saldo)), pendiente ? NARANJA : VERDE, pendiente ? NARANJA_SUAVE : VERDE_SUAVE, pendiente ? NARANJA : VERDE)}
      </div>
      <div style={{ color: GRIS, fontSize: T_CHICO, marginTop: '6px' }}>Actualizado al {fechaCorta(new Date().toISOString().slice(0, 10))}</div>
    </section>
  </>
}

export default function DocumentoPresupuesto({ datos, embebido = false }: Props) {
  const codigo = String(datos.id).padStart(4, '0')
  const grupos = agruparPorTipo(datos.items)
  const notas = (datos.notas ?? '').trim()
  const hayObra = !!datos.obra && datos.obra !== 'Sin obra asociada'
  const hayDescuento = datos.items.some((it) => pctItem(it) > 0)
  const sumaNeta = datos.items.reduce((acc, it) => acc + importeNeto(it), 0)
  const bonificacion = Math.round((sumaNeta - Number(datos.total)) * 100) / 100
  const [resumen, setResumen] = useState<ResumenModificaciones | null>(null)
  const [solucionesGuardadas, setSolucionesGuardadas] = useState<SolucionPresupuesto[]>([])
  const soluciones = datos.soluciones ?? solucionesGuardadas

  useEffect(() => {
    let vigente = true
    setResumen(null)
    if (!datos.id) return
    cargarResumenModificaciones(datos.id, Number(datos.total) || 0)
      .then((r) => { if (vigente) setResumen(r) })
      .catch((e) => console.error(e))
    return () => { vigente = false }
  }, [datos.id, datos.total])

  useEffect(() => {
    let vigente = true
    if (datos.soluciones || !datos.id) return
    cargarSolucionesPresupuesto(datos.id)
      .then((r) => { if (vigente) setSolucionesGuardadas(r) })
      .catch((e) => console.error(e))
    return () => { vigente = false }
  }, [datos.id, datos.soluciones])

  let numero = 0
  const columnas = hayDescuento ? 6 : 5

  return (
    <div style={embebido ? s.embebido : s.documento}>
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <img src={logo} alt="MOVA Tecnología Smart" style={{ width: '170px', maxWidth: '100%', height: 'auto', objectFit: 'contain' }} />
        <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
          <div style={{ color: NARANJA, fontWeight: 700, fontSize: T_CHICO, letterSpacing: '0.8px' }}>PRESUPUESTO</div>
          <div style={{ color: OSCURO, fontWeight: 700, fontSize: T_GRANDE, lineHeight: 1.2, margin: '2px 0' }}>N° {codigo}</div>
          <div style={{ color: GRIS, fontSize: T_CHICO }}>Fecha: {fechaCorta(datos.fecha)}</div>
          {datos.validez_dias != null && datos.validez_dias > 0 && (
            <div style={{ color: GRIS, fontSize: T_CHICO }}>Validez: {datos.validez_dias} {datos.validez_dias === 1 ? 'día' : 'días'}</div>
          )}
        </div>
      </div>
      <div style={{ position: 'relative', height: '1px', background: LINEA, margin: '16px 0 20px' }}>
        <span style={{ position: 'absolute', left: 0, top: '-1px', width: '70px', height: '2px', background: NARANJA }} />
      </div>

      {/* Cliente y obra */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '22px' }}>
        <div style={s.caja}><div style={s.etiqueta}>Cliente</div><strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{datos.cliente}</strong></div>
        <div style={s.caja}><div style={s.etiqueta}>Obra</div><strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{hayObra ? datos.obra : '—'}</strong></div>
      </div>

      {/* Título */}
      <h3 style={{ fontSize: T_GRANDE, fontWeight: 700, color: OSCURO, margin: '0 0 6px', overflowWrap: 'anywhere' }}>{datos.titulo}</h3>
      {datos.descripcion && <p style={{ color: GRIS, margin: '0 0 22px', whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{datos.descripcion}</p>}

      {/* Qué vas a disfrutar */}
      {soluciones.length > 0 && <SeccionSoluciones soluciones={soluciones} />}

      {/* Ítems */}
      <TituloSeccion texto="Detalle del presupuesto" />
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
                <tr key={`g-${g.clave}`}>
                  <td colSpan={columnas} style={{ color: NARANJA, fontWeight: 700, fontSize: T_CHICO, letterSpacing: '0.6px', textTransform: 'uppercase', padding: '12px 10px 4px' }}>{g.titulo}</td>
                </tr>,
                ...g.items.map((it) => {
                  numero++
                  const { titulo, detalle } = partirDescripcion(it.descripcion)
                  return (
                    <tr key={`${g.clave}-${it.id ?? numero}`}>
                      <td style={{ ...s.td, color: GRIS }}>{String(numero).padStart(2, '0')}</td>
                      <td style={s.td}>
                        <strong style={{ color: OSCURO, overflowWrap: 'anywhere' }}>{titulo}</strong>
                        {detalle && <div style={{ color: GRIS, fontSize: T_CHICO, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{detalle}</div>}
                      </td>
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
        filas={[
          { t: 'Subtotal', v: moneda(sumaNeta) },
          ...(bonificacion > 0.5 ? [{ t: 'Bonificación', v: `− ${moneda(bonificacion)}`, color: NARANJA }] : []),
        ]}
        etiquetaTotal="TOTAL"
        total={Number(datos.total)}
      />

      {resumen && <SeccionModificaciones resumen={resumen} />}

      {/* Notas y vigencia */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginTop: '32px' }}>
        {notas && (
          <div style={s.caja}>
            <div style={{ ...s.etiqueta, color: NARANJA, marginBottom: '4px' }}>Notas</div>
            <div style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{notas}</div>
          </div>
        )}
        <div style={s.caja}>
          <div style={{ ...s.etiqueta, color: NARANJA, marginBottom: '4px' }}>Vigencia</div>
          <div>Este presupuesto tiene una validez de {datos.validez_dias ?? 10} días corridos desde su emisión.</div>
        </div>
      </div>

      {/* Condiciones generales */}
      {CONDICIONES_GENERALES.length > 0 && (
        <section style={{ marginTop: '28px' }}>
          <TituloSeccion texto="Condiciones generales" />
          {CONDICIONES_GENERALES.map((c) => (
            <div key={c.titulo} style={{ marginBottom: '10px', breakInside: 'avoid' }}>
              <strong style={{ color: OSCURO }}>{c.titulo}</strong>
              <p style={{ margin: '2px 0 0', color: GRIS, fontSize: T_CHICO, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{c.texto}</p>
            </div>
          ))}
        </section>
      )}

      {/* Pie */}
      <footer style={{ marginTop: '28px', paddingTop: '10px', borderTop: `1px solid ${LINEA}`, position: 'relative', fontSize: T_CHICO }}>
        <span style={{ position: 'absolute', top: '-2px', left: 0, width: '46px', height: '2px', background: NARANJA }} />
        <strong style={{ color: OSCURO }}>MOVA Tecnología Smart</strong>
        <div style={{ color: GRIS, overflowWrap: 'anywhere' }}>www.movaelectronica.com.ar · IG @mova.smart · +54 9 261 555 7970</div>
      </footer>
    </div>
  )
}
