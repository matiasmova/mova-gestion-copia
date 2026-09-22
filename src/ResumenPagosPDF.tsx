import { useEffect, useState } from 'react'
import logo from './assets/mova-logo.png'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'

type Pago = {
  id: number
  monto: number
  fecha: string
  medio_pago: string
  referencia: string | null
  notas: string | null
  obra_id: number | null
  presupuesto_id: number | null
}

type Movimiento = {
  id: number
  fecha: string
  tipo: string
  descripcion: string | null
  motivo: string | null
  importe: number
  estado: string
}

const TIPOS_MOV: Record<string, string> = {
  adicional: 'Adicional', producto: 'Producto extra', servicio: 'Servicio extra', cambio: 'Cambio de alcance',
  gasto_extra: 'Gasto extra', ajuste: 'Ajuste', bonificacion: 'Bonificación',
}

type Props = {
  obra: { id: number; nombre_obra: string }
  cliente: string
  onCerrar: () => void
}

export default function ResumenPagosPDF({ obra, cliente, onCerrar }: Props) {
  const [pagos, setPagos] = useState<Pago[]>([])
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [valor, setValor] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const rPres = await supabase.from('presupuestos').select('id, total, estado, activo').eq('obra_id', obra.id)
      if (!vigente) return
      if (rPres.error) { console.error(rPres.error); setError('No se pudo generar el resumen.'); setCargando(false); return }
      const presu = rPres.data ?? []
      const ids = presu.map((p) => p.id)
      const contratado = presu.filter((p) => p.activo !== false && p.estado === 'aceptado').reduce((s, p) => s + Number(p.total || 0), 0)

      const [rAdic, rPagos] = await Promise.all([
        supabase.from('adicionales').select('id, fecha, tipo, descripcion, motivo, importe, estado').eq('obra_id', obra.id).order('fecha', { ascending: true }),
        supabase.from('pagos').select('id, monto, fecha, medio_pago, referencia, notas, obra_id, presupuesto_id').order('fecha', { ascending: true }),
      ])
      if (!vigente) return
      const todos = rAdic.error ? [] : (rAdic.data ?? [])
      // Para el valor de la obra, un adicional "Pagado" (Gasto extra ya
      // devuelto) queda cancelado, como "Rechazado" o "Pendiente": no suma.
      const aprobados = todos.filter((a) => a.estado === 'aprobado')
      const extra = aprobados.reduce((s, a) => s + Number(a.importe || 0), 0)
      setValor(contratado + extra)
      // Para el detalle sí mostramos también los Gasto extra "Pagado": no
      // desaparecen, quedan en la lista para que se vea la historia completa.
      const paraMostrar = todos.filter((a) => a.estado === 'aprobado' || (a.tipo === 'gasto_extra' && a.estado === 'pagado'))
      setMovimientos(paraMostrar.map((a) => ({ ...a, importe: Number(a.importe) })) as Movimiento[])
      setPagos(rPagos.error ? [] : (rPagos.data ?? [])
        .map((p) => ({ ...p, monto: Number(p.monto) }))
        .filter((p) => p.obra_id === obra.id || (p.presupuesto_id != null && ids.includes(p.presupuesto_id))) as Pago[])
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [obra.id])

  const cobrado = pagos.reduce((s, p) => s + p.monto, 0)
  const saldo = Math.max(0, valor - cobrado)
  const medio = (m: string) => m.replace('_', ' ')

  return (
    <div className="pdfPreview">
      <div className="pdfPreviewBar">
        <span>Resumen de pagos · {obra.nombre_obra}</span>
        <div>
          <button className="pdfBtnGhost" onClick={onCerrar}>Cerrar</button>
          <button className="pdfBtnPrimary" disabled={cargando} onClick={() => window.print()}>⬇ Descargar PDF</button>
        </div>
      </div>

      <div className="pdfDoc">
        <header className="pdfHead">
          <img src={logo} alt="MOVA" className="pdfLogo" />
          <div className="pdfHeadRight">
            <span className="pdfEyebrow">Resumen de pagos</span>
            <strong>{obra.nombre_obra}</strong>
            <span className="pdfFecha">{fechaCorta(new Date().toISOString())}</span>
          </div>
        </header>

        <section className="pdfCliente">
          <div>
            <span className="pdfLabel">Cliente</span>
            <strong>{cliente}</strong>
          </div>
        </section>

        {cargando && <p style={{ padding: '20px 0' }}>Cargando pagos...</p>}
        {error && <p className="loginError">{error}</p>}

        {!cargando && !error && (<>
          <section className="pdfResumenPagos">
            <div><span className="pdfLabel">Valor actualizado</span><strong>{moneda(valor)}</strong></div>
            <div><span className="pdfLabel">Total cobrado</span><strong>{moneda(cobrado)}</strong></div>
            <div className="pdfSaldoBox"><span className="pdfLabel">Saldo pendiente</span><strong>{moneda(saldo)}</strong></div>
          </section>

          {movimientos.length > 0 && (
            <section className="pdfGrupo">
              <h2>Adicionales y modificaciones ({movimientos.length})</h2>
              <table className="pdfTablaPagos">
                <thead>
                  <tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th style={{ textAlign: 'right' }}>Importe</th></tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => {
                    const pendienteDevolucion = m.tipo === 'gasto_extra' && m.estado === 'aprobado'
                    const yaDevuelto = m.tipo === 'gasto_extra' && m.estado === 'pagado'
                    return (
                      <tr key={m.id}>
                        <td>{fechaCorta(m.fecha)}</td>
                        <td>
                          {TIPOS_MOV[m.tipo] ?? m.tipo}
                          {pendienteDevolucion && <><br /><small style={{ color: '#b86608' }}>Deuda pendiente de devolución</small></>}
                          {yaDevuelto && <><br /><small style={{ color: '#1f7a4d' }}>Ya devuelto</small></>}
                        </td>
                        <td>{m.descripcion || m.motivo || '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <b style={yaDevuelto ? { color: '#c2410c' } : undefined}>
                            {yaDevuelto ? '− ' : m.importe >= 0 ? '+' : ''}{moneda(Math.abs(m.importe))}
                          </b>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )}

          <section className="pdfGrupo">
            <h2>Detalle de cobros ({pagos.length})</h2>
            {pagos.length === 0 ? (
              <p>No hay cobros registrados para esta obra.</p>
            ) : (
              <table className="pdfTablaPagos">
                <thead>
                  <tr><th>Fecha</th><th>Medio</th><th>Referencia</th><th style={{ textAlign: 'right' }}>Monto</th></tr>
                </thead>
                <tbody>
                  {pagos.map((p) => (
                    <tr key={p.id}>
                      <td>{fechaCorta(p.fecha)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{medio(p.medio_pago)}</td>
                      <td>{p.referencia || p.notas || '—'}</td>
                      <td style={{ textAlign: 'right' }}><b>{moneda(p.monto)}</b></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3}>Total cobrado</td><td style={{ textAlign: 'right' }}><b>{moneda(cobrado)}</b></td></tr>
                </tfoot>
              </table>
            )}
          </section>
        </>)}

        <footer className="pdfFooter">
          <img src={logo} alt="MOVA" className="pdfFooterLogo" />
          <div className="pdfContacto">
            <span>www.movaelectronica.com.ar</span>
            <span>Instagram @mova.smart</span>
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><line x1="10.5" y1="18.5" x2="13.5" y2="18.5" /></svg>+54 9 261 555 7970</span>
          </div>
          <span className="pdfFooterTag">MOVA Tecnología Smart · Espacios inteligentes</span>
        </footer>
      </div>
    </div>
  )
}
