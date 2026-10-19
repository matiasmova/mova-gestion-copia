import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { importeNeto } from './presupuestoCalculos'
import { esProducto } from './gananciaTrabajo'

// Arriba de Productos: la plata del negocio separada en dos.
//  · Productos: lo invertido en stock (costo × stock), lo que valdría vendido
//    y cuánto ganarías con ese stock, también producto por producto.
//  · Servicios: lo vendido este mes, lo pagado a empleados y lo que te quedó.

type Elemento = { id: number; tipo: string; nombre: string; activo: boolean; costo_unitario: number; precio_venta: number; stock: number; fotoView?: string | null }

export default function ResumenProductos({ elementos, mostrar, onTipo }: { elementos: Elemento[]; mostrar: (n: number) => string; onTipo: (t: 'producto' | 'servicio') => void }) {
  const [lado, setLado] = useState<'producto' | 'servicio'>('producto')
  const [verTodos, setVerTodos] = useState(false)
  const [serv, setServ] = useState<{ vendido: number; empleados: number; top: [string, number, number][] } | null>(null)

  const productos = elementos.filter((e) => e.tipo === 'producto' && e.activo && e.stock > 0)
  const invertido = productos.reduce((s, e) => s + e.costo_unitario * e.stock, 0)
  const valor = productos.reduce((s, e) => s + e.precio_venta * e.stock, 0)
  const ganarias = valor - invertido
  const filas = productos.map((e) => ({ e, inv: e.costo_unitario * e.stock, gana: (e.precio_venta - e.costo_unitario) * e.stock })).sort((a, b) => b.gana - a.gana)
  const sinCosto = productos.filter((e) => !(e.costo_unitario > 0)).length

  useEffect(() => {
    if (lado !== 'servicio' || serv) return
    void (async () => {
      const d = new Date()
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const [rP, rC] = await Promise.all([
        supabase.from('presupuestos').select('id, fecha, activo').eq('estado', 'aceptado'),
        supabase.from('costos').select('monto, fecha, tipo, personal_id'),
      ])
      const ids = ((rP.data ?? []) as { id: number; fecha: string | null; activo: boolean | null }[]).filter((p) => p.activo !== false && (p.fecha ?? '').slice(0, 7) === ym).map((p) => p.id)
      const items: { tipo: string; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct: number | null }[] = []
      for (let i = 0; i < ids.length; i += 200) {
        const r = await supabase.from('presupuesto_items').select('tipo, descripcion, cantidad, precio_unitario, descuento_pct').in('presupuesto_id', ids.slice(i, i + 200))
        if (!r.error) items.push(...((r.data ?? []) as typeof items))
      }
      const porNombre: Record<string, [number, number]> = {}
      let vendido = 0
      items.filter((it) => !esProducto(it.tipo)).forEach((it) => {
        const n = importeNeto({ cantidad: Number(it.cantidad), precio_unitario: Number(it.precio_unitario), descuento_pct: it.descuento_pct })
        vendido += n
        const k = (it.descripcion || 'Servicio').split('\n')[0].trim()
        const v = (porNombre[k] ??= [0, 0]); v[0] += Number(it.cantidad) || 0; v[1] += n
      })
      const empleados = ((rC.data ?? []) as { monto: unknown; fecha: string; tipo: string | null; personal_id: number | null }[])
        .filter((c) => (c.personal_id != null || c.tipo === 'mano_obra') && (c.fecha ?? '').slice(0, 7) === ym).reduce((s, c) => s + (Number(c.monto) || 0), 0)
      setServ({ vendido, empleados, top: Object.entries(porNombre).map(([k, [c, m]]) => [k, c, m] as [string, number, number]).sort((a, b) => b[2] - a[2]).slice(0, 6) })
    })()
  }, [lado, serv])

  const elegir = (t: 'producto' | 'servicio') => { setLado(t); onTipo(t) }
  const mes = new Date().toLocaleDateString('es-AR', { month: 'long' })

  return <section className="rpCaja" aria-label="Plata en productos y servicios">
    <div className="rpSeg" role="tablist">
      <button type="button" role="tab" aria-selected={lado === 'producto'} className={lado === 'producto' ? 'on' : ''} onClick={() => elegir('producto')}>📦 Productos</button>
      <button type="button" role="tab" aria-selected={lado === 'servicio'} className={lado === 'servicio' ? 'on' : ''} onClick={() => elegir('servicio')}>🛠️ Servicios</button>
    </div>
    {lado === 'producto' ? <>
      <div className="rpKpis">
        <div><small>Plata invertida en stock</small><b>{mostrar(invertido)}</b><span>lo que te costó lo que tenés</span></div>
        <div><small>Si vendés todo el stock</small><b>{mostrar(valor)}</b><span>a precio de venta</span></div>
        <div className="gan"><small>Ganarías con ese stock</small><b>{mostrar(ganarias)}</b><span>{invertido > 0 ? `${Math.round((ganarias / invertido) * 100)}% sobre lo invertido` : 'cargá el costo de tus productos'}</span></div>
      </div>
      {sinCosto > 0 && <p className="rpAlerta">⚠️ {sinCosto} producto{sinCosto === 1 ? '' : 's'} con stock y sin costo: la ganancia aparece de más. Cargales el costo.</p>}
      {filas.length > 0 && <div className="rpLista">
        {(verTodos ? filas : filas.slice(0, 4)).map(({ e, inv, gana }) => (
          <div key={e.id} className="rpFila">
            <span className="rpFoto">{e.fotoView ? <img src={e.fotoView} alt="" /> : '📦'}</span>
            <div><b>{e.nombre}</b><small>Stock {e.stock} · costo {mostrar(e.costo_unitario)} · venta {mostrar(e.precio_venta)}</small></div>
            <em>{mostrar(inv)}<small className={gana >= 0 ? 'v' : 'r'}>gana {mostrar(gana)}</small></em>
          </div>
        ))}
        {filas.length > 4 && <button type="button" className="rpMas" onClick={() => setVerTodos((v) => !v)}>{verTodos ? 'Ver menos' : `Ver producto por producto (${filas.length})`}</button>}
      </div>}
    </> : <>
      <div className="rpKpis">
        <div><small>Servicios vendidos en {mes}</small><b>{serv ? mostrar(serv.vendido) : '…'}</b><span>instalaciones y mano de obra</span></div>
        <div><small>Pagado a empleados</small><b className="r">{serv ? `− ${mostrar(serv.empleados)}` : '…'}</b><span>en {mes}</span></div>
        <div className="gan"><small>Te quedó de servicios</small><b>{serv ? mostrar(serv.vendido - serv.empleados) : '…'}</b><span>{serv && serv.vendido > 0 ? `${Math.round(((serv.vendido - serv.empleados) / serv.vendido) * 100)}% de lo vendido` : 'de presupuestos aceptados este mes'}</span></div>
      </div>
      {serv && serv.top.length > 0 && <div className="rpLista">
        {serv.top.map(([k, c, m]) => <div key={k} className="rpFila"><span className="rpFoto">🛠️</span><div><b>{k}</b><small>{c.toLocaleString('es-AR')} vendido{c === 1 ? '' : 's'} en {mes}</small></div><em>{mostrar(m)}</em></div>)}
      </div>}
      <p className="rpNota">Los servicios no tienen stock: ves cuánto vendiste y qué te quedó después de pagar a los empleados.</p>
    </>}
  </section>
}
