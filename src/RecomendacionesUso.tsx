import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { pedirAsistente } from './asistenteIA'
import { partirDescripcion } from './presupuestoCalculos'
import type { ItemPresupuesto } from './NuevoPresupuesto'

// "Formas de uso y recomendaciones" del presupuesto: opcional. Se redacta a
// mano o con IA (según los ítems), se guarda y se elige si va en el documento.

type Props = { presupuestoId: number; titulo: string; descripcion: string | null; items: ItemPresupuesto[]; onGuardado: () => void }

export default function RecomendacionesUso({ presupuestoId, titulo, descripcion, items, onGuardado }: Props) {
  const [texto, setTexto] = useState('')
  const [incluir, setIncluir] = useState(false)
  const [guardado, setGuardado] = useState({ texto: '', incluir: false })
  const [pedido, setPedido] = useState('')
  const [cargando, setCargando] = useState(true)
  const [pensando, setPensando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  useEffect(() => {
    let cancelado = false
    setCargando(true); setError(''); setOk('')
    void supabase.from('presupuestos').select('recomendaciones, recomendaciones_incluir').eq('id', presupuestoId).maybeSingle().then(({ data, error: e }) => {
      if (cancelado) return
      setCargando(false)
      if (e) { setError('Falta correr en Supabase el SQL "supabase-recomendaciones-fase-21.sql" para poder guardar esto.'); return }
      const g = { texto: String(data?.recomendaciones ?? ''), incluir: !!data?.recomendaciones_incluir }
      setTexto(g.texto); setIncluir(g.incluir); setGuardado(g)
    })
    return () => { cancelado = true }
  }, [presupuestoId])

  async function redactar() {
    setError(''); setOk(''); setPensando(true)
    try {
      const r = await pedirAsistente<{ recomendaciones: string[] }>({
        accion: 'recomendaciones', titulo, descripcion: descripcion ?? '', actual: texto, pedido,
        items: items.map((it) => { const p = partirDescripcion(it.descripcion); return p.detalle ? `${p.titulo} (${p.detalle})` : p.titulo }),
      })
      if (!r.recomendaciones?.length) throw new Error('La IA no devolvió recomendaciones. Probá de nuevo.')
      setTexto(r.recomendaciones.join('\n'))
      setIncluir(true)
      setOk('Listo. Revisalo, corregí lo que quieras y tocá Guardar.')
    } catch (e) { setError((e as Error).message) } finally { setPensando(false) }
  }

  async function guardar() {
    setError(''); setOk(''); setGuardando(true)
    const limpio = texto.trim()
    const { error: e } = await supabase.from('presupuestos').update({ recomendaciones: limpio || null, recomendaciones_incluir: incluir && !!limpio }).eq('id', presupuestoId)
    setGuardando(false)
    if (e) { console.error(e); setError('No se pudo guardar. ¿Corriste en Supabase el SQL "supabase-recomendaciones-fase-21.sql"?'); return }
    setGuardado({ texto: limpio, incluir: incluir && !!limpio })
    setTexto(limpio)
    setOk(incluir && limpio ? '✓ Guardado: va en el documento y el PDF.' : '✓ Guardado (no va en el documento).')
    onGuardado()
  }

  const cambios = texto.trim() !== guardado.texto.trim() || (incluir && !!texto.trim()) !== guardado.incluir

  return (
    <details className="presuMas presuRecos">
      <summary>📘 Formas de uso y recomendaciones <span className={guardado.incluir ? 'presuRecosSi' : 'presuRecosNo'}>{guardado.incluir ? 'incluidas' : 'opcional'}</span></summary>
      <div className="presuRecosCuerpo">
        <p className="gestionAyuda" style={{ margin: 0 }}>Consejos de uso para el cliente (apps, cuidados, qué hacer si se corta la luz…). La IA los escribe según los ítems del presupuesto; vos los revisás y elegís si van en el documento.</p>
        {cargando ? <p className="gestionAyuda">Cargando…</p> : <>
          <textarea rows={7} value={texto} onChange={(e) => { setTexto(e.target.value); setOk('') }} placeholder={'Una recomendación por renglón.\nEj.: Desde la app SmartLife podés prender y apagar las luces desde cualquier lugar.'} />
          <div className="presuRecosIA">
            <input value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Pedido para la IA (opcional): ej. más corto, sumá cuidados del riego" />
            <button type="button" className="editButton" disabled={pensando} onClick={() => void redactar()}>{pensando ? 'Escribiendo…' : texto.trim() ? '✨ Mejorar con IA' : '✨ Redactar con IA'}</button>
          </div>
          <label className="caCheck"><input type="checkbox" checked={incluir} onChange={(e) => { setIncluir(e.target.checked); setOk('') }} /> Incluir en el documento y el PDF del cliente</label>
          {error && <p className="loginError" style={{ margin: 0 }}>{error}</p>}
          {ok && <p className="presuRecosOk">{ok}</p>}
          <div className="presuRecosAcc">
            {cambios && <button type="button" className="cancelButton" onClick={() => { setTexto(guardado.texto); setIncluir(guardado.incluir); setOk('') }}>Descartar</button>}
            <button type="button" className="newButton" disabled={guardando || !cambios} onClick={() => void guardar()}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </>}
      </div>
    </details>
  )
}
