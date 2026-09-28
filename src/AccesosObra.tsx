import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { AVISO_ACCESOS, generarPdfAccesos, nombreArchivoAccesos } from './pdfAccesos'
import { confirmarEliminacion } from './confirmar'

// Accesos de la obra: apps, usuarios y contraseñas creadas por el instalador.
// Se entregan al cliente en el PDF "Resumen de accesos".

type Acceso = {
  id: number
  obra_id: number
  app: string
  descripcion: string | null
  detalle: string | null
  usuario: string | null
  contrasena: string | null
  orden: number
}

type Props = { obraId: number; cliente: string; obra: string; ubicacion?: string | null }

const VACIO = { app: '', descripcion: '', detalle: '', usuario: '', contrasena: '' }

export default function AccesosObra({ obraId, cliente, obra, ubicacion }: Props) {
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState<Acceso | null>(null)
  const [form, setForm] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [verClaves, setVerClaves] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let vigente = true
    setCargando(true); setError('')
    void supabase.from('obra_accesos').select('*').eq('obra_id', obraId).order('orden').order('id').then(({ data, error: e }) => {
      if (!vigente) return
      if (e) { console.error(e); setError('No se pudieron cargar los accesos. Verificá que la tabla obra_accesos exista (supabase-accesos-fase-12.sql).') }
      else setAccesos((data ?? []) as Acceso[])
      setCargando(false)
    })
    return () => { vigente = false }
  }, [obraId, revision])

  function abrirNuevo() {
    setEditando(null); setForm(VACIO); setMostrarForm(true)
  }

  function abrirEdicion(a: Acceso) {
    setEditando(a)
    setForm({ app: a.app, descripcion: a.descripcion ?? '', detalle: a.detalle ?? '', usuario: a.usuario ?? '', contrasena: a.contrasena ?? '' })
    setMostrarForm(true)
  }

  function cerrarForm() {
    setMostrarForm(false); setEditando(null); setForm(VACIO)
  }

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!form.app.trim()) return
    setGuardando(true)
    const fila = {
      app: form.app.trim(),
      descripcion: form.descripcion.trim() || null,
      detalle: form.detalle.trim() || null,
      usuario: form.usuario.trim() || null,
      contrasena: form.contrasena || null,
    }
    const r = editando
      ? await supabase.from('obra_accesos').update(fila).eq('id', editando.id)
      : await supabase.from('obra_accesos').insert({ ...fila, obra_id: obraId, orden: accesos.length })
    setGuardando(false)
    if (r.error) { console.error(r.error); window.alert('No se pudo guardar el acceso. Reintentá.'); return }
    cerrarForm(); setRevision((v) => v + 1)
  }

  async function eliminar(a: Acceso) {
    if (!confirmarEliminacion(`¿Eliminar el acceso "${a.app}"?`)) return
    const r = await supabase.from('obra_accesos').delete().eq('id', a.id)
    if (r.error) { console.error(r.error); window.alert('No se pudo eliminar. Reintentá.'); return }
    setRevision((v) => v + 1)
  }

  async function armarPdf() {
    const blob = await generarPdfAccesos({ cliente, obra, ubicacion, accesos })
    return { blob, nombre: nombreArchivoAccesos(cliente, obra) }
  }

  function bajar(blob: Blob, nombre: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = nombre; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  async function descargar() {
    setGenerando(true)
    try { const { blob, nombre } = await armarPdf(); bajar(blob, nombre) }
    catch (e) { console.error(e); window.alert('No se pudo generar el PDF. Reintentá.') }
    finally { setGenerando(false) }
  }

  async function compartir() {
    setGenerando(true)
    try {
      const { blob, nombre } = await armarPdf()
      const file = new File([blob], nombre, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [file] }) && navigator.share) await navigator.share({ files: [file], title: `Resumen de accesos · ${obra}` })
      else bajar(blob, nombre)
    } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) window.alert('No se pudo compartir. Usá Descargar PDF.') }
    finally { setGenerando(false) }
  }

  const oculta = (s: string | null) => (s ? (verClaves ? s : '•'.repeat(Math.min(s.length, 10))) : '—')

  return <section className="obraFotosSeccion" aria-label="Accesos y claves">
    <div className="seguimientoAcciones">
      <div><h3>Accesos y claves</h3><p>Cargá las apps, usuarios y contraseñas que configuraste en la instalación. Generá el PDF para entregarle al cliente el resumen de sus claves.</p></div>
      <div className="adicAcciones">
        <button type="button" className="newButton" onClick={() => (mostrarForm ? cerrarForm() : abrirNuevo())}>{mostrarForm ? 'Cancelar' : '➕ Agregar acceso'}</button>
        <button type="button" className="editButton" disabled={!accesos.length || generando} onClick={() => void descargar()}>{generando ? 'Generando…' : '📄 Descargar PDF'}</button>
        <button type="button" className="editButton" disabled={!accesos.length || generando} onClick={() => void compartir()}>Compartir</button>
      </div>
    </div>

    {mostrarForm && (
      <form className="clienteForm adicForm" onSubmit={guardar}>
        <div className="formGrid">
          <label>Aplicación / equipo *<input required placeholder="Ej.: SmartLife, eWeLink, Router WiFi, Alarma" value={form.app} onChange={(e) => setForm((f) => ({ ...f, app: e.target.value }))} /></label>
          <label>Descripción<input placeholder="Qué controla o para qué sirve" value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} /></label>
          <label>Usuario<input autoComplete="off" value={form.usuario} onChange={(e) => setForm((f) => ({ ...f, usuario: e.target.value }))} /></label>
          <label>Contraseña<input autoComplete="new-password" value={form.contrasena} onChange={(e) => setForm((f) => ({ ...f, contrasena: e.target.value }))} /></label>
          <label className="adicAncho">Detalle<textarea rows={2} placeholder="Datos extra: nombre de la red, código, equipos vinculados, observaciones" value={form.detalle} onChange={(e) => setForm((f) => ({ ...f, detalle: e.target.value }))} /></label>
        </div>
        <div className="formActions"><button type="button" className="cancelButton" onClick={cerrarForm}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Agregar acceso'}</button></div>
      </form>
    )}

    {cargando && <p role="status">Cargando...</p>}
    {error && <p className="loginError" role="alert">{error}</p>}
    {!cargando && !error && <>
      {accesos.length === 0 ? <p className="adicVacio">Todavía no cargaste accesos para esta obra.</p> : <>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', margin: '0 0 8px', fontSize: 14 }}>
          <input type="checkbox" checked={verClaves} onChange={(e) => setVerClaves(e.target.checked)} /> Mostrar contraseñas
        </label>
        <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}><table>
          <thead><tr><th>Aplicación</th><th>Descripción / detalle</th><th>Usuario</th><th>Contraseña</th><th>Acción</th></tr></thead>
          <tbody>{accesos.map((a) => <tr key={a.id}>
            <td><strong>{a.app}</strong></td>
            <td>{a.descripcion || '—'}{a.detalle && <><br /><small>{a.detalle}</small></>}</td>
            <td style={{ fontFamily: 'monospace' }}>{a.usuario || '—'}</td>
            <td style={{ fontFamily: 'monospace' }}>{oculta(a.contrasena)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button type="button" className="adicOk" onClick={() => abrirEdicion(a)}>Editar</button>{' '}
              <button type="button" className="adicNo" onClick={() => void eliminar(a)}>Eliminar</button>
            </td>
          </tr>)}</tbody>
        </table></div>
      </>}
      <p className="gestionAyuda" style={{ marginTop: 12 }}><strong>Aviso que se imprime al pie del PDF:</strong> {AVISO_ACCESOS.join(' ')}</p>
    </>}
  </section>
}
