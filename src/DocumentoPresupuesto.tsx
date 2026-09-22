import type { CSSProperties } from 'react'
import logo from './assets/mova-logo.jpg'
import { moneda, fechaCorta } from './gestionFormat'
import { CONDICIONES_GENERALES } from './condicionesGenerales'
import { COLOR_MARCA_HEX, type DatosPdf } from './pdfPresupuesto'
import type { ItemPresupuesto } from './NuevoPresupuesto'
import {
  agruparItems,
  descuentoItem,
  descuentoItems,
  formatoPct,
  importeBruto,
  importeNeto,
  partirDescripcion,
  pctItem,
} from './presupuestoCalculos'

// Documento del presupuesto (modelo moderno). Se usa en la ficha y en la
// vista previa, con el mismo orden y los mismos textos que el PDF.

type Props = {
  datos: DatosPdf
  // Sin borde ni márgenes propios (cuando ya está dentro de una hoja).
  embebido?: boolean
}

const SERIF = 'Georgia, "Times New Roman", Times, serif'

const estilos: Record<string, CSSProperties> = {
  documento: {
    background: '#fff',
    color: '#101318',
    border: '1px solid #e2e5e9',
    borderRadius: '12px',
    padding: 'clamp(18px, 4vw, 44px)',
    marginTop: '24px',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '15px',
    lineHeight: 1.5,
    minWidth: 0,
  },
  documentoEmbebido: {
    background: '#fff',
    color: '#101318',
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: '15px',
    lineHeight: 1.5,
    minWidth: 0,
  },
  encabezado: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: '16px',
    borderBottom: '1px solid #e2e5e9',
    paddingBottom: '22px',
    marginBottom: '28px',
  },
  seccion: {
    color: COLOR_MARCA_HEX,
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '2.6px',
    textTransform: 'uppercase',
    margin: '0 0 14px',
  },
  fila: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: '12px',
    flexWrap: 'wrap',
  },
  importe: {
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  etiquetaGris: {
    color: '#78828f',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '2.2px',
    textTransform: 'uppercase',
    margin: '0 0 16px',
  },
}

// Con descuento se muestra también el precio de lista del ítem.
function textoUnidades(item: ItemPresupuesto) {
  return (
    `${item.cantidad} ${
      item.cantidad === 1 ? 'unidad' : 'unidades'
    } × ${moneda(item.precio_unitario)}` +
    (pctItem(item) > 0
      ? ` = ${moneda(importeBruto(item))} (precio de lista)`
      : '')
  )
}

function LineaDescuento({ item }: { item: ItemPresupuesto }) {
  if (pctItem(item) <= 0) return null

  return (
    <div
      style={{
        color: COLOR_MARCA_HEX,
        fontSize: '13px',
        fontWeight: 700,
        marginTop: '3px',
      }}
    >
      Descuento {formatoPct(pctItem(item))}% · − {moneda(descuentoItem(item))}
    </div>
  )
}

export default function DocumentoPresupuesto({
  datos,
  embebido = false,
}: Props) {
  const codigo = String(datos.id).padStart(4, '0')
  const grupos = agruparItems(datos.items)
  const notas = (datos.notas ?? '').trim()

  // Los subtotales van a precio de lista; si hay descuentos por ítem
  // se aclara para que cierre con los importes de cada línea.
  const sufijoLista =
    descuentoItems(datos.items) > 0 ? ' (precio de lista)' : ''

  return (
    <div
      style={embebido ? estilos.documentoEmbebido : estilos.documento}
    >
      <div style={estilos.encabezado}>
        <img
          src={logo}
          alt="MOVA Tecnología Smart"
          style={{
            width: '170px',
            maxWidth: '100%',
            height: 'auto',
            objectFit: 'contain',
          }}
        />

        <div
          style={{
            textAlign: 'right',
            marginLeft: 'auto',
            color: '#78828f',
            fontSize: '13px',
            lineHeight: 1.6,
          }}
        >
          <div>
            Presupuesto N°{' '}
            <strong style={{ color: '#101318', fontSize: '15px' }}>
              {codigo}
            </strong>
          </div>
          <div>
            {datos.cliente} · {fechaCorta(datos.fecha)}
          </div>
          {datos.validez_dias != null && datos.validez_dias > 0 && (
            <div>
              Validez: {datos.validez_dias}{' '}
              {datos.validez_dias === 1 ? 'día' : 'días'}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: '34px' }}>
        <h3
          style={{
            fontFamily: SERIF,
            fontWeight: 400,
            fontSize: '30px',
            lineHeight: 1.2,
            margin: '0 0 12px',
            overflowWrap: 'anywhere',
          }}
        >
          {datos.titulo}
        </h3>

        {datos.descripcion && (
          <p
            style={{
              color: '#475569',
              whiteSpace: 'pre-line',
              overflowWrap: 'anywhere',
              margin: 0,
            }}
          >
            {datos.descripcion}
          </p>
        )}

        {datos.obra && datos.obra !== 'Sin obra asociada' && (
          <p
            style={{
              color: '#78828f',
              fontSize: '13px',
              margin: '8px 0 0',
            }}
          >
            Obra: {datos.obra}
          </p>
        )}
      </div>

      {grupos.length === 0 && (
        <p style={{ color: '#78828f' }}>Sin ítems.</p>
      )}

      {grupos.map((grupo) => (
        <section key={grupo.clave} style={{ marginBottom: '34px' }}>
          <h4 style={estilos.seccion}>{grupo.titulo}</h4>

          {grupo.items.map((item, i) => {
            const { titulo, detalle } = partirDescripcion(
              item.descripcion
            )

            // Dispositivos: número grande, nombre destacado y descripción.
            if (grupo.clave === 'dispositivos') {
              return (
                <div
                  key={item.id ?? i}
                  style={{
                    display: 'flex',
                    gap: '16px',
                    padding: '18px 0',
                    borderBottom: '1px solid #edf0f3',
                    breakInside: 'avoid',
                  }}
                >
                  <span
                    style={{
                      fontSize: '22px',
                      lineHeight: 1.1,
                      color: '#cdd0d5',
                      width: '34px',
                      flexShrink: 0,
                    }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={estilos.fila}>
                      <strong
                        style={{
                          flex: '1 1 220px',
                          fontSize: '16px',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {titulo}
                      </strong>

                      <strong style={estilos.importe}>
                        {moneda(importeNeto(item))}
                      </strong>
                    </div>

                    {detalle && (
                      <p
                        style={{
                          color: '#64748b',
                          fontSize: '14px',
                          margin: '5px 0 0',
                          whiteSpace: 'pre-line',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {detalle}
                      </p>
                    )}

                    <div
                      style={{
                        color: '#78828f',
                        fontSize: '13px',
                        marginTop: '6px',
                      }}
                    >
                      {textoUnidades(item)}
                    </div>

                    <LineaDescuento item={item} />
                  </div>
                </div>
              )
            }

            // Mano de obra y otros: filas compactas con línea punteada.
            const mostrarUnidades =
              Number(item.cantidad) !== 1 || pctItem(item) > 0

            return (
              <div
                key={item.id ?? i}
                style={{
                  padding: '12px 0',
                  borderBottom: '1px dotted #b8bdc6',
                  breakInside: 'avoid',
                }}
              >
                <div style={estilos.fila}>
                  <span
                    style={{
                      flex: '1 1 220px',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {titulo}
                  </span>

                  <strong style={estilos.importe}>
                    {moneda(importeNeto(item))}
                  </strong>
                </div>

                {detalle && (
                  <div
                    style={{
                      color: '#78828f',
                      fontSize: '13px',
                      marginTop: '2px',
                      whiteSpace: 'pre-line',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {detalle}
                  </div>
                )}

                {mostrarUnidades && (
                  <div
                    style={{
                      color: '#78828f',
                      fontSize: '13px',
                      marginTop: '2px',
                    }}
                  >
                    {textoUnidades(item)}
                  </div>
                )}

                <LineaDescuento item={item} />
              </div>
            )
          })}
        </section>
      ))}

      <section style={{ marginTop: '8px' }}>
        {grupos.map((grupo) => (
          <div
            key={grupo.clave}
            style={{
              ...estilos.fila,
              color: '#78828f',
              marginBottom: '10px',
            }}
          >
            <span>
              Subtotal {grupo.titulo.toLowerCase()}
              {sufijoLista}
            </span>
            <span style={estilos.importe}>
              {moneda(grupo.subtotal)}
            </span>
          </div>
        ))}

        {datos.descuento > 0 && (
          <div
            style={{
              ...estilos.fila,
              color: COLOR_MARCA_HEX,
              marginBottom: '10px',
            }}
          >
            <span>Bonificación aplicada</span>
            <strong style={estilos.importe}>
              − {moneda(datos.descuento)}
            </strong>
          </div>
        )}

        <div
          style={{
            ...estilos.fila,
            borderTop: '2px solid #101318',
            marginTop: '18px',
            paddingTop: '16px',
            alignItems: 'baseline',
          }}
        >
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '1.5px',
            }}
          >
            TOTAL FINAL
          </span>
          <span
            style={{
              ...estilos.importe,
              fontSize: '22px',
              fontWeight: 700,
            }}
          >
            {moneda(datos.total)}
          </span>
        </div>
      </section>

      {notas && (
        <section
          style={{
            marginTop: '34px',
            paddingTop: '22px',
            borderTop: '1px solid #e2e5e9',
          }}
        >
          <h4 style={estilos.etiquetaGris}>Notas</h4>

          <p
            style={{
              margin: 0,
              whiteSpace: 'pre-line',
              overflowWrap: 'anywhere',
              color: '#475569',
              fontSize: '14px',
            }}
          >
            {notas}
          </p>
        </section>
      )}

      <section
        style={{
          marginTop: '34px',
          paddingTop: '22px',
          borderTop: '1px solid #e2e5e9',
          fontSize: '14px',
          lineHeight: 1.6,
        }}
      >
        <h4 style={estilos.etiquetaGris}>Condiciones generales</h4>

        {CONDICIONES_GENERALES.map((condicion) => (
          <div
            key={condicion.titulo}
            style={{ marginBottom: '18px', breakInside: 'avoid' }}
          >
            <strong style={{ color: '#101318' }}>
              {condicion.titulo}
            </strong>

            <p
              style={{
                margin: '5px 0 0',
                color: '#475569',
                overflowWrap: 'anywhere',
              }}
            >
              {condicion.texto}
            </p>
          </div>
        ))}
      </section>

      <footer
        style={{
          borderTop: '1px solid #e2e5e9',
          paddingTop: '18px',
          marginTop: '30px',
          fontSize: '12px',
          color: '#78828f',
          textAlign: 'center',
          overflowWrap: 'anywhere',
        }}
      >
        MOVA TECNOLOGÍA SMART · www.movaelectronica.com.ar ·
        @mova.smart · +54 9 261 555 7970
      </footer>
    </div>
  )
}
