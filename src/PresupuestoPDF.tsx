import logo from './assets/mova-logo.png'
import { moneda, fechaCorta } from './gestionFormat'
import type { ItemPresupuesto } from './NuevoPresupuesto'

type PresupuestoParaPDF = {
  id: number
  titulo: string
  descripcion?: string | null
  fecha: string
  validez_dias?: number | null
  subtotal: number
  descuento: number
  total: number
  notas?: string | null
  items: ItemPresupuesto[]
}

type Props = {
  presupuesto: PresupuestoParaPDF
  cliente: string
  obra: string
  onCerrar: () => void
}

// Etiquetas legibles para agrupar los ítems como en la cotización modelo.
const GRUPOS: Record<string, string> = {
  producto: 'Productos y equipos',
  servicio: 'Servicios',
  material: 'Materiales',
  mano_obra: 'Mano de obra e instalación',
  otro: 'Otros',
}

export default function PresupuestoPDF({ presupuesto, cliente, obra, onCerrar }: Props) {
  const codigo = `#${presupuesto.id.toString().padStart(4, '0')}`

  // Agrupa los ítems por tipo, respetando el orden de aparición de los grupos.
  const grupos: { clave: string; titulo: string; items: ItemPresupuesto[]; subtotal: number }[] = []
  for (const item of presupuesto.items) {
    const clave = item.tipo || 'otro'
    let grupo = grupos.find((g) => g.clave === clave)
    if (!grupo) {
      grupo = { clave, titulo: GRUPOS[clave] ?? clave, items: [], subtotal: 0 }
      grupos.push(grupo)
    }
    grupo.items.push(item)
    grupo.subtotal += item.cantidad * item.precio_unitario
  }

  return (
    <div className="pdfPreview">
      <div className="pdfPreviewBar">
        <span>Vista previa del presupuesto {codigo}</span>
        <div>
          <button className="pdfBtnGhost" onClick={onCerrar}>Cerrar</button>
          <button className="pdfBtnPrimary" onClick={() => window.print()}>⬇ Descargar PDF</button>
        </div>
      </div>

      <div className="pdfDoc">
        <header className="pdfHead">
          <img src={logo} alt="MOVA" className="pdfLogo" />
          <div className="pdfHeadRight">
            <span className="pdfEyebrow">Cotización</span>
            <strong>{codigo}</strong>
            <span className="pdfFecha">{fechaCorta(presupuesto.fecha)}</span>
          </div>
        </header>

        <section className="pdfCliente">
          <div>
            <span className="pdfLabel">Preparado para</span>
            <strong>{cliente}</strong>
            {obra && obra !== 'Sin obra asociada' && <span className="pdfObra">Obra: {obra}</span>}
          </div>
        </section>

        <section className="pdfIntro">
          <h1>{presupuesto.titulo}</h1>
          {presupuesto.descripcion && <p>{presupuesto.descripcion}</p>}
        </section>

        {grupos.map((grupo) => (
          <section className="pdfGrupo" key={grupo.clave}>
            <h2>{grupo.titulo}</h2>
            <div className="pdfItems">
              {grupo.items.map((item, i) => (
                <div className="pdfItem" key={item.id ?? i}>
                  <span className="pdfItemNum">{String(i + 1).padStart(2, '0')}</span>
                  <div className="pdfItemBody">
                    <div className="pdfItemTop">
                      <strong>{item.descripcion}</strong>
                      <b>{moneda(item.cantidad * item.precio_unitario)}</b>
                    </div>
                    <span className="pdfItemDet">
                      {item.cantidad} {item.cantidad === 1 ? 'unidad' : 'unidades'} × {moneda(item.precio_unitario)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pdfGrupoSub"><span>Subtotal {grupo.titulo.toLowerCase()}</span><b>{moneda(grupo.subtotal)}</b></div>
          </section>
        ))}

        <section className="pdfTotales">
          <div className="pdfTotalRow"><span>Subtotal</span><b>{moneda(presupuesto.subtotal)}</b></div>
          {presupuesto.descuento > 0 && (
            <div className="pdfTotalRow pdfDescuento">
              <span>Bonificación{presupuesto.subtotal > 0 ? ` (${Math.round((presupuesto.descuento / presupuesto.subtotal) * 100)}%)` : ''}</span>
              <b>− {moneda(presupuesto.descuento)}</b>
            </div>
          )}
          <div className="pdfTotalFinal"><span>Total final</span><b>{moneda(presupuesto.total)}</b></div>
        </section>

        <section className="pdfCondiciones">
          <div>
            <span className="pdfLabel">Forma de pago</span>
            <p>{presupuesto.notas?.trim() || '70% de seña para confirmar fecha y materiales. 30% restante al finalizar los trabajos.'}</p>
          </div>
          <div>
            <span className="pdfLabel">Vigencia</span>
            <p>Este presupuesto tiene una validez de {presupuesto.validez_dias ?? 10} días corridos desde su emisión.</p>
          </div>
          <div>
            <span className="pdfLabel">Alcance</span>
            <p>Contempla únicamente los trabajos y materiales aquí detallados. Ampliaciones se cotizan por separado.</p>
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
