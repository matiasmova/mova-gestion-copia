import { useEffect, useState } from 'react'

const OPCIONES = [
  ['telegram', '⚡', 'Captura de facturas por Telegram + N8N', 'Foto al bot, almacenamiento y registro automático', 'Próxima fase'],
  ['geocoding', '📍', 'Georreferenciación de direcciones', 'Ubicación automática de clientes y obras', 'Próxima fase'],
  ['plazos', '🔔', 'Alertas de plazos', 'Avisos cuando una obra está por vencer', 'Disponible'],
  ['ocr', '🔎', 'OCR de comprobantes', 'Lectura automática de importes y proveedores', 'A validar'],
  ['pdf', '📄', 'PDF de presupuestos', 'Generación y envío del presupuesto aprobado', 'Próxima fase'],
  ['backup', '☁️', 'Backups automáticos', 'Copia periódica y recuperable de la información', 'Recomendado'],
] as const

export default function Configuracion() {
  const [activas, setActivas] = useState<Record<string, boolean>>({ plazos: true, backup: true })
  useEffect(() => { try { const dato = localStorage.getItem('mova_config_fase2'); if (dato) setActivas(JSON.parse(dato)) } catch { /* sin acción */ } }, [])
  function alternar(clave: string) { const siguiente = { ...activas, [clave]: !activas[clave] }; setActivas(siguiente); localStorage.setItem('mova_config_fase2', JSON.stringify(siguiente)) }
  return <div className="gestionPage"><div className="pageHeader"><div><p className="subtitle">CONFIGURACIÓN</p><h2>Configuración</h2><p className="welcome">Automatizaciones y próximos pasos del sistema</p></div></div><div className="configGrid">{OPCIONES.map(([clave, icono, titulo, texto, estado]) => <article key={clave}><div className="configIcono">{icono}</div><span className="configEstado">{estado}</span><h3>{titulo}</h3><p>{texto}</p><button className={`configSwitch ${activas[clave] ? 'on' : ''}`} onClick={() => alternar(clave)} aria-label={`Activar ${titulo}`}><i /></button></article>)}</div><p className="gestionAyuda">Estos interruptores guardan preferencias. Las integraciones externas señaladas como “Próxima fase” todavía requieren configuración técnica.</p></div>
}
