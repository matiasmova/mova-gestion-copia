import { useEffect, useState } from 'react'
import { pedirAsistente } from './asistenteIA'
import { linkWhatsApp } from './whatsapp'

// Mensaje de avance de obra para el cliente, escrito por la IA con lo cargado
// en "Estados y avances". Se revisa y se manda por WhatsApp o se copia.

const PERIODOS: [number, string][] = [[7, 'Última semana'], [14, 'Últimas 2 semanas'], [30, 'Último mes'], [3650, 'Toda la obra']]

function InformeObraIA({ obraId, obra, onCerrar }: { obraId: number; obra: string; onCerrar: () => void }) {
  const [dias, setDias] = useState(7)
  const [tono, setTono] = useState<'cercano' | 'formal'>('cercano')
  const [mensaje, setMensaje] = useState('')
  const [telefono, setTelefono] = useState<string | null>(null)
  const [info, setInfo] = useState('')
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState('')
  const [copiado, setCopiado] = useState(false)

  async function escribir() {
    setError(''); setPensando(true); setCopiado(false)
    try {
      const r = await pedirAsistente<{ mensaje: string; telefono: string | null; avances_periodo: number; fotos_periodo: number }>({ accion: 'informe_obra', obra_id: obraId, dias, tono })
      setMensaje(r.mensaje); setTelefono(r.telefono)
      setInfo(`Basado en ${r.avances_periodo} avance${r.avances_periodo === 1 ? '' : 's'} del período${r.fotos_periodo ? ` · hay ${r.fotos_periodo} foto${r.fotos_periodo === 1 ? '' : 's'} nuevas para mandarle aparte` : ''}.`)
    } catch (e) { setError((e as Error).message) } finally { setPensando(false) }
  }

  useEffect(() => { void escribir() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function copiar() {
    try { await navigator.clipboard.writeText(mensaje); setCopiado(true) } catch { setError('No se pudo copiar: seleccioná el texto y copialo a mano.') }
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard catalogoModal informeIaModal">
        <div className="modalHeader">
          <div><p className="subtitle">✨ INFORME PARA EL CLIENTE</p><h2>{obra}</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar}>×</button>
        </div>
        <div className="catalogoForm">
          <div className="informeIaOpciones">
            <label>Período
              <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
                {PERIODOS.map(([d, t]) => <option key={d} value={d}>{t}</option>)}
              </select>
            </label>
            <div className="segTipo">
              <button type="button" className={tono === 'cercano' ? 'active' : ''} onClick={() => setTono('cercano')}>Cercano</button>
              <button type="button" className={tono === 'formal' ? 'active' : ''} onClick={() => setTono('formal')}>Formal</button>
            </div>
            <button type="button" className="editButton" disabled={pensando} onClick={() => void escribir()}>{pensando ? 'Escribiendo…' : '✨ Escribir de nuevo'}</button>
          </div>
          {pensando && !mensaje && <div className="mercadoCargando" role="status"><span className="mercadoSpinner" /><p><strong>Escribiendo el informe…</strong><br /><small>Con los avances cargados en la obra.</small></p></div>}
          {mensaje && <>
            <textarea className="informeIaTexto" rows={12} value={mensaje} onChange={(e) => { setMensaje(e.target.value); setCopiado(false) }} />
            {info && <small className="gestionAyuda">{info} Podés corregir el texto antes de mandarlo.</small>}
          </>}
          {error && <p className="loginError">{error}</p>}
          <div className="modalActions formActions">
            <button type="button" className="cancelButton" onClick={onCerrar}>Cerrar</button>
            {mensaje && <button type="button" className="editButton" onClick={() => void copiar()}>{copiado ? '✓ Copiado' : '📋 Copiar'}</button>}
            {mensaje && <a className="newButton informeIaWa" href={linkWhatsApp(telefono, mensaje) ?? '#'} target="_blank" rel="noreferrer">💬 Enviar por WhatsApp</a>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default InformeObraIA
