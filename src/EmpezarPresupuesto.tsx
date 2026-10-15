import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import { archivoParaIA, pedirAsistente } from './asistenteIA'
import NuevoCliente from './NuevoCliente'
import NuevaObra from './NuevaObra'
import type { ClienteOpcion, ObraOpcion } from './NuevoPresupuesto'

// Nuevo presupuesto en vivo: solo lo justo para empezar (cliente, obra y,
// si querés, que la IA arme los ítems). Se crea en borrador y se abre directo
// el editor en vivo, donde se sigue armando y se guarda solo.

type Producto = { id: number; tipo: 'producto' | 'servicio'; nombre: string; nombre_presupuesto?: string | null; precio_venta: number; costo_unitario: number }
type ItemIA = { catalogo_id: number | null; descripcion: string; cantidad: number; tipo: 'producto' | 'servicio'; precio_pedido?: number; precio_catalogo?: number; descuento_pct?: number }
type RespuestaIA = { titulo: string; descripcion: string; notas: string; cliente_id?: number | null; obra_id?: number | null; items: ItemIA[] }

type Props = {
  clientes: ClienteOpcion[]
  obras: ObraOpcion[]
  inicial?: { cliente_id: number | null; obra_id: number | null } | null
  onCancelar: () => void
  onCreado: (presupuestoId: number, avisoIA?: string) => void
  // El formulario de antes, por si se prefiere.
  onFormularioCompleto: () => void
}

export default function EmpezarPresupuesto({ clientes, obras, inicial, onCancelar, onCreado, onFormularioCompleto }: Props) {
  const [clientesLista, setClientesLista] = useState(clientes)
  const [obrasLista, setObrasLista] = useState(obras)
  const [clienteId, setClienteId] = useState(inicial?.cliente_id ? String(inicial.cliente_id) : '')
  const [obraId, setObraId] = useState(inicial?.obra_id ? String(inicial.obra_id) : '')
  const [pedido, setPedido] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [conIA, setConIA] = useState(false)
  const [creando, setCreando] = useState<null | 'cliente' | 'obra'>(null)
  const [trabajando, setTrabajando] = useState<'' | 'ia' | 'guardando'>('')
  const [error, setError] = useState('')

  useEffect(() => {
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [])

  const obrasDelCliente = obrasLista.filter((o) => String(o.cliente_id) === clienteId)
  const nombreCliente = (id: string) => { const c = clientesLista.find((x) => String(x.id) === id); return c ? `${c.nombre} ${c.apellido ?? ''}`.trim() : '' }

  async function empezar() {
    setError('')
    const usarIA = conIA && (pedido.trim() || foto)
    if (!clienteId && !usarIA) { setError('Elegí el cliente (o contale a la IA para quién es).'); return }
    let cliente = clienteId, obra = obraId
    let titulo = ''
    let descripcion: string | null = null
    let aviso = ''
    let filas: Record<string, unknown>[] = []

    if (usarIA) {
      setTrabajando('ia')
      try {
        const [img, rCat] = await Promise.all([
          foto ? archivoParaIA(foto) : Promise.resolve(null),
          supabase.from('productos_servicios').select('id, tipo, nombre, nombre_presupuesto, precio_venta, costo_unitario').eq('activo', true),
        ])
        const catalogo = ((rCat.data ?? []) as Producto[])
        const r = await pedirAsistente<RespuestaIA>({ accion: 'presupuesto', pedido: pedido.trim(), ...(img ? { imagen: img.data, mime: img.mime } : {}) })
        filas = r.items.map((it, i) => {
          const p = it.catalogo_id ? catalogo.find((x) => Number(x.id) === Number(it.catalogo_id)) : undefined
          const precio = Number(it.precio_pedido) > 0 ? Number(it.precio_pedido) : Number(p?.precio_venta) || Number(it.precio_catalogo) || 0
          return {
            catalogo_id: p?.id ?? null,
            tipo: p?.tipo ?? it.tipo ?? 'servicio',
            descripcion: (p ? p.nombre_presupuesto?.trim() || p.nombre : it.descripcion) || 'Ítem',
            cantidad: Number(it.cantidad) || 1,
            precio_unitario: precio,
            costo_unitario: Number(p?.costo_unitario) || 0,
            descuento_pct: Number(it.descuento_pct) || 0,
            orden: i,
          }
        })
        titulo = r.titulo?.trim() || ''
        descripcion = r.descripcion?.trim() || null
        // Cliente y obra que nombró el pedido (si no se eligieron a mano).
        if (!cliente && r.cliente_id && clientesLista.some((c) => Number(c.id) === Number(r.cliente_id))) cliente = String(r.cliente_id)
        if (!obra && r.obra_id && obrasLista.some((o) => Number(o.id) === Number(r.obra_id) && String(o.cliente_id) === cliente)) obra = String(r.obra_id)
        const sinPrecio = filas.filter((f) => !(Number(f.precio_unitario) > 0)).length
        aviso = [r.notas, sinPrecio ? `⚠ ${sinPrecio} ítem${sinPrecio === 1 ? '' : 's'} sin precio: tocalos para completarlo.` : ''].filter(Boolean).join(' ')
      } catch (e) {
        setTrabajando('')
        setError((e as Error).message)
        return
      }
      if (!cliente) { setTrabajando(''); setError('La IA armó los ítems pero no reconoció al cliente: elegilo y tocá de nuevo.'); return }
    }

    setTrabajando('guardando')
    const obraElegida = obrasLista.find((o) => String(o.id) === obra)
    const { data, error: fallo } = await supabase.from('presupuestos').insert({
      cliente_id: Number(cliente),
      obra_id: obra ? Number(obra) : null,
      titulo: titulo || (obraElegida ? obraElegida.nombre_obra : `Presupuesto ${nombreCliente(cliente)}`.trim()),
      descripcion,
      fecha: new Date().toISOString().slice(0, 10),
      validez_dias: 15,
      estado: 'borrador',
      descuento: 0,
      total_pagado: 0,
      etapa_trabajo: 'sin_iniciar',
      activo: true,
    }).select('id').single()
    if (fallo || !data) { console.error(fallo); setTrabajando(''); setError('No se pudo crear el presupuesto. Volvé a intentar.'); return }
    if (filas.length) {
      const { error: errItems } = await supabase.from('presupuesto_items').insert(filas.map((f) => ({ ...f, presupuesto_id: data.id })))
      if (errItems) { console.error(errItems); aviso = 'Se creó el presupuesto, pero no se pudieron guardar los ítems de la IA.' }
    }
    setTrabajando('')
    onCreado(Number(data.id), aviso || undefined)
  }

  return createPortal(
    <div className="epFondo" onClick={() => !trabajando && onCancelar()}>
      <div className="epHoja" role="dialog" aria-modal="true" aria-label="Nuevo presupuesto" onClick={(e) => e.stopPropagation()}>
        <div className="epCab">
          <div><small>NUEVO PRESUPUESTO</small><h3>¿Para quién es?</h3></div>
          <button type="button" className="pvCerrar" aria-label="Cerrar" disabled={!!trabajando} onClick={onCancelar}>×</button>
        </div>

        <label className="epCampo">
          <span>Cliente <button type="button" className="epMas" onClick={() => setCreando('cliente')}>＋ Nuevo cliente</button></span>
          <select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setObraId('') }}>
            <option value="">Elegí el cliente…</option>
            {[...clientesLista].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((c) => <option key={c.id} value={c.id}>{`${c.nombre} ${c.apellido ?? ''}`.trim()}</option>)}
          </select>
        </label>

        {clienteId && <label className="epCampo">
          <span>Obra <em>(opcional)</em> <button type="button" className="epMas" onClick={() => setCreando('obra')}>＋ Nueva obra</button></span>
          <select value={obraId} onChange={(e) => setObraId(e.target.value)}>
            <option value="">Sin obra por ahora</option>
            {obrasDelCliente.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
          </select>
        </label>}

        <div className={`epIA${conIA ? ' abierta' : ''}`}>
          <button type="button" className="epIACab" aria-expanded={conIA} onClick={() => setConIA((v) => !v)}>
            <span>✨ <b>Armar con IA</b> <small>(opcional)</small></span><em>{conIA ? '−' : '＋'}</em>
          </button>
          {conIA && <>
            <textarea rows={3} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ej.: casa de 200 m², WiFi en todo el terreno, 4 cámaras afuera, domótica de luces en living y cocina" />
            <label className="epFoto">📷 {foto ? foto.name : 'Sumar foto o plano'}<input type="file" accept="image/*,application/pdf" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} /></label>
            <small className="epAyuda">🎤 Podés dictarlo con el micrófono del teclado.</small>
          </>}
        </div>

        {error && <p role="alert" className="epError">{error}</p>}

        <button type="button" className="epEmpezar" disabled={!!trabajando} onClick={() => void empezar()}>
          {trabajando === 'ia' ? '✨ La IA está armando los ítems…' : trabajando === 'guardando' ? 'Creando…' : conIA && (pedido.trim() || foto) ? '✨ Armar y empezar' : 'Empezar presupuesto →'}
        </button>
        <small className="epAyuda">Se abre en vivo: agregás ítems, ves cómo lo recibe el cliente y se guarda solo.</small>
        <button type="button" className="epLink" disabled={!!trabajando} onClick={onFormularioCompleto}>Prefiero el formulario completo</button>

        {creando === 'cliente' && createPortal(<NuevoCliente
          onCancelar={() => setCreando(null)}
          onGuardado={() => setCreando(null)}
          onCreado={(nuevo) => { setClientesLista((l) => [...l, nuevo as ClienteOpcion]); setClienteId(String(nuevo.id)); setObraId(''); setCreando(null) }}
        />, document.body)}
        {creando === 'obra' && createPortal(<NuevaObra
          clientes={clientesLista}
          clienteInicial={clientesLista.find((c) => String(c.id) === clienteId) ?? null}
          onCancelar={() => setCreando(null)}
          onGuardada={() => setCreando(null)}
          onCreada={(nueva) => { setObrasLista((l) => [...l, nueva as ObraOpcion]); setClienteId(String(nueva.cliente_id)); setObraId(String(nueva.id)); setCreando(null) }}
        />, document.body)}
      </div>
    </div>,
    document.body,
  )
}
