import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { fechaCorta, moneda, hoy } from './gestionFormat'

type Obra = { id: number; nombre_obra: string }
type Material = {
  id: number
  obra_id: number
  nombre: string
  cantidad: number
  unidad: string | null
  precio_unitario: number
  proveedor: string | null
  fecha: string
  numero_comprobante: string | null
  comprobante_path: string | null
}
type MaterialConUrl = Material & { comprobante_url: string | null }
type Pestana = 'materiales' | 'comprobantes'

function Compras() {
  const [obras, setObras] = useState<Obra[]>([])
  const [materiales, setMateriales] = useState<MaterialConUrl[]>([])
  const [pestana, setPestana] = useState<Pestana>('materiales')
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [actualizacion, setActualizacion] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError('')
      const [rObras, rMateriales] = await Promise.all([
        supabase.from('obras').select('id, nombre_obra').eq('activo', true).order('nombre_obra'),
        supabase.from('materiales').select('id, obra_id, nombre, cantidad, unidad, precio_unitario, proveedor, fecha, numero_comprobante, comprobante_path').order('fecha', { ascending: false }).order('created_at', { ascending: false }),
      ])
      if (rObras.error || rMateriales.error) {
        console.error(rObras.error || rMateriales.error)
        setError('Falta ejecutar el archivo supabase-compras-fase-5.sql en Supabase.')
        setCargando(false)
        return
      }

      setObras((rObras.data ?? []) as Obra[])
      const base = (rMateriales.data ?? []).map((material) => ({
        ...material,
        cantidad: Number(material.cantidad),
        precio_unitario: Number(material.precio_unitario),
        comprobante_url: null,
      })) as MaterialConUrl[]

      const conUrls = await Promise.all(base.map(async (material) => {
        if (!material.comprobante_path) return material
        const { data } = await supabase.storage.from('comprobantes').createSignedUrl(material.comprobante_path, 3600)
        return { ...material, comprobante_url: data?.signedUrl ?? null }
      }))
      setMateriales(conUrls)
      setCargando(false)
    }
    cargar()
  }, [actualizacion])

  const comprobantes = useMemo(
    () => materiales.filter((material) => material.comprobante_path),
    [materiales],
  )
  const totalCompras = materiales.reduce(
    (suma, material) => suma + material.cantidad * material.precio_unitario,
    0,
  )
  const nombreObra = (id: number) => obras.find((obra) => obra.id === id)?.nombre_obra ?? 'Obra no disponible'

  return <div className="gestionPage">
    <div className="pageHeader"><div><p className="subtitle">COMPRAS Y MATERIALES</p><h2>Compras</h2><p className="welcome">Materiales y comprobantes vinculados a cada obra</p></div><button className="newButton" onClick={() => setMostrarFormulario(true)}>+ Registrar compra</button></div>

    <div className="comprasResumen">
      <div><span>TOTAL COMPRAS</span><strong>{moneda(totalCompras)}</strong><small>Se refleja automáticamente en Finanzas</small></div>
      <div><span>COMPROBANTES</span><strong>{comprobantes.length}</strong><small>Facturas y tickets guardados</small></div>
    </div>

    <div className="gestionTabs">
      <button className={pestana === 'materiales' ? 'active' : ''} onClick={() => setPestana('materiales')}>Materiales</button>
      <button className={pestana === 'comprobantes' ? 'active' : ''} onClick={() => setPestana('comprobantes')}>Comprobantes</button>
    </div>

    {cargando && <p>Cargando compras...</p>}
    {error && <p className="loginError">{error}</p>}

    {!cargando && !error && pestana === 'materiales' && <div className="gestionTabla"><table><thead><tr><th>Fecha</th><th>Material</th><th>Obra</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th><th>Proveedor</th><th>Comprobante</th></tr></thead><tbody>
      {materiales.length === 0 ? <tr><td colSpan={8}>Todavía no hay compras cargadas.</td></tr> : materiales.map((material) => <tr key={material.id}><td>{fechaCorta(material.fecha)}</td><td><strong>{material.nombre}</strong></td><td>{nombreObra(material.obra_id)}</td><td>{material.cantidad} {material.unidad}</td><td>{moneda(material.precio_unitario)}</td><td><strong>{moneda(material.cantidad * material.precio_unitario)}</strong></td><td>{material.proveedor || '—'}</td><td>{material.comprobante_url ? <a className="comprobanteEnlace" href={material.comprobante_url} target="_blank" rel="noreferrer">Ver archivo</a> : '—'}</td></tr>)}
    </tbody></table></div>}

    {!cargando && !error && pestana === 'comprobantes' && (
      comprobantes.length === 0 ? <div className="empty comprasVacio"><span>🧾</span><h3>Todavía no hay comprobantes</h3><p>Podés adjuntar una foto o PDF al registrar una compra.</p></div> : <div className="comprobantesGrid">{comprobantes.map((material) => {
        const esPdf = material.comprobante_path?.toLowerCase().endsWith('.pdf')
        return <a key={material.id} href={material.comprobante_url ?? '#'} target="_blank" rel="noreferrer" className="comprobanteCard">
          <div className="comprobanteVista">{esPdf ? <span>PDF</span> : material.comprobante_url ? <img src={material.comprobante_url} alt={`Comprobante de ${material.proveedor || material.nombre}`} /> : <span>🧾</span>}</div>
          <div className="comprobanteInfo"><strong>{material.proveedor || 'Proveedor no informado'}</strong><span>{material.numero_comprobante || 'Sin número'} · {fechaCorta(material.fecha)}</span><small>{nombreObra(material.obra_id)}</small><b>{moneda(material.cantidad * material.precio_unitario)}</b></div>
        </a>
      })}</div>
    )}

    {mostrarFormulario && <FormularioCompra obras={obras} onCancelar={() => setMostrarFormulario(false)} onGuardado={() => { setMostrarFormulario(false); setActualizacion((valor) => valor + 1) }} />}
  </div>
}

function FormularioCompra({ obras, onCancelar, onGuardado }: { obras: Obra[]; onCancelar: () => void; onGuardado: () => void }) {
  const [formulario, setFormulario] = useState({ obra_id: '', nombre: '', cantidad: '1', unidad: 'unidad', precio_unitario: '', proveedor: '', fecha: hoy(), numero_comprobante: '' })
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const archivoRef = useRef<HTMLInputElement>(null)
  const actualizar = (campo: string, valor: string) => setFormulario((actual) => ({ ...actual, [campo]: valor }))
  const subtotal = Number(formulario.cantidad || 0) * Number(formulario.precio_unitario || 0)

  async function guardar(evento: FormEvent) {
    evento.preventDefault(); setGuardando(true); setError('')
    const { data: material, error: errorMaterial } = await supabase.from('materiales').insert({
      obra_id: Number(formulario.obra_id), nombre: formulario.nombre.trim(), cantidad: Number(formulario.cantidad), unidad: formulario.unidad.trim() || null, precio_unitario: Number(formulario.precio_unitario), proveedor: formulario.proveedor.trim() || null, fecha: formulario.fecha, numero_comprobante: formulario.numero_comprobante.trim() || null,
    }).select('id').single()

    if (errorMaterial || !material) { console.error(errorMaterial); setError('No se pudo guardar la compra.'); setGuardando(false); return }

    if (archivo) {
      const extension = archivo.name.split('.').pop()?.toLowerCase() || 'archivo'
      const nombreSeguro = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
      const ruta = `${formulario.obra_id}/${material.id}-${Date.now()}-${nombreSeguro || `comprobante.${extension}`}`
      const { error: errorArchivo } = await supabase.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (errorArchivo) { console.error(errorArchivo); setError('La compra se guardó, pero no se pudo subir el comprobante.'); setGuardando(false); return }

      const { error: errorRuta } = await supabase.from('materiales').update({ comprobante_path: ruta }).eq('id', material.id)
      if (errorRuta) {
        console.error(errorRuta)
        await supabase.storage.from('comprobantes').remove([ruta])
        setError('La compra se guardó, pero no se pudo vincular el comprobante.')
        setGuardando(false)
        return
      }
    }
    onGuardado()
  }

  return <div className="modalOverlay"><div className="modalCard"><div className="modalHeader"><div><p className="subtitle">NUEVA COMPRA</p><h2>Registrar compra</h2></div><button type="button" className="closeButton" onClick={onCancelar}>×</button></div><form className="clienteForm" onSubmit={guardar}><div className="formGrid">
    <label>Obra *<select required value={formulario.obra_id} onChange={(e) => actualizar('obra_id', e.target.value)}><option value="">Seleccionar obra</option>{obras.map((obra) => <option key={obra.id} value={obra.id}>{obra.nombre_obra}</option>)}</select></label>
    <label>Material *<input required value={formulario.nombre} onChange={(e) => actualizar('nombre', e.target.value)} placeholder="Ej.: Cable UTP Cat 6" /></label>
    <label>Cantidad *<input type="number" min="0.01" step="0.01" required value={formulario.cantidad} onChange={(e) => actualizar('cantidad', e.target.value)} /></label>
    <label>Unidad<input value={formulario.unidad} onChange={(e) => actualizar('unidad', e.target.value)} placeholder="unidad, metro, caja..." /></label>
    <label>Precio unitario *<input type="number" min="0" step="0.01" required value={formulario.precio_unitario} onChange={(e) => actualizar('precio_unitario', e.target.value)} /></label>
    <label>Proveedor<input value={formulario.proveedor} onChange={(e) => actualizar('proveedor', e.target.value)} /></label>
    <label>Fecha *<input type="date" required value={formulario.fecha} onChange={(e) => actualizar('fecha', e.target.value)} /></label>
    <label>Número de comprobante<input value={formulario.numero_comprobante} onChange={(e) => actualizar('numero_comprobante', e.target.value)} /></label>
    <label className="formFull">Factura o ticket (opcional)<input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} /></label>
  </div><p className="compraSubtotal">Costo que se enviará a Finanzas: <strong>{moneda(subtotal)}</strong></p>{error && <p className="loginError">{error}</p>}<div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar compra'}</button></div></form></div></div>
}

export default Compras
