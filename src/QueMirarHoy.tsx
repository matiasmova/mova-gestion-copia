import { useEffect, useState } from 'react'
import { pedirAsistente } from './asistenteIA'
import { supabase } from './supabase'
import { moneda } from './gestionFormat'
import { motivoSeguimiento, type PresupuestoSeguimiento } from './SeguimientoPresupuestos'

// "Qué mirar hoy": la IA elige lo más importante del día a partir de lo que
// ya calcula Inicio (cobros, personal, agenda, borradores) más los
// presupuestos para seguir. Se guarda por día en este navegador.

export type DestinoHoy = 'agenda' | 'obras' | 'presupuestos' | 'cobranzas' | 'personal' | 'gastos'
type Resumen = { saludo: string; puntos: { icono: string; texto: string; ir: DestinoHoy | 'ninguno' }[] }

const CLAVE = 'mova_que_mirar_hoy_v1'
const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const firmaDe = (h: string[]) => { let x = 0; for (const c of h.join('|')) x = (x * 31 + c.charCodeAt(0)) | 0; return String(x) }

function leer(): { fecha: string; firma: string; r: Resumen } | null {
  try { return JSON.parse(localStorage.getItem(CLAVE) || 'null') } catch { return null }
}
function guardar(firma: string, r: Resumen) {
  try { localStorage.setItem(CLAVE, JSON.stringify({ fecha: hoyLocal(), firma, r })) } catch { /* sin almacenamiento */ }
}

// Presupuestos enviados que piden seguimiento (misma regla que la pantalla Presupuestos).
async function presupuestosParaSeguir(nombreCli: (id: number) => string): Promise<string[]> {
  const base = 'id,titulo,cliente_id,fecha,validez_dias,estado,total,created_at'
  let r = await supabase.from('presupuestos').select(`${base},enviado_at,seguimiento_at`).eq('activo', true).eq('estado', 'enviado')
  if (r.error) r = await supabase.from('presupuestos').select(base).eq('activo', true).eq('estado', 'enviado') as typeof r
  let dias = 5
  try { dias = Number(localStorage.getItem('mova_dias_seguimiento')) || 5 } catch { /* por defecto */ }
  return ((r.data ?? []) as PresupuestoSeguimiento[])
    .map((p) => ({ p, m: motivoSeguimiento({ ...p, total: Number(p.total) || 0 }, dias) }))
    .filter((x) => x.m).sort((a, b) => a.m!.orden - b.m!.orden).slice(0, 8)
    .map(({ p, m }) => `Presupuesto enviado para seguir: "${p.titulo}" de ${nombreCli(p.cliente_id)} por ${moneda(Number(p.total) || 0)} · ${m!.texto}`)
}

export default function QueMirarHoy({ hechos, nombreCli, onIr }: { hechos: string[]; nombreCli: (id: number) => string; onIr: (d: DestinoHoy) => void }) {
  const [resumen, setResumen] = useState<Resumen | null>(() => leer()?.fecha === hoyLocal() ? leer()!.r : null)
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState('')
  const [abierto, setAbierto] = useState(true)

  async function pedir(forzar: boolean) {
    setError(''); setPensando(true)
    try {
      const todos = [...hechos, ...(await presupuestosParaSeguir(nombreCli))]
      const firma = firmaDe(todos)
      const previo = leer()
      if (!forzar && previo && previo.fecha === hoyLocal() && previo.firma === firma) { setResumen(previo.r); return }
      const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
      const r = await pedirAsistente<Resumen>({ accion: 'resumen_dia', hoy, hechos: todos })
      setResumen(r); guardar(firma, r)
    } catch (e) { setError((e as Error).message) } finally { setPensando(false) }
  }

  // Se arma solo al entrar (esperando un instante a que terminen de llegar los
  // datos); si lo del día no cambió, usa lo guardado.
  const clave = hechos.join('|')
  useEffect(() => {
    const t = setTimeout(() => { void pedir(false) }, 900)
    return () => clearTimeout(t)
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="hoyIA">
      <button type="button" className="hoyIACab" aria-expanded={abierto} onClick={() => setAbierto((v) => !v)}>
        <span>✨ Qué mirar hoy</span>
        {resumen?.saludo && !abierto && <small>{resumen.saludo}</small>}
        <b>{abierto ? '▲' : '▼'}</b>
      </button>
      {abierto && <div className="hoyIACuerpo">
        {pensando && !resumen && <p className="hoyIACargando"><span className="mercadoSpinner" /> Mirando tu día…</p>}
        {resumen && <>
          {resumen.saludo && <p className="hoyIASaludo">{resumen.saludo}</p>}
          <ul>
            {resumen.puntos.map((x, k) => (
              <li key={k}>
                {x.ir !== 'ninguno'
                  ? <button type="button" onClick={() => onIr(x.ir as DestinoHoy)}><span>{x.icono}</span><span>{x.texto}</span><b>›</b></button>
                  : <div><span>{x.icono}</span><span>{x.texto}</span></div>}
              </li>
            ))}
          </ul>
        </>}
        {error && <p className="hoyIAError">{error}</p>}
        <button type="button" className="caLink hoyIAOtra" disabled={pensando} onClick={() => void pedir(true)}>{pensando ? 'Actualizando…' : '↻ Actualizar'}</button>
      </div>}
    </section>
  )
}
