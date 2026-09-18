import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const OPCIONES = [
  ['telegram', '⚡', 'Captura de facturas por Telegram + N8N', 'Foto al bot, almacenamiento y registro automático', 'Próxima fase'],
  ['geocoding', '📍', 'Georreferenciación de direcciones', 'Ubicación automática de clientes y obras', 'Próxima fase'],
  ['plazos', '🔔', 'Alertas de plazos', 'Avisos cuando una obra está por vencer', 'Disponible'],
  ['ocr', '🔎', 'OCR de comprobantes', 'Lectura automática de importes y proveedores', 'A validar'],
  ['pdf', '📄', 'PDF de presupuestos', 'Generación y envío del presupuesto aprobado', 'Próxima fase'],
  ['backup', '☁️', 'Backups automáticos', 'Copia periódica y recuperable de la información', 'Recomendado'],
] as const

type Log = { id: number; tabla: string | null; accion: string | null; registro_id: string | null; usuario: string | null; fecha: string }
const ACCION: Record<string, string> = { INSERT: 'Alta', UPDATE: 'Edición', DELETE: 'Baja' }
const fmt = (f: string) => new Date(f).toLocaleString('es-AR')

export default function Configuracion() {
  const [activas, setActivas] = useState<Record<string, boolean>>({ plazos: true, backup: true })
  const [logs, setLogs] = useState<Log[]>([])
  const [cargandoLog, setCargandoLog] = useState(true)

  useEffect(() => { try { const dato = localStorage.getItem('mova_config_fase2'); if (dato) setActivas(JSON.parse(dato)) } catch { /* sin acción */ } }, [])
  useEffect(() => {
    supabase.from('log_auditoria').select('*').order('fecha', { ascending: false }).limit(80).then(({ data }) => {
      setLogs((data ?? []) as Log[]); setCargandoLog(false)
    })
  }, [])

  function alternar(clave: string) { const siguiente = { ...activas, [clave]: !activas[clave] }; setActivas(siguiente); localStorage.setItem('mova_config_fase2', JSON.stringify(siguiente)) }

  return <div className="gestionPage">
    <div className="pageHeader"><div><p className="subtitle">CONFIGURACIÓN</p><h2>Configuración</h2><p className="welcome">Automatizaciones y auditoría del sistema</p></div></div>
    <div className="configGrid">{OPCIONES.map(([clave, icono, titulo, texto, estado]) => <article key={clave}><div className="configIcono">{icono}</div><span className="configEstado">{estado}</span><h3>{titulo}</h3><p>{texto}</p><button className={`configSwitch ${activas[clave] ? 'on' : ''}`} onClick={() => alternar(clave)} aria-label={`Activar ${titulo}`}><i /></button></article>)}</div>

    <section style={{ marginTop: 28 }}>
      <div className="pageHeader"><div><h3>Auditoría (últimos movimientos)</h3><p className="welcome">Quién creó, editó o eliminó registros, y cuándo</p></div></div>
      {cargandoLog ? <p>Cargando registro...</p> : logs.length === 0 ? <p className="gestionAyuda">Todavía no hay movimientos registrados. A partir de ahora cada alta/edición/baja queda registrada.</p> : (
        <div className="crmListaWrap"><table className="crmLista">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Registro</th></tr></thead>
          <tbody>{logs.map((l) => (
            <tr key={l.id}>
              <td>{fmt(l.fecha)}</td>
              <td>{l.usuario || 'sistema'}</td>
              <td><span className={`crmBadge ${l.accion === 'DELETE' ? 'est-rechazado' : l.accion === 'INSERT' ? 'est-aceptado' : 'est-enviado'}`}>{ACCION[l.accion ?? ''] ?? l.accion}</span></td>
              <td>{l.tabla}</td>
              <td>#{l.registro_id}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
    <p className="gestionAyuda">Las integraciones marcadas como “Próxima fase” requieren configuración técnica. El registro de auditoría es automático y sirve para control interno.</p>
  </div>
}
