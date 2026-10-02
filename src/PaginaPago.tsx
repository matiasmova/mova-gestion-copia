import { useEffect, useState } from 'react'
import logo from './assets/mova-logo.png'
import { leerPagoPublico, type DatosPago } from './pagoLink'
import { linkWhatsApp } from './whatsapp'
import './pagina-pago.css'

// Página pública de pago (sin login): lo que el cliente tiene que pagar hoy y
// cómo hacerlo (transferencia o efectivo). Solo lee el link por su código.

const dinero = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n)
const esUuid = (t: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)
const primerNombre = (s: string) => s.trim().split(/\s+/)[0] ?? ''

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false)
  return <button type="button" className={`ppCopiar ${ok ? 'ok' : ''}`} onClick={() => {
    const listo = () => { setOk(true); window.setTimeout(() => setOk(false), 1800) }
    if (navigator.clipboard) void navigator.clipboard.writeText(texto).then(listo, listo); else listo()
  }}>{ok ? '✓ Copiado' : 'Copiar'}</button>
}

export default function PaginaPago({ token }: { token: string }) {
  const [d, setD] = useState<(DatosPago & { actualizado_at: string }) | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'no'>('cargando')
  const [abierto, setAbierto] = useState<'transferencia' | 'efectivo' | null>(null)

  useEffect(() => {
    document.title = 'Pagar · MOVA Tecnología Smart'
    if (!esUuid(token)) { setEstado('no'); return }
    void leerPagoPublico(token).then((r) => {
      setD(r); setEstado(r ? 'ok' : 'no')
      if (r) setAbierto(r.transferencia ? 'transferencia' : 'efectivo')
    })
  }, [token])

  if (estado === 'cargando') return <div className="pp"><div className="ppWrap"><p className="ppCargando">Cargando…</p></div></div>
  if (estado === 'no' || !d) return (
    <div className="pp"><div className="ppWrap">
      <img className="ppLogo" src={logo} alt="MOVA Tecnología Smart" />
      <h1 style={{ marginTop: 24 }}>Este link de pago no está disponible</h1>
      <p className="ppNota">Puede que haya vencido o que se haya desactivado. Pedile a MOVA un link nuevo.</p>
    </div></div>
  )

  const montoTxt = dinero(d.a_pagar)
  const waTransferi = linkWhatsApp(d.telefono, `Hola! Soy ${d.cliente}. Ya transferí ${montoTxt} por "${d.titulo}" (${d.codigo}). Te paso el comprobante.`)
  const waEfectivo = linkWhatsApp(d.telefono, `Hola! Soy ${d.cliente}. Quiero coordinar el pago en efectivo de ${montoTxt} por "${d.titulo}" (${d.codigo}).`)
  const actualizado = new Date(d.actualizado_at).toLocaleDateString('es-AR')

  return (
    <div className="pp"><div className="ppWrap">
      <div className="ppTop"><img className="ppLogo" src={logo} alt={d.empresa} /><span>PAGO SEGURO</span></div>
      <p className="ppHola">Hola {primerNombre(d.cliente)} 👋</p>
      <h1>{d.titulo}</h1>
      <div className="ppObra">{d.obra ? `${d.obra} · ` : ''}Presupuesto {d.codigo}</div>

      {d.a_pagar > 0.5 ? <>
        <div className="ppMonto"><small>A PAGAR HOY</small><strong>{montoTxt}</strong><em>Actualizado al {actualizado}</em></div>
        <div className="ppDetalle">
          {d.detalle.map((x) => <div key={x.t}><span>{x.t}</span><b>{dinero(x.v)}</b></div>)}
          {d.ya_pago > 0.5 && <div><span>Ya pagaste</span><b className="ok">{dinero(d.ya_pago)}</b></div>}
        </div>
      </> : (
        <div className="ppMonto alDia"><small>ESTÁS AL DÍA</small><strong>¡Gracias!</strong><em>No tenés pagos pendientes por ahora.</em></div>
      )}

      <div className="ppTitulo">Elegí cómo pagar</div>

      {d.transferencia && (
        <div className={`ppMedio tr ${abierto === 'transferencia' ? 'abierto' : ''}`}>
          <button type="button" className="ppMedioCab" onClick={() => setAbierto(abierto === 'transferencia' ? null : 'transferencia')}>
            <span className="ppIco">🏦</span><span className="ppTxt"><b>Transferencia</b><small>Desde la app de tu banco, MODO o billetera · sin costo</small></span><span className="ppFlecha">›</span>
          </button>
          {abierto === 'transferencia' && <div className="ppCuerpo">
            {d.alias && <div className="ppDato"><div><small>Alias</small><b>{d.alias}</b></div><Copiar texto={d.alias} /></div>}
            {d.cbu && <div className="ppDato"><div><small>CBU / CVU</small><b>{d.cbu}</b></div><Copiar texto={d.cbu} /></div>}
            <div className="ppDato"><div><small>Titular</small><b>{d.titular}</b>{d.banco && <span>{d.banco}</span>}</div></div>
            {d.a_pagar > 0.5 && <div className="ppDato"><div><small>Monto</small><b>{montoTxt}</b></div><Copiar texto={d.a_pagar.toFixed(2).replace('.', ',')} /></div>}
            <p className="ppNota">Copiá el alias, abrí tu banco o MODO y pegalo. Verificá que el titular sea <b>{d.titular}</b>. Cuando transfieras, avisanos así lo registramos:</p>
            {waTransferi && <a className="ppWa" href={waTransferi} target="_blank" rel="noreferrer">💬 Ya transferí · avisar por WhatsApp</a>}
          </div>}
        </div>
      )}

      {d.efectivo && (
        <div className={`ppMedio ef ${abierto === 'efectivo' ? 'abierto' : ''}`}>
          <button type="button" className="ppMedioCab" onClick={() => setAbierto(abierto === 'efectivo' ? null : 'efectivo')}>
            <span className="ppIco">💵</span><span className="ppTxt"><b>Efectivo</b><small>Coordinamos día y lugar</small></span><span className="ppFlecha">›</span>
          </button>
          {abierto === 'efectivo' && <div className="ppCuerpo">
            {waEfectivo && <a className="ppWa" href={waEfectivo} target="_blank" rel="noreferrer">💬 Coordinar pago en efectivo</a>}
          </div>}
        </div>
      )}

      <p className="ppPie">¿Dudas? Escribinos al <b>{d.telefono}</b><br />{d.empresa}{d.web ? ` · ${d.web}` : ''}</p>
    </div></div>
  )
}
