import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './supabase'
import { hoy } from './gestionFormat'
import CampoNumero from './CampoNumero'

// "➕ Registrar" de la ficha de obra: un solo lugar con todo lo que se carga
// en una obra, explicado en palabras simples. Cada opción lleva directo a su
// formulario (o abre uno acá mismo, como la compra rápida).

export type OpcionRegistrar = 'cobro' | 'pago_empleado' | 'jornal' | 'compra' | 'gasto_reintegro' | 'extra' | 'descuento' | 'avance'

const OPCIONES: { id: OpcionRegistrar; icono: string; titulo: string; texto: string }[] = [
  { id: 'cobro', icono: '💵', titulo: 'Me pagó el cliente', texto: 'Un cobro o seña de esta obra' },
  { id: 'pago_empleado', icono: '👷', titulo: 'Le pagué a un empleado', texto: 'Pago, adelanto o liquidación' },
  { id: 'jornal', icono: '📅', titulo: 'Día trabajado', texto: 'Jornal de alguien del equipo' },
  { id: 'compra', icono: '🧾', titulo: 'Compra o gasto mío', texto: 'Materiales u otro gasto que pagué yo' },
  { id: 'gasto_reintegro', icono: '🔄', titulo: 'Gasto que me devuelve el cliente', texto: 'Lo pagué yo y el cliente me lo reintegra' },
  { id: 'extra', icono: '➕', titulo: 'Extra para cobrarle', texto: 'Producto, servicio o trabajo que no estaba' },
  { id: 'descuento', icono: '🏷️', titulo: 'Descuento al cliente', texto: 'Bonificación sobre el total' },
  { id: 'avance', icono: '🕐', titulo: 'Avance de obra', texto: 'Qué se hizo, % y fotos' },
]

export function MenuRegistrar({ onElegir, onCerrar }: { onElegir: (o: OpcionRegistrar) => void; onCerrar: () => void }) {
  return createPortal(
    <div className="modalOverlay" onClick={onCerrar}>
      <div className="modalCard registrarModal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div><p className="subtitle">REGISTRAR EN LA OBRA</p><h2>¿Qué pasó?</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar}>×</button>
        </div>
        <div className="registrarGrid">
          {OPCIONES.map((o) => (
            <button type="button" key={o.id} onClick={() => onElegir(o.id)}>
              <span className="registrarIcono">{o.icono}</span>
              <strong>{o.titulo}</strong>
              <small>{o.texto}</small>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// Compra o gasto que paga la empresa (queda en Compras como un renglón).
export function CompraRapida({ obraId, onCerrar, onGuardado }: { obraId: number; onCerrar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ descripcion: '', monto: '', proveedor: '', fecha: hoy(), pagado: true })
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    const monto = Number(f.monto)
    if (!f.descripcion.trim()) { setError('Contá qué compraste o en qué gastaste.'); return }
    if (!(monto > 0)) { setError('Poné el monto.'); return }
    setGuardando(true)
    const { data, error: e1 } = await supabase.from('materiales').insert({
      obra_id: obraId, nombre: f.descripcion.trim(), cantidad: 1, unidad: null, precio_unitario: monto,
      proveedor: f.proveedor.trim() || null, fecha: f.fecha, pagado: f.pagado,
    }).select('id').single()
    if (e1 || !data) { console.error(e1); setError('No se pudo guardar el gasto.'); setGuardando(false); return }
    if (archivo) {
      const nombreSeguro = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase() || 'comprobante'
      const ruta = `${obraId}/${data.id}-${Date.now()}-${nombreSeguro}`
      const { error: e2 } = await supabase.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (!e2) await supabase.from('materiales').update({ comprobante_path: ruta }).eq('id', data.id)
      else console.error(e2)
    }
    setGuardando(false)
    onGuardado()
  }

  return createPortal(
    <div className="modalOverlay">
      <div className="modalCard catalogoModal registrarModal">
        <div className="modalHeader">
          <div><p className="subtitle">🧾 COMPRA O GASTO DE LA OBRA</p><h2>Lo pagué yo</h2></div>
          <button type="button" className="modalClose closeButton" onClick={onCerrar}>×</button>
        </div>
        <form className="catalogoForm" onSubmit={guardar}>
          <p className="gestionAyuda" style={{ marginTop: 0 }}>Queda como gasto de la obra (resta en la rentabilidad) y aparece en <b>Compras</b>. No se le cobra al cliente: si te lo tiene que devolver, usá "Gasto que me devuelve el cliente".</p>
          <div className="formGrid">
            <label className="formFull">¿Qué compraste o en qué gastaste? *<input value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} placeholder="Ej.: Cables y térmicas, flete, combustible" autoFocus /></label>
            <label>Monto *<CampoNumero min="0.01" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} placeholder="0" /></label>
            <label>Fecha<input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
            <label className="formFull">Proveedor o lugar<input value={f.proveedor} onChange={(e) => setF({ ...f, proveedor: e.target.value })} placeholder="Opcional" /></label>
          </div>
          <label className="caCheck"><input type="checkbox" checked={f.pagado} onChange={(e) => setF({ ...f, pagado: e.target.checked })} /> Ya está pagado</label>
          <label className="iaFotoBtn" style={{ marginTop: 8 }}>
            <span>📎 {archivo ? archivo.name : 'Adjuntar foto de la factura o ticket'}</span>
            <small>Opcional. Para facturas con muchos renglones usá Compras: la lee sola con IA.</small>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </label>
          {error && <p className="loginError">{error}</p>}
          <div className="modalActions formActions">
            <button type="button" className="cancelButton" onClick={onCerrar}>Cancelar</button>
            <button className="newButton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar gasto'}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
