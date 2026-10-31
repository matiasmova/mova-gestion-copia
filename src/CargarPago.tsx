import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'
import CampoNumero from './CampoNumero'
import { linkWhatsApp } from './whatsapp'

// Cargar un pago al personal: a quién, cuánto, cuándo y a qué obra va.
// Se guarda en "costos" (mano de obra de la obra). En la obra, cada pago se
// descuenta del "Gasto por ayudantes estimado" del presupuesto.
// "Sin obra" queda como gasto general (necesita el SQL de la fase 42).

type Persona = { id: number; nombre: string; apellido: string | null; tipo: string; telefono: string | null; activo: boolean }
type Obra = { id: number; nombre_obra: string }
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const nombrePersona = (p?: { nombre: string; apellido: string | null } | null) => (p ? `${p.nombre} ${p.apellido ?? ''}`.trim() : 'Mano de obra')

export default function CargarPago({ personaId: personaInicial, obraId: obraInicial, onCancelar, onGuardado }: {
  personaId?: number; obraId?: number | null; onCancelar: () => void; onGuardado: (texto: string) => void
}) {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [personaId, setPersonaId] = useState(personaInicial ? String(personaInicial) : '')
  const [obraId, setObraId] = useState(obraInicial != null ? String(obraInicial) : '')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState<{ persona: Persona; monto: number; obra: string } | null>(null)

  useEffect(() => {
    void Promise.all([
      supabase.from('personal').select('id,nombre,apellido,tipo,telefono,activo').order('nombre'),
      supabase.from('obras').select('id,nombre_obra').eq('activo', true).order('nombre_obra'),
    ]).then(([rP, rO]) => {
      setPersonas(((rP.data ?? []) as Persona[]).filter((p) => p.activo !== false || p.id === personaInicial))
      setObras((rO.data ?? []) as Obra[])
    })
  }, [personaInicial])

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('')
    const p = personas.find((x) => x.id === Number(personaId))
    const m = Math.round((Number(monto) || 0) * 100) / 100
    if (!p) { setError('Elegí a quién le pagás.'); return }
    if (!(m > 0)) { setError('Poné el monto del pago.'); return }
    if (!obraId) { setError('Elegí a qué obra va el pago (o "Sin obra").'); return }
    const general = obraId === 'general'
    setGuardando(true)
    const { error: fallo } = await supabase.from('costos').insert({
      obra_id: general ? null : Number(obraId), personal_id: p.id, tipo: p.tipo === 'terciarizado' ? 'terciarizado' : 'mano_obra',
      descripcion: `Pago a ${nombrePersona(p)}${nota.trim() ? ` · ${nota.trim()}` : ''}`, monto: m, fecha,
    })
    setGuardando(false)
    if (fallo) {
      console.error(fallo)
      setError(general && /null|not-null|obra_id/i.test(fallo.message) ? 'Para cargar pagos sin obra falta correr en Supabase el SQL supabase-pagos-personal-fase-42.sql. Mientras tanto elegí una obra.' : 'No se pudo guardar el pago. Probá de nuevo.')
      return
    }
    setListo({ persona: p, monto: m, obra: obras.find((o) => o.id === Number(obraId))?.nombre_obra ?? 'Sin obra (gasto general)' })
  }

  function whatsapp() {
    if (!listo) return
    const url = linkWhatsApp(listo.persona.telefono, `Hola ${listo.persona.nombre}! Te registré un pago de ${moneda(listo.monto)} el ${fecha.split('-').reverse().join('/')}${nota.trim() ? ` (${nota.trim()})` : ''}. Obra: ${listo.obra}.`)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const terminar = () => listo && onGuardado(`Pago de ${moneda(listo.monto)} a ${nombrePersona(listo.persona)} guardado · ${listo.obra}.`)

  return <div className="modalOverlay" onClick={(e) => { if (e.target !== e.currentTarget || guardando) return; if (listo) terminar(); else onCancelar() }}>
    <div className="modalCard cpModal" role="dialog" aria-modal="true" aria-label="Cargar pago">
      <div className="modalHeader"><div><p className="subtitle">PERSONAL</p><h2>{listo ? 'Pago guardado' : '💵 Cargar pago'}</h2></div><button type="button" className="closeButton" disabled={guardando} onClick={() => { if (listo) terminar(); else onCancelar() }} aria-label="Cerrar">×</button></div>
      {listo ? <div className="clienteForm">
        <p className="cpListo"><b>{moneda(listo.monto)}</b> a {nombrePersona(listo.persona)}<small>{listo.obra}{listo.obra.startsWith('Sin obra') ? '' : ' · se descontó del gasto por ayudantes estimado'}</small></p>
        <div className="formActions">
          {listo.persona.telefono && <button type="button" className="editButton" onClick={whatsapp}>💬 Avisarle por WhatsApp</button>}
          <button type="button" className="newButton" onClick={terminar}>Listo</button>
        </div>
      </div> : <form className="clienteForm" onSubmit={guardar}>
        <div className="formGrid">
          <label>Empleado *<select required value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            <option value="">Elegí a quién</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{nombrePersona(p)}</option>)}
          </select></label>
          <label>Monto *<CampoNumero min="0" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="$ 0" /></label>
          <label>Obra *<select required value={obraId} onChange={(e) => setObraId(e.target.value)}>
            <option value="">Elegí la obra</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
            <option value="general">Sin obra (gasto general)</option>
          </select></label>
          <label>Fecha *<input type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <label className="formFull">Nota (opcional)<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: semana del 27 al 31, adelanto" /></label>
        </div>
        <p className="gestionAyuda">El pago a una obra se descuenta del "Gasto por ayudantes estimado" de su presupuesto y baja tu ganancia si superás lo estimado.</p>
        {error && <p className="loginError">{error}</p>}
        <div className="formActions"><button type="button" className="cancelButton" onClick={onCancelar}>Cancelar</button><button className="newButton" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar pago'}</button></div>
      </form>}
    </div>
  </div>
}
