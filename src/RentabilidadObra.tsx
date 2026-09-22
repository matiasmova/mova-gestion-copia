import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { moneda, fechaCorta } from './gestionFormat'
import {
  calcularPersona,
  type AsignacionCalc,
  type JornalCalc,
  type PersonaCalc,
} from './personalCalculos'
import { importeNeto, redondear } from './presupuestoCalculos'
import { situacionCobro } from './finanzasObra'

type Presupuesto = { id: number; total: number; estado: string; activo: boolean }
type Adicional = { importe: number; estado: string; tipo: string }
type Costo = { id: number; tipo: string; monto: number; personal_id: number | null; fecha: string; descripcion: string | null }
type Pago = { id: number; monto: number; fecha: string; medio_pago: string | null; referencia: string | null }
type Compra = {
  id: number; nombre: string; cantidad: number; unidad: string; precio_unitario: number
  proveedor: string | null; fecha: string; numero_comprobante: string | null; comprobante_path: string | null
}
type ItemPresu = {
  presupuesto_id: number
  catalogo_id: number | null
  tipo: string
  cantidad: number
  precio_unitario: number
  costo_unitario: number
  descuento_pct: number
}

const ETIQUETAS_EGRESO: Record<string, string> = {
  material: 'Materiales / compras', mano_obra: 'Mano de obra', terciarizado: 'Tercerizados', otro: 'Otros gastos',
  gasto_extra: 'Gastos extra (adicionales)',
}
const TIPOS_COSTO: Record<string, string> = {
  material: 'Material', mano_obra: 'Mano de obra', terciarizado: 'Tercerizado', otro: 'Otro',
  gasto_extra: 'Gasto extra (adicional)',
}

function RentabilidadObra({ obraId, avance }: { obraId: number; avance: number }) {
  const [presupuestos, setPresupuestos] = useState<Presupuesto[]>([])
  const [adicionales, setAdicionales] = useState<Adicional[]>([])
  const [costos, setCostos] = useState<Costo[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [compras, setCompras] = useState<Compra[]>([])
  const [asignaciones, setAsignaciones] = useState<AsignacionCalc[]>([])
  const [personas, setPersonas] = useState<PersonaCalc[]>([])
  const [jornales, setJornales] = useState<JornalCalc[]>([])
  const [items, setItems] = useState<ItemPresu[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [comprobante, setComprobante] = useState<{ id: number; url: string } | null>(null)
  const [abriendo, setAbriendo] = useState<number | null>(null)
  const [errorComprobante, setErrorComprobante] = useState('')

  useEffect(() => {
    let vigente = true
    async function cargar() {
      setCargando(true)
      setError('')
      const rPres = await supabase.from('presupuestos').select('id,total,estado,activo').eq('obra_id', obraId)
      if (!vigente) return
      if (rPres.error) { console.error(rPres.error); setError('No se pudo calcular la rentabilidad.'); setCargando(false); return }
      const presu = (rPres.data ?? []).map((p: Presupuesto) => ({ ...p, total: Number(p.total) })) as Presupuesto[]
      const idsAceptados = presu.filter((p) => p.activo !== false && p.estado === 'aceptado').map((p) => p.id)

      // Cobros de la obra y de sus presupuestos (sin traer toda la tabla).
      const filtrosCobros = [`obra_id.eq.${obraId}`]
      if (presu.length > 0) filtrosCobros.push(`presupuesto_id.in.(${presu.map((p) => p.id).join(',')})`)

      const [rAdic, rCostos, rPagos, rCompras, rAsig, rItems, rPers, rJorn] = await Promise.all([
        supabase.from('adicionales').select('importe,estado,tipo').eq('obra_id', obraId),
        supabase.from('costos').select('id,tipo,monto,personal_id,fecha,descripcion').eq('obra_id', obraId),
        supabase.from('pagos').select('id,monto,fecha,medio_pago,referencia').or(filtrosCobros.join(',')),
        supabase.from('materiales').select('id,nombre,cantidad,unidad,precio_unitario,proveedor,fecha,numero_comprobante,comprobante_path').eq('obra_id', obraId),
        supabase.from('obra_asignaciones').select('personal_id,modalidad,valor_acordado').eq('obra_id', obraId),
        idsAceptados.length
          ? supabase.from('presupuesto_items').select('presupuesto_id,catalogo_id,tipo,cantidad,precio_unitario,costo_unitario,descuento_pct').in('presupuesto_id', idsAceptados)
          : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
        supabase.from('personal').select('id,costo_dia'),
        supabase.from('jornales').select('personal_id,jornada,horas').eq('obra_id', obraId),
      ])
      if (!vigente) return
      setPresupuestos(presu)
      // Si todavía no existe la columna de descuento por ítem, se lee sin ella.
      let filasItems = (rItems.error ? [] : (rItems.data ?? [])) as Array<Record<string, unknown>>
      if (rItems.error && idsAceptados.length) {
        const rItems2 = await supabase.from('presupuesto_items').select('presupuesto_id,catalogo_id,tipo,cantidad,precio_unitario,costo_unitario').in('presupuesto_id', idsAceptados)
        filasItems = (rItems2.error ? [] : (rItems2.data ?? [])) as Array<Record<string, unknown>>
      }
      if (!vigente) return

      // Costo actual del catálogo: se usa cuando el ítem quedó guardado sin costo.
      const idsCatalogo = Array.from(new Set(filasItems.map((it) => Number(it.catalogo_id)).filter((id) => id > 0)))
      const costoCatalogo: Record<number, number> = {}
      if (idsCatalogo.length) {
        const rCat = await supabase.from('productos_servicios').select('id,costo_unitario').in('id', idsCatalogo)
        for (const c of (rCat.error ? [] : (rCat.data ?? [])) as Array<{ id: number; costo_unitario: number | string | null }>) {
          costoCatalogo[c.id] = Number(c.costo_unitario) || 0
        }
      }
      if (!vigente) return

      setItems(filasItems.map((it) => ({
        presupuesto_id: Number(it.presupuesto_id),
        catalogo_id: it.catalogo_id == null ? null : Number(it.catalogo_id),
        tipo: String(it.tipo ?? '').trim().toLowerCase(),
        cantidad: Number(it.cantidad) || 0,
        precio_unitario: Number(it.precio_unitario) || 0,
        costo_unitario: Number(it.costo_unitario) || costoCatalogo[Number(it.catalogo_id)] || 0,
        descuento_pct: Number(it.descuento_pct) || 0,
      })))
      setAdicionales(rAdic.error ? [] : (rAdic.data ?? []).map((a: { importe: number | string; estado: string; tipo: string }) => ({ ...a, importe: Number(a.importe) })) as Adicional[])
      setCostos(rCostos.error ? [] : (rCostos.data ?? []).map((c: { id: number; tipo: string; monto: number | string; personal_id: number | null; fecha: string; descripcion: string | null }) => ({ ...c, monto: Number(c.monto) })) as Costo[])
      setAsignaciones(rAsig.error ? [] : (rAsig.data ?? []).map((a: AsignacionCalc) => ({ ...a, valor_acordado: a.valor_acordado == null ? null : Number(a.valor_acordado) })) as AsignacionCalc[])
      setPersonas(rPers.error ? [] : (rPers.data ?? []).map((p: { id: number; costo_dia: number | string | null }) => ({ id: p.id, costo_dia: p.costo_dia == null ? null : Number(p.costo_dia) })) as PersonaCalc[])
      setJornales(rJorn.error ? [] : (rJorn.data ?? []).map((j: { personal_id: number | null; jornada: number | string; horas: number | string | null }) => ({ personal_id: j.personal_id, jornada: Number(j.jornada), horas: j.horas == null ? null : Number(j.horas) })) as JornalCalc[])
      setPagos(rPagos.error ? [] : (rPagos.data ?? []).map((p: { id: number; monto: number | string; fecha: string; medio_pago: string | null; referencia: string | null }) => ({ ...p, monto: Number(p.monto) })) as Pago[])
      setCompras(rCompras.error ? [] : (rCompras.data ?? []).map((c: Compra) => ({ ...c, cantidad: Number(c.cantidad), precio_unitario: Number(c.precio_unitario) })) as Compra[])
      setCargando(false)
    }
    void cargar()
    return () => { vigente = false }
  }, [obraId, revision])

  async function prepararComprobante(compra: Compra) {
    if (!compra.comprobante_path || abriendo !== null) return
    setAbriendo(compra.id)
    setComprobante(null)
    setErrorComprobante('')
    try {
      const resultado = await supabase.storage.from('comprobantes').createSignedUrl(compra.comprobante_path, 300)
      if (resultado.error || !resultado.data?.signedUrl) {
        throw resultado.error ?? new Error('No se recibió un enlace al comprobante')
      }
      setComprobante({ id: compra.id, url: resultado.data.signedUrl })
    } catch (fallo) {
      console.error(fallo)
      setErrorComprobante('No se pudo abrir el comprobante. Volvé a intentar.')
    } finally {
      setAbriendo(null)
    }
  }

  const datos = useMemo(() => {
    const aceptados = presupuestos.filter((p) => p.activo !== false && p.estado === 'aceptado')
    const contratado = aceptados.reduce((s, p) => s + p.total, 0)
    // Un Gasto extra "Pagado" (el cliente ya lo devolvió) queda cancelado: no
    // cuenta ni como valor ni como gasto en ningún lado, como si no hubiera
    // pasado. Mientras está "Aprobado" (todavía sin devolver), sí suma a lo
    // que se le cobra al cliente y sigue apareciendo como gasto más abajo.
    const aprobados = adicionales.filter((a) => a.estado === 'aprobado')
    // Los Gasto extra son plata que Mova adelanta y el cliente le devuelve:
    // nunca son ganancia ni pérdida para Mova, se excluyen de la ganancia bruta.
    const extraGanancia = aprobados.filter((a) => a.tipo !== 'gasto_extra').reduce((s, a) => s + a.importe, 0)
    const extraGastoExtra = aprobados.filter((a) => a.tipo === 'gasto_extra').reduce((s, a) => s + a.importe, 0)
    const extra = extraGanancia + extraGastoExtra
    // El Gasto extra no es valor de la obra (es plata que se devuelve), así que
    // no entra acá: esto es lo que se usa como base para el % del personal que
    // cobra por porcentaje, y para el margen proyectado. Si entrara, un Gasto
    // extra grande inflaría lo que le corresponde cobrar a esa persona.
    const valorActualizado = contratado + extraGanancia
    const cobrado = pagos.reduce((s, p) => s + p.monto, 0)

    // Personal asignado: lo que corresponde pagarle en total (pagado + lo que
    // falta), sin importar si ya salió o no. Se calcula antes que la ganancia
    // porque es un costo directo de la mano de obra vendida (ver más abajo).
    const pagosPersonal = costos
      .filter((c) => c.personal_id != null)
      .map((c) => ({ personal_id: c.personal_id, monto: c.monto }))
    const filasPersonal = asignaciones.map((a) =>
      calcularPersona(a, personas.find((p) => p.id === a.personal_id), pagosPersonal, jornales, valorActualizado, 0),
    )
    const personalComprometido = filasPersonal.reduce((s, f) => s + f.proyectado, 0)
    const personalPagado = filasPersonal.reduce((s, f) => s + f.pagado, 0)
    const personalPendiente = filasPersonal.reduce((s, f) => s + f.porPagarProyectado, 0)

    // Ganancia del presupuesto:
    //  · Productos: venta (con su descuento) − costo. La ganancia es el margen.
    //  · Servicios (mano de obra e instalación): venta − costo del personal
    //    asignado a la obra (lo que le pagás a quien hace el trabajo). Si no
    //    hay nadie asignado, todo el importe es ganancia.
    //  · La bonificación general del presupuesto reduce la ganancia.
    let ventaProductos = 0
    let costoProductos = 0
    let ventaServicios = 0
    let bonificacionGeneral = 0
    let sinDetalle = 0
    for (const presu of aceptados) {
      const suyos = items.filter((it) => it.presupuesto_id === presu.id)
      if (suyos.length === 0) { sinDetalle += presu.total; continue }
      let netoItems = 0
      for (const it of suyos) {
        const neto = importeNeto(it)
        netoItems += neto
        if (it.tipo === 'producto' || it.tipo === 'material') {
          ventaProductos += neto
          costoProductos += it.cantidad * it.costo_unitario
        } else {
          ventaServicios += neto
        }
      }
      bonificacionGeneral += Math.max(netoItems - presu.total, 0)
    }
    ventaProductos = redondear(ventaProductos)
    costoProductos = redondear(costoProductos)
    ventaServicios = redondear(ventaServicios)
    bonificacionGeneral = redondear(bonificacionGeneral)
    sinDetalle = redondear(sinDetalle)
    const gananciaProductos = redondear(ventaProductos - costoProductos)
    const margenProductos = ventaProductos > 0 ? Math.round((gananciaProductos / ventaProductos) * 100) : null
    const gananciaServicios = redondear(ventaServicios - personalComprometido)
    const gananciaBruta = redondear(gananciaProductos + gananciaServicios + sinDetalle - bonificacionGeneral + extraGanancia)

    // Gastos registrados en la obra (combustible, materiales extra, etc.), sin
    // el personal (ya descontado arriba, en la ganancia) ni el Gasto extra (no
    // es un gasto real tuyo: es plata que el cliente te devuelve, así que no
    // puede mover el resultado proyectado). Mientras el Gasto extra está
    // "Aprobado" sí sale de tu bolsillo, por eso se sigue mostrando aparte y sí
    // afecta el resultado de caja. Cuando lo marcás "Pagado" se borra el costo
    // asociado (ver AdicionalesObra).
    const registradosPersonal = costos.filter((c) => c.personal_id != null).reduce((s, c) => s + c.monto, 0)
    const gastosPorTipo = costos.filter((c) => c.personal_id == null && c.tipo !== 'gasto_extra').reduce<Record<string, number>>((acc, c) => {
      const clave = ETIQUETAS_EGRESO[c.tipo] ? c.tipo : 'otro'
      acc[clave] = (acc[clave] || 0) + c.monto
      return acc
    }, {})
    const gastoExtraCostos = costos.filter((c) => c.tipo === 'gasto_extra').reduce((s, c) => s + c.monto, 0)

    const gastosPrevistos = redondear(Object.values(gastosPorTipo).reduce((s, v) => s + v, 0))
    const resultadoProyectado = redondear(gananciaBruta - gastosPrevistos)
    const margenProyectado = valorActualizado > 0 ? Math.round((resultadoProyectado / valorActualizado) * 100) : null

    return {
      contratado, extra, extraGanancia, extraGastoExtra, valorActualizado, cobrado,
      ventaProductos, costoProductos, gananciaProductos, margenProductos,
      ventaServicios, gananciaServicios, bonificacionGeneral, sinDetalle, gananciaBruta,
      registradosPersonal, gastosPorTipo, gastoExtraCostos, gastosPrevistos,
      personalComprometido, personalPagado, personalPendiente,
      resultadoProyectado, margenProyectado,
    }
  }, [presupuestos, adicionales, costos, pagos, asignaciones, personas, jornales, items])

  const color = (v: number) => (v > 0 ? '#23764e' : v < 0 ? '#b23b32' : '#4b525c')
  // Productos sin costo cargado: toda la venta se toma como ganancia.
  const productosSinCosto = datos.ventaProductos > 0 && datos.costoProductos === 0

  // Lo que corresponde haber cobrado según el avance (el Gasto extra pendiente
  // se cobra completo, sin escalarlo por el avance) y el saldo total de la obra.
  const valorTotalObra = redondear(datos.valorActualizado + datos.extraGastoExtra)
  const situacion = situacionCobro(datos.valorActualizado, datos.extraGastoExtra, pagos, avance)
  const saldoObra = redondear(valorTotalObra - datos.cobrado)

  return (
    <section className="obraFotosSeccion" aria-label="Rentabilidad de la obra">
      <div className="seguimientoAcciones">
        <div>
          <h3>Rentabilidad de la obra</h3>
          <p>Ganancia del presupuesto (margen de productos y de mano de obra, ya descontado el costo del personal) menos los demás gastos de la obra.</p>
        </div>
        <button type="button" className="editButton" disabled={cargando} onClick={() => setRevision((v) => v + 1)}>Actualizar</button>
      </div>

      {cargando && <p role="status">Calculando...</p>}
      {error && <p className="loginError" role="alert">{error}</p>}

      {!cargando && !error && (<>
        {productosSinCosto && (
          <p className="gestionAyuda" role="note" style={{ background: '#fff7e6', border: '1px solid #f1d29a', borderRadius: 10, padding: '10px 12px', color: '#7a4b00' }}>
            Los productos de este presupuesto no tienen costo cargado (ni en el presupuesto ni en el catálogo), por eso se toma toda su venta como ganancia. Cargá el costo del producto en el catálogo y este cálculo lo toma solo; también podés editar el presupuesto y completar el costo unitario del ítem.
          </p>
        )}

        <div className="rentGrid">
          <div className="rentCol">
            <h4>Ganancia del presupuesto</h4>
            {datos.ventaProductos > 0 && <>
              <div className="rentRow"><span>Productos vendidos</span><strong>{moneda(datos.ventaProductos)}</strong></div>
              <div className="rentRow"><span>Costo de los productos</span><strong>− {moneda(datos.costoProductos)}</strong></div>
              <div className="rentRow"><span>Ganancia en productos{datos.margenProductos != null ? ` (margen ${datos.margenProductos}%)` : ''}</span><strong style={{ color: color(datos.gananciaProductos) }}>{moneda(datos.gananciaProductos)}</strong></div>
            </>}
            {datos.ventaServicios > 0 && <div className="rentRow"><span>Mano de obra e instalación</span><strong>{moneda(datos.ventaServicios)}</strong></div>}
            {datos.personalComprometido > 0 && <div className="rentRow"><span>Costo de personal asignado</span><strong>− {moneda(datos.personalComprometido)}</strong></div>}
            {(datos.ventaServicios > 0 || datos.personalComprometido > 0) && <div className="rentRow"><span>Ganancia en mano de obra e instalación{datos.personalComprometido === 0 ? ' (100% ganancia)' : ''}</span><strong style={{ color: color(datos.gananciaServicios) }}>{moneda(datos.gananciaServicios)}</strong></div>}
            {datos.sinDetalle > 0 && <div className="rentRow"><span>Presupuesto sin detalle de ítems</span><strong>{moneda(datos.sinDetalle)}</strong></div>}
            {datos.bonificacionGeneral > 0 && <div className="rentRow"><span>Bonificación general</span><strong>− {moneda(datos.bonificacionGeneral)}</strong></div>}
            {datos.extraGanancia !== 0 && <div className="rentRow"><span>Adicionales aprobados</span><strong style={{ color: color(datos.extraGanancia) }}>{datos.extraGanancia >= 0 ? '+' : ''}{moneda(datos.extraGanancia)}</strong></div>}
            {datos.contratado === 0 && datos.extra === 0 && <div className="rentRow"><span>Sin presupuestos aceptados</span><strong>{moneda(0)}</strong></div>}
            <div className="rentRow total"><span>Ganancia bruta</span><strong>{moneda(datos.gananciaBruta)}</strong></div>
          </div>

          <div className="rentCol">
            <h4>Gastos de la obra</h4>
            <p className="gestionAyuda" style={{ marginTop: 0 }}>No incluye personal (ya está descontado a la izquierda).</p>
            {Object.entries(datos.gastosPorTipo).map(([tipo, monto]) => (
              <div className="rentRow" key={tipo}><span>{ETIQUETAS_EGRESO[tipo] ?? tipo}</span><strong>{moneda(monto)}</strong></div>
            ))}
            {datos.gastosPrevistos === 0 && datos.gastoExtraCostos === 0 && <div className="rentRow"><span>Sin gastos registrados</span><strong>{moneda(0)}</strong></div>}
            <div className="rentRow total"><span>Total de gastos previstos</span><strong>{moneda(datos.gastosPrevistos)}</strong></div>
            {datos.gastoExtraCostos !== 0 && (
              <div className="rentRow" style={{ opacity: 0.75, borderTop: '1px dashed #e2e5e9', paddingTop: 8, marginTop: 4 }}>
                <span>Gasto extra pendiente de devolución <small style={{ display: 'block' }}>No suma al total ni al resultado proyectado</small></span>
                <strong>{moneda(datos.gastoExtraCostos)}</strong>
              </div>
            )}
          </div>
        </div>

        {datos.gastoExtraCostos !== 0 && (
          <p className="gestionAyuda" role="note" style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, padding: '10px 12px', color: '#3730a3' }}>
            Gastos extra pendientes de devolución: <strong>{moneda(datos.gastoExtraCostos)}</strong>. Es plata que adelantaste y el cliente todavía no te devolvió: no resta del resultado proyectado (nunca fue ganancia ni gasto tuyo), pero ya está sumado a lo que te debe el cliente (resultado de caja), a valor completo, sin depender del avance. Cuando el cliente te lo reembolse, marcá el adicional como <strong>Pagado</strong> en la pestaña Adicionales y ese movimiento queda cancelado del todo.
          </p>
        )}

        <div className="rentResultados">
          <div className="rentResultado">
            <span>RESULTADO PROYECTADO</span>
            <strong style={{ color: color(datos.resultadoProyectado) }}>{moneda(datos.resultadoProyectado)}</strong>
            <small>
              Ganancia bruta − gastos previstos
              {datos.margenProyectado != null ? ` · ${datos.margenProyectado}% del valor de la obra` : ''}
            </small>
          </div>
          <div className="rentResultado">
            <span>RESULTADO DE CAJA</span>
            <strong style={{ color: situacion.diferencia > 0 ? '#23764e' : situacion.diferencia < 0 ? '#b23b32' : undefined }}>{moneda(Math.abs(situacion.diferencia))}</strong>
            <small>
              {situacion.diferencia > 0
                ? `El cliente te adelantó esto sobre el ${situacion.pct}% de avance`
                : situacion.diferencia < 0
                  ? `Esto te debe el cliente sobre el ${situacion.pct}% de avance`
                  : `Cobros al día con el ${situacion.pct}% de avance`}
            </small>
          </div>
        </div>

        <div className="rentPersonal">
          <h4>Referencias</h4>
          <div className="rentPersonalGrid">
            <div><span>Valor actualizado</span><strong>{moneda(datos.valorActualizado)}</strong></div>
            <div><span>Cobrado a la fecha</span><strong>{moneda(datos.cobrado)}</strong></div>
            <div><span>Costo de productos</span><strong>{moneda(datos.costoProductos)}</strong></div>
          </div>
        </div>

        {(datos.personalComprometido > 0 || datos.personalPagado > 0) && (
          <div className="rentPersonal">
            <h4>Personal</h4>
            <div className="rentPersonalGrid">
              <div><span>Costo previsto</span><strong>{moneda(datos.personalComprometido)}</strong></div>
              <div><span>Pagado</span><strong>{moneda(datos.personalPagado)}</strong></div>
              <div><span>Por pagar</span><strong style={{ color: datos.personalPendiente > 0 ? '#b86608' : '#23764e' }}>{moneda(datos.personalPendiente)}</strong></div>
            </div>
          </div>
        )}
        <p className="gestionAyuda">La <strong>ganancia bruta</strong> es lo que te queda en el bolsillo del presupuesto: en los productos, la venta menos su costo; en mano de obra e instalación, la venta menos lo que le pagás al personal asignado a la obra (si nadie está asignado, es 100% ganancia); los adicionales de tipo Producto extra, Servicio extra y Ajuste suman o restan según el importe que cargues, y la Bonificación siempre resta. El <strong>Gasto extra</strong> nunca entra acá (no es plata tuya, es un adelanto que el cliente te devuelve). Los <strong>gastos de la obra</strong> son solo lo que cargues en Compras/gastos (combustible, ferretería, varios) — el personal ya se descontó arriba, así que no se cuenta dos veces. El Gasto extra se muestra aparte, como referencia, mientras esté "Aprobado" (todavía no te lo devolvieron): no resta del <strong>resultado proyectado</strong> (nunca mueve lo que ya sabés que vas a ganar), pero sí forma parte de lo que te debe el cliente hoy (a valor completo, sin depender del avance), porque ya lo adelantaste vos. Cuando marcás un Gasto extra como <strong>Pagado</strong> (pestaña Adicionales), ese movimiento queda cancelado del todo. El resultado proyectado supone cobrar todo y pagar todo lo previsto; el de <strong>caja</strong> es el saldo con el cliente hoy: lo que corresponde cobrarle según el avance real (más el Gasto extra pendiente) menos lo que ya cobraste — te dice si te debe o si te adelantó plata. No depende de los pagos al personal. El costo de los productos ya está en el presupuesto: no lo vuelvas a cargar como gasto.</p>

        <h4 style={{ marginTop: '28px' }}>Cobros del cliente</h4>
        <p className="gestionAyuda" style={{ marginTop: 0 }}>Detalle de cómo se arma el "Resultado de caja" de arriba.</p>
        <div className="rentPersonalGrid">
          <div><span>Valor de la obra</span><strong>{moneda(valorTotalObra)}</strong></div>
          <div><span>Corresponde cobrar ({situacion.pct}%)</span><strong>{moneda(situacion.corresponde)}</strong></div>
          <div><span>Cobrado a la fecha</span><strong>{moneda(situacion.cobrado)}</strong></div>
          <div>
            <span>Saldo total de la obra</span>
            <strong>{moneda(Math.max(saldoObra, 0))}</strong>
          </div>
        </div>

        {pagos.length > 0 && (
          <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto', marginTop: 10 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Medio</th><th>Referencia</th><th>Monto</th></tr></thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{fechaCorta(p.fecha)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{(p.medio_pago || '').replace('_', ' ') || '—'}</td>
                    <td>{p.referencia || '—'}</td>
                    <td><strong>{moneda(p.monto)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h4 style={{ marginTop: '28px' }}>Compras y comprobantes</h4>
        {compras.length === 0 ? <p className="adicVacio">No hay compras registradas para esta obra.</p> : (
          <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Fecha</th><th>Material / proveedor</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th><th>Comprobante</th></tr></thead>
              <tbody>
                {compras.map((compra) => (
                  <tr key={compra.id}>
                    <td>{fechaCorta(compra.fecha)}</td>
                    <td><strong>{compra.nombre}</strong><br /><small>{compra.proveedor || 'Sin proveedor'}</small></td>
                    <td>{compra.cantidad} {compra.unidad}</td>
                    <td>{moneda(compra.precio_unitario)}</td>
                    <td>{moneda(redondear(compra.cantidad * compra.precio_unitario))}</td>
                    <td>
                      {compra.numero_comprobante && <div>{compra.numero_comprobante}</div>}
                      {compra.comprobante_path ? (<>
                        <button type="button" className="editButton" disabled={abriendo !== null} onClick={() => void prepararComprobante(compra)}>
                          {abriendo === compra.id ? 'Preparando...' : 'Ver comprobante'}
                        </button>
                        {comprobante?.id === compra.id && <div><a href={comprobante.url} target="_blank" rel="noopener noreferrer">Abrir archivo (enlace por 5 minutos)</a></div>}
                      </>) : <span>Sin archivo adjunto</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {errorComprobante && <p className="loginError" role="alert">{errorComprobante}</p>}

        <h4 style={{ marginTop: '28px' }}>Detalle de costos</h4>
        {costos.length === 0 ? <p className="adicVacio">No hay costos registrados para esta obra.</p> : (
          <div className="gestionTabla" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Monto</th></tr></thead>
              <tbody>
                {costos.map((costo) => (
                  <tr key={costo.id}>
                    <td>{fechaCorta(costo.fecha)}</td>
                    <td>{TIPOS_COSTO[costo.tipo] ?? costo.tipo}</td>
                    <td>{costo.descripcion || 'Sin detalle'}</td>
                    <td>{moneda(costo.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>)}
    </section>
  )
}

export default RentabilidadObra
