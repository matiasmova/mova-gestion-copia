import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import { avisoGuardado } from './Animados'
import { comprimirImagen } from './fotosProducto'

// Línea de tiempo de un presupuesto, editable: fechas de cada paso, cambio de
// etapa y notas con foto (ej. "lo llamé", captura del WhatsApp donde aceptó).
// Las notas usan la tabla presupuesto_notas (SQL fase 32).

type Nota = { id: number; fecha: string; texto: string | null; foto_path: string | null; usuario: string | null; url?: string }

type Props = {
  presupuesto: { id: number; estado: string; fecha: string; enviado_at?: string | null; obra_id: number | null }
  motivoRechazo?: string | null
  onCerrar: () => void
  onCambiarEstado: (v: string) => void // borrador / enviado / aceptado / rechazado
  onCambio: () => void // se guardó algo: recargar
}

const BUCKET = 'presupuestos'
const hoy = () => new Date().toISOString().slice(0, 10)
const fechaLarga = (f: string) => new Date(`${f.slice(0, 10)}T12:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })

export default function LineaPresupuesto({ presupuesto, motivoRechazo, onCerrar, onCambiarEstado, onCambio }: Props) {
  const [fechaArmado, setFechaArmado] = useState(presupuesto.fecha.slice(0, 10))
  const [fechaEnvio, setFechaEnvio] = useState((presupuesto.enviado_at || '').slice(0, 10))
  const [notas, setNotas] = useState<Nota[] | null>(null)
  const [faltaSql, setFaltaSql] = useState(false)
  const [nueva, setNueva] = useState<{ texto: string; fecha: string; foto: File | null; vista: string } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function cargarNotas() {
    const { data, error: fallo } = await supabase.from('presupuesto_notas').select('id, fecha, texto, foto_path, usuario').eq('presupuesto_id', presupuesto.id).order('fecha', { ascending: false }).order('id', { ascending: false })
    if (fallo) { setFaltaSql(true); setNotas([]); return }
    const lista = (data ?? []) as Nota[]
    const rutas = lista.map((n) => n.foto_path).filter((x): x is string => !!x)
    if (rutas.length) {
      const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(rutas, 3600)
      for (const n of lista) n.url = urls?.find((u) => u.path === n.foto_path)?.signedUrl ?? undefined
    }
    setNotas(lista)
  }
  useEffect(() => { void cargarNotas() }, [presupuesto.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (nueva?.vista) URL.revokeObjectURL(nueva.vista) }, [nueva?.vista])

  async function guardarFecha(campo: 'fecha' | 'enviado_at', valor: string) {
    if (!valor) return
    setError('')
    const { error: fallo } = await supabase.from('presupuestos').update({ [campo]: campo === 'fecha' ? valor : `${valor}T12:00:00` }).eq('id', presupuesto.id)
    if (fallo) { console.error(fallo); setError('No se pudo guardar la fecha.'); return }
    avisoGuardado('Fecha actualizada')
    onCambio()
  }

  async function guardarNota() {
    if (!nueva || (!nueva.texto.trim() && !nueva.foto)) { setError('Escribí una nota o sumá una foto.'); return }
    setError(''); setGuardando(true)
    let foto_path: string | null = null
    if (nueva.foto) {
      const blob = await comprimirImagen(nueva.foto)
      const tipo = blob.type || nueva.foto.type || 'image/jpeg'
      const ext = tipo.includes('png') ? 'png' : tipo.includes('webp') ? 'webp' : 'jpg'
      const ruta = `${presupuesto.id}/${Date.now()}.${ext}`
      const subida = await supabase.storage.from(BUCKET).upload(ruta, blob, { contentType: tipo })
      if (subida.error) { console.error(subida.error); setGuardando(false); setError('No se pudo subir la foto: falta correr en Supabase el SQL "supabase-notas-presupuesto-fase-32.sql".'); return }
      foto_path = ruta
    }
    const { error: fallo } = await supabase.from('presupuesto_notas').insert({ presupuesto_id: presupuesto.id, fecha: nueva.fecha || hoy(), texto: nueva.texto.trim() || null, foto_path })
    setGuardando(false)
    if (fallo) { console.error(fallo); setError('No se pudo guardar la nota: falta correr en Supabase el SQL "supabase-notas-presupuesto-fase-32.sql".'); return }
    setNueva(null)
    avisoGuardado('Nota guardada')
    void cargarNotas()
  }

  async function borrarNota(n: Nota) {
    if (!window.confirm('¿Borrar esta nota?')) return
    if (n.foto_path) await supabase.storage.from(BUCKET).remove([n.foto_path])
    await supabase.from('presupuesto_notas').delete().eq('id', n.id)
    void cargarNotas()
  }

  const est = presupuesto.estado
  const enviado = est !== 'borrador'
  const respondio = est === 'aceptado' || est === 'rechazado'
  // El cambio de etapa cierra la hoja (aceptar y rechazar abren su propia ventana).
  const cambiar = (v: string) => { onCerrar(); onCambiarEstado(v) }

  return createPortal(
    <div className="oeHojaFondo" onClick={onCerrar}>
      <div className="oeHoja lpHoja" role="dialog" aria-modal="true" aria-label="Línea de tiempo del presupuesto" onClick={(e) => e.stopPropagation()}>
        <div className="oeHojaCab">
          <h3>🕑 Línea de tiempo</h3>
          <button type="button" className="fichaIcono" aria-label="Cerrar" onClick={onCerrar}>×</button>
        </div>

        <ol className="lpPasos">
          <li className="ok">
            <i aria-hidden>📝</i>
            <div><b>Armado</b>
              <label className="lpFecha">Fecha del presupuesto<input type="date" value={fechaArmado} onChange={(e) => setFechaArmado(e.target.value)} onBlur={() => fechaArmado !== presupuesto.fecha.slice(0, 10) && void guardarFecha('fecha', fechaArmado)} /></label>
            </div>
          </li>
          <li className={enviado ? 'ok' : 'actual'}>
            <i aria-hidden>📤</i>
            <div><b>Enviado</b>
              {enviado
                ? <label className="lpFecha">Fecha de envío<input type="date" value={fechaEnvio} onChange={(e) => setFechaEnvio(e.target.value)} onBlur={() => fechaEnvio && fechaEnvio !== (presupuesto.enviado_at || '').slice(0, 10) && void guardarFecha('enviado_at', fechaEnvio)} /></label>
                : <><small>Todavía no se lo mandaste.</small><button type="button" className="lpBtn" onClick={() => cambiar('enviado')}>Marcar como enviado</button></>}
            </div>
          </li>
          <li className={respondio ? (est === 'aceptado' ? 'ok' : 'no') : enviado ? 'actual' : ''}>
            <i aria-hidden>{est === 'rechazado' ? '❌' : '✅'}</i>
            <div><b>{est === 'aceptado' ? 'Aceptó' : est === 'rechazado' ? 'No salió' : 'Respuesta del cliente'}</b>
              {est === 'rechazado' && motivoRechazo && <small>Motivo: {motivoRechazo}</small>}
              <div className="lpChips">
                {est !== 'aceptado' && <button type="button" className="si" onClick={() => cambiar('aceptado')}>✅ Aceptó</button>}
                {est !== 'rechazado' && <button type="button" className="no" onClick={() => cambiar('rechazado')}>❌ No salió</button>}
                {respondio && <button type="button" onClick={() => cambiar('enviado')}>↩️ Volver a enviado</button>}
                {enviado && <button type="button" onClick={() => cambiar('borrador')}>↩️ Volver a borrador</button>}
              </div>
            </div>
          </li>
          <li className={presupuesto.obra_id != null && est === 'aceptado' ? 'ok' : ''}>
            <i aria-hidden>🏗️</i>
            <div><b>Obra</b><small>{presupuesto.obra_id != null && est === 'aceptado' ? 'Creada: los avances se cargan en la obra.' : 'Se crea cuando el cliente acepta.'}</small></div>
          </li>
        </ol>

        <div className="lpNotasCab">
          <b>Notas y fotos</b>
          {!nueva && <button type="button" className="lpBtn" onClick={() => setNueva({ texto: '', fecha: hoy(), foto: null, vista: '' })}>＋ Agregar</button>}
        </div>
        {faltaSql && <p className="gestionAyuda">Para guardar notas y fotos falta correr en Supabase el SQL <b>supabase-notas-presupuesto-fase-32.sql</b>.</p>}

        {nueva && <div className="lpNueva">
          <textarea rows={2} autoFocus value={nueva.texto} onChange={(e) => setNueva({ ...nueva, texto: e.target.value })} placeholder="Ej.: Lo llamé, pidió cambiar las teclas por las de 3 módulos" />
          <div className="lpNuevaFila">
            <input type="date" value={nueva.fecha} onChange={(e) => setNueva({ ...nueva, fecha: e.target.value })} aria-label="Fecha de la nota" />
            <label className="lpFoto">
              {nueva.vista ? <img src={nueva.vista} alt="Foto" /> : '📷 Foto'}
              <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; setNueva({ ...nueva, foto: f, vista: f ? URL.createObjectURL(f) : '' }) }} />
            </label>
          </div>
          <div className="pvAcc">
            <button type="button" onClick={() => setNueva(null)}>Cancelar</button>
            <button type="button" className="listo" disabled={guardando} onClick={() => void guardarNota()}>{guardando ? 'Guardando…' : '✓ Guardar'}</button>
          </div>
        </div>}

        {error && <p role="alert" className="oeError">{error}</p>}

        {notas === null ? <p className="oeCargando">Cargando…</p> : notas.length === 0 && !nueva && !faltaSql
          ? <p className="gestionAyuda">Sin notas todavía. Sumá lo que vaya pasando con este presupuesto.</p>
          : <ul className="lpNotas">
              {notas.map((n) => <li key={n.id}>
                {n.url && <a href={n.url} target="_blank" rel="noreferrer"><img src={n.url} alt="Foto de la nota" /></a>}
                <div>
                  <small>{fechaLarga(n.fecha)}{n.usuario ? ` · ${n.usuario.split('@')[0]}` : ''}</small>
                  {n.texto && <p>{n.texto}</p>}
                </div>
                <button type="button" aria-label="Borrar nota" onClick={() => void borrarNota(n)}>🗑</button>
              </li>)}
            </ul>}
      </div>
    </div>,
    document.body,
  )
}
