import { useEffect, useState } from 'react'
import logo from './assets/mova-logo.png'
import { supabase } from './supabase'
import { fechaCorta, hoy } from './gestionFormat'

export type ObraInforme = {
  id: number
  nombre_obra: string
  direccion: string | null
  localidad: string | null
  estado: string | null
  porcentaje_avance: number | null
  fecha_inicio: string | null
  fecha_fin_estimada: string | null
  descripcion: string | null
}

type Props = {
  obra: ObraInforme
  cliente: string
  onCerrar: () => void
}

export default function InformeObra({ obra, cliente, onCerrar }: Props) {
  const [avances, setAvances] = useState<any[]>([])
  const [materiales, setMateriales] = useState<any[]>([])

  useEffect(() => {
    async function cargar() {
      const [av, mat] = await Promise.all([
        supabase.from('obra_avances').select('*').eq('obra_id', obra.id).order('fecha', { ascending: true }),
        supabase.from('materiales').select('*').eq('obra_id', obra.id),
      ])
      if (!av.error) setAvances(av.data ?? [])
      if (!mat.error) setMateriales(mat.data ?? [])
    }
    cargar()
  }, [obra.id])

  const codigo = `INF-${obra.id.toString().padStart(4, '0')}`

  return (
    <div className="pdfPreview">
      <div className="pdfPreviewBar">
        <span>Informe de fin de obra {codigo}</span>
        <div>
          <button className="pdfBtnGhost" onClick={onCerrar}>Cerrar</button>
          <button className="pdfBtnPrimary" onClick={() => window.print()}>⬇ Descargar PDF</button>
        </div>
      </div>

      <div className="pdfDoc">
        <header className="pdfHead">
          <img src={logo} alt="MOVA" className="pdfLogo" />
          <div className="pdfHeadRight">
            <span className="pdfEyebrow">Informe de fin de obra</span>
            <strong>{codigo}</strong>
            <span className="pdfFecha">{fechaCorta(hoy())}</span>
          </div>
        </header>

        <section className="pdfCliente">
          <div>
            <span className="pdfLabel">Cliente</span>
            <strong>{cliente}</strong>
            <span className="pdfObra">{obra.nombre_obra}{obra.direccion ? ` · ${obra.direccion}` : ''}{obra.localidad ? `, ${obra.localidad}` : ''}</span>
          </div>
        </section>

        <section className="pdfIntro">
          <h1>Resumen del trabajo realizado</h1>
          <p>{obra.descripcion || 'Informe de los trabajos de domótica e instalación ejecutados en la obra.'}</p>
        </section>

        <div className="pdfTotales" style={{ marginTop: 0 }}>
          <div className="pdfTotalRow"><span>Estado</span><b>{obra.estado || '—'}</b></div>
          <div className="pdfTotalRow"><span>Avance</span><b>{Number(obra.porcentaje_avance || 0)}%</b></div>
          <div className="pdfTotalRow"><span>Período</span><b>{fechaCorta(obra.fecha_inicio)} — {fechaCorta(obra.fecha_fin_estimada)}</b></div>
        </div>

        <section className="remitoUso" style={{ marginTop: 22 }}>
          <h2>Trabajos realizados</h2>
          {avances.length > 0 ? (
            <div className="pdfItems">
              {avances.map((a, i) => (
                <div className="pdfItem" key={a.id ?? i}>
                  <span className="pdfItemNum">{String(i + 1).padStart(2, '0')}</span>
                  <div className="pdfItemBody">
                    <div className="pdfItemTop">
                      <strong>{a.titulo || a.descripcion || 'Avance'}</strong>
                      {a.fecha && <b style={{ fontWeight: 500, color: '#6b727c' }}>{fechaCorta(a.fecha)}</b>}
                    </div>
                    {a.titulo && a.descripcion && <span className="pdfItemDet">{a.descripcion}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#6b727c', fontSize: 12.5 }}>Se ejecutaron los trabajos detallados en el presupuesto aprobado de la obra.</p>
          )}
        </section>

        {materiales.length > 0 && (
          <section className="remitoUso" style={{ marginTop: 22 }}>
            <h2>Equipos y materiales instalados</h2>
            <table className="remitoTabla">
              <thead><tr><th>Descripción</th><th className="c">Cantidad</th></tr></thead>
              <tbody>
                {materiales.map((m, i) => (
                  <tr key={m.id ?? i}>
                    <td>{m.nombre ?? m.descripcion ?? 'Material'}</td>
                    <td className="c">{m.cantidad ?? 1}{m.unidad ? ` ${m.unidad}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="remitoUso" style={{ marginTop: 22 }}>
          <h2>Formas de uso y recomendaciones</h2>
          <ul>
            <li>Control desde el celular con la app correspondiente (Tuya / SmartLife o Ewelink / Sonoff según los equipos).</li>
            <li>Creación de escenas y automatizaciones (horarios, sensores, riego programado).</li>
            <li>Control por voz con asistentes compatibles (Alexa / Google / Siri) al vincular la cuenta.</li>
            <li>Ante cortes de energía o internet, los equipos se reconectan solos al volver el servicio.</li>
            <li>Mantené buena señal de WiFi en las zonas con dispositivos smart.</li>
          </ul>
        </section>

        <section className="pdfCondiciones" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <span className="pdfLabel">Garantía</span>
            <p>Equipos con garantía del fabricante. La instalación y puesta en marcha tienen garantía de MOVA.</p>
          </div>
          <div>
            <span className="pdfLabel">Soporte post-obra</span>
            <p>Quedamos a disposición para consultas, ajustes y ampliaciones. Contactanos por WhatsApp o Instagram.</p>
          </div>
        </section>

        <footer className="pdfFooter">
          <img src={logo} alt="MOVA" className="pdfFooterLogo" />
          <div className="pdfContacto">
            <span>www.movaelectronica.com.ar</span>
            <span>Instagram @mova.smart</span>
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><line x1="10.5" y1="18.5" x2="13.5" y2="18.5" /></svg>+54 9 261 555 7970</span>
          </div>
          <span className="pdfFooterTag">MOVA Tecnología Smart · Espacios inteligentes</span>
        </footer>
      </div>
    </div>
  )
}
