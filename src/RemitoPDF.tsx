import logo from './assets/mova-logo.png'
import { fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'

type PresupuestoParaRemito = {
  id: number
  titulo: string
  fecha: string
  items: ItemPresupuesto[]
}

type Props = {
  presupuesto: PresupuestoParaRemito
  cliente: string
  obra: string
  onCerrar: () => void
}

export default function RemitoPDF({ presupuesto, cliente, obra, onCerrar }: Props) {
  const codigo = `R-${presupuesto.id.toString().padStart(4, '0')}`
  const productos = presupuesto.items.filter((i) => i.tipo === 'producto')
  const entregables = productos.length > 0 ? productos : presupuesto.items

  return (
    <div className="pdfPreview">
      <div className="pdfPreviewBar">
        <span>Remito de entrega {codigo}</span>
        <div>
          <button className="pdfBtnGhost" onClick={onCerrar}>Cerrar</button>
          <button className="pdfBtnPrimary" onClick={() => window.print()}>⬇ Descargar PDF</button>
        </div>
      </div>

      <div className="pdfDoc">
        <header className="pdfHead">
          <img src={logo} alt="MOVA" className="pdfLogo" />
          <div className="pdfHeadRight">
            <span className="pdfEyebrow">Remito de entrega</span>
            <strong>{codigo}</strong>
            <span className="pdfFecha">{fechaCorta(presupuesto.fecha)}</span>
          </div>
        </header>

        <section className="pdfCliente">
          <div>
            <span className="pdfLabel">Entregado a</span>
            <strong>{cliente}</strong>
            {obra && obra !== 'Sin obra asociada' && <span className="pdfObra">Obra: {obra}</span>}
          </div>
        </section>

        <section className="pdfIntro">
          <h1>Detalle de la entrega</h1>
          <p>Se detallan a continuación los equipos y materiales entregados e instalados correspondientes a: {presupuesto.titulo}.</p>
        </section>

        <table className="remitoTabla">
          <thead>
            <tr><th>#</th><th>Descripción</th><th className="c">Cantidad</th></tr>
          </thead>
          <tbody>
            {entregables.map((item, i) => (
              <tr key={item.id ?? i}>
                <td>{String(i + 1).padStart(2, '0')}</td>
                <td>{item.descripcion}</td>
                <td className="c">{item.cantidad} {item.cantidad === 1 ? 'unidad' : 'unidades'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="remitoUso">
          <h2>Formas de uso y puesta en marcha</h2>
          <ul>
            <li>Control desde el celular mediante la app correspondiente (Tuya / SmartLife o Ewelink / Sonoff, según los equipos instalados).</li>
            <li>Creación de escenas y automatizaciones (encendido por horario, sensores de presencia, riego programado).</li>
            <li>Control por voz disponible con asistentes compatibles (Alexa / Google / Siri) una vez vinculada la cuenta.</li>
            <li>Ante cortes de energía o internet, los equipos se reconectan automáticamente al restablecerse el servicio.</li>
            <li>Se recomienda mantener la red WiFi con buena señal en las zonas con dispositivos smart.</li>
          </ul>
        </section>

        <section className="remitoConformidad">
          <div>
            <span className="pdfLabel">Recibí conforme</span>
            <div className="remitoLinea">Firma</div>
          </div>
          <div>
            <span className="pdfLabel">Aclaración</span>
            <div className="remitoLinea">Nombre y DNI</div>
          </div>
          <div>
            <span className="pdfLabel">Fecha de recepción</span>
            <div className="remitoLinea">&nbsp;</div>
          </div>
        </section>

        <section className="pdfCondiciones" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <span className="pdfLabel">Garantía</span>
            <p>Los equipos cuentan con garantía del fabricante. La instalación y configuración tienen garantía de MOVA por defectos de puesta en marcha.</p>
          </div>
          <div>
            <span className="pdfLabel">Soporte</span>
            <p>Ante cualquier consulta o incidencia, contactanos por WhatsApp o Instagram y coordinamos el soporte.</p>
          </div>
        </section>

        <footer className="pdfFooter">
          <img src={logo} alt="MOVA" className="pdfFooterLogo" />
          <div className="pdfContacto">
            <span>🌐 www.movaelectronica.com.ar</span>
            <span>📷 Instagram: @mova.smart</span>
            <span>📱 +54 9 261 555 7970</span>
          </div>
          <span className="pdfFooterTag">MOVA Tecnología Smart · Espacios inteligentes</span>
        </footer>
      </div>
    </div>
  )
}
