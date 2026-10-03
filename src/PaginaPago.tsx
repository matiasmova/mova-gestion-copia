import { useEffect, useState } from 'react'
import logo from './assets/mova-logo.png'
import { leerPagoPublico, subirComprobantePago, type DatosPago } from './pagoLink'
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

// Festejo: papelitos de colores que caen una vez (se van solos).
const COLORES = ['#de7015', '#f08a2c', '#1f9d5c', '#25d366', '#ffc93c', '#4f7cff', '#ff5d8f']
function Papelitos() {
  const [piezas] = useState(() => Array.from({ length: 90 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 0.9, dur: 2.4 + Math.random() * 1.8,
    dx: (Math.random() - 0.5) * 160, rot: (Math.random() - 0.5) * 1080, color: COLORES[i % COLORES.length],
    ancho: 6 + Math.random() * 6, redondo: Math.random() < 0.3,
  })))
  const [visible, setVisible] = useState(true)
  useEffect(() => { const t = window.setTimeout(() => setVisible(false), 5000); return () => window.clearTimeout(t) }, [])
  if (!visible) return null
  return (
    <div className="ppPapelitos" aria-hidden="true">
      {piezas.map((p, i) => <i key={i} style={{ left: `${p.left}%`, background: p.color, width: p.ancho, height: p.redondo ? p.ancho : p.ancho * 1.6, borderRadius: p.redondo ? '50%' : 2, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, ['--dx' as string]: `${p.dx}px`, ['--rot' as string]: `${p.rot}deg` }} />)}
    </div>
  )
}

// Adjuntar el comprobante: el cliente elige la foto o el PDF y nos llega a la app.
function AdjuntarComprobante({ token, waAviso }: { token: string; waAviso: string | null }) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [nota, setNota] = useState('')
  const [estado, setEstado] = useState<'listo' | 'enviando' | 'enviado'>('listo')
  const [error, setError] = useState('')
  const [vista, setVista] = useState('')
  useEffect(() => {
    if (!archivo || !archivo.type.startsWith('image/')) { setVista(''); return }
    const u = URL.createObjectURL(archivo); setVista(u)
    return () => URL.revokeObjectURL(u)
  }, [archivo])

  async function enviar() {
    if (!archivo) return
    setEstado('enviando'); setError('')
    const err = await subirComprobantePago(token, archivo, nota)
    if (err) { setError(err); setEstado('listo') } else setEstado('enviado')
  }

  if (estado === 'enviado') return (
    <div className="ppComp ok">
      <Papelitos />
      <div className="ppGracias">
        <div className="tilde">✓</div>
        <h3>¡Muchas gracias!</h3>
        <p>Fue enviado correctamente. Lo revisamos y te confirmaremos la acreditación.</p>
      </div>
      {waAviso && <a className="ppWa sec" href={waAviso} target="_blank" rel="noreferrer">💬 Avisar también por WhatsApp</a>}
      <button type="button" className="ppLink" onClick={() => { setArchivo(null); setNota(''); setEstado('listo') }}>Enviar otro comprobante</button>
    </div>
  )
  return (
    <div className="ppComp">
      <label className={`ppSubir ${archivo ? 'conArchivo' : ''}`}>
        <input type="file" accept="image/*,application/pdf" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setError('') }} />
        {vista ? <img src={vista} alt="Comprobante" /> : <span className="ppSubirIco">{archivo ? '📄' : '📎'}</span>}
        <span className="ppSubirTxt"><b>{archivo ? archivo.name : 'Adjuntar comprobante de pago'}</b><small>{archivo ? 'Tocá para cambiarlo' : 'Foto o captura de la transferencia, o el PDF'}</small></span>
      </label>
      {archivo && <>
        <input className="ppInput" placeholder="Comentario (opcional)" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} />
        <button type="button" className="ppEnviar" disabled={estado === 'enviando'} onClick={() => void enviar()}>{estado === 'enviando' ? 'Enviando…' : 'Enviar comprobante'}</button>
      </>}
      {error && <p className="ppError">{error}</p>}
    </div>
  )
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
            <p className="ppNota"><b>1.</b> Copiá el alias o el CBU, abrí tu banco o MODO y pegalo. Verificá que el titular sea <b>{d.titular}</b>.<br /><b>2.</b> Cuando transfieras, adjuntá acá el comprobante:</p>
            <AdjuntarComprobante token={token} waAviso={waTransferi} />
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

      {!d.transferencia && <>
        <div className="ppTitulo">¿Ya pagaste?</div>
        <div className="ppMedio"><div className="ppCuerpo" style={{ paddingTop: 14 }}><AdjuntarComprobante token={token} waAviso={waTransferi} /></div></div>
      </>}

      <p className="ppPie">¿Dudas? Escribinos al <b>{d.telefono}</b><br />{d.empresa}{d.web ? ` · ${d.web}` : ''}</p>
    </div></div>
  )
}
