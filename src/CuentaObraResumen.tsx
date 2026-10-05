import { Cifra } from './Animados'
import { mensajeEstado, totalAPagarHoy, type EstadoPresupuesto } from './estadoObra'

// Estado de cuenta de la obra, con los mismos números que el documento del
// cliente: lo pendiente de la obra y, aparte, los gastos extra a reintegrar.
// Con "lineaTiempo" muestra también los pasos de pago y cada gasto extra.

type Props = { cuenta: EstadoPresupuesto; dinero: (n: number) => string; lineaTiempo?: boolean }

const fechaCorta = (f: string | null) => (f ? new Date(`${f.slice(0, 10)}T00:00:00`).toLocaleDateString('es-AR') : '')

export default function CuentaObraResumen({ cuenta, dinero, lineaTiempo = false }: Props) {
  const msg = mensajeEstado(cuenta, dinero)
  const hoy = totalAPagarHoy(cuenta)
  const extras = cuenta.gastoExtraPendiente
  const saldoTotal = Math.max(0, cuenta.saldoTotal) + Math.max(0, extras)
  return (
    <div className="cuentaObra">
      <div className="cuentaObraKpis">
        <div><span>Total de la obra</span><strong><Cifra valor={cuenta.totalActualizado} formato={dinero} /></strong></div>
        <div><span>Ya pagó</span><strong className="ok"><Cifra valor={cuenta.cobrado} formato={dinero} /></strong></div>
        <div>
          <span>{cuenta.adelanto > 0.5 ? 'Adelanto del cliente' : 'Pendiente de la obra'}</span>
          <strong className={cuenta.pendienteHoy > 0.5 ? 'pend' : 'ok'}><Cifra valor={cuenta.adelanto > 0.5 ? cuenta.adelanto : cuenta.pendienteHoy} formato={dinero} /></strong>
          <small>Según el avance ({cuenta.avance}%)</small>
        </div>
        <div className="extra"><span>Gastos a reintegrar</span><strong><Cifra valor={extras} formato={dinero} /></strong><small>{extras > 0.5 ? 'Extras no pagados' : 'Sin pendientes'}</small></div>
        <div className={`hoy ${hoy > 0.5 ? '' : 'aldia'}`}>
          <span>Total a cobrar hoy</span><strong><Cifra valor={hoy} formato={dinero} /></strong>
          <small>{hoy > 0.5 ? (extras > 0.5 && cuenta.pendienteHoy > 0.5 ? 'Obra + extras' : extras > 0.5 ? 'Extras a reintegrar' : 'De la obra') : 'Está al día'}</small>
        </div>
      </div>
      <p className={`cuentaObraMsg ${msg.tono}`}>{msg.tono === 'ok' ? '✓' : '⚠'} <b>{msg.titulo}</b> · Saldo total (obra + extras): {dinero(saldoTotal)}</p>

      {lineaTiempo && <>
        <h4 className="cuentaObraTit">Línea de tiempo de pagos</h4>
        <ul className="cuentaObraLinea">
          {cuenta.linea.map((p, i) => (
            <li key={i} className={p.estado}>
              <i>{p.estado === 'ok' ? '✓' : p.estado === 'pendiente' ? '!' : ''}</i>
              <div>
                <b>{p.fecha && p.tipo !== 'anticipo' ? `${fechaCorta(p.fecha)} · ` : ''}{p.titulo}{p.porcentaje != null && p.tipo === 'avance' ? ` · ${p.porcentaje}%` : ''}</b>
                <small>{p.tipo === 'anticipo' ? (p.detalle ?? '') : `A pagar hasta acá: ${dinero(p.acumulado)}`}</small>
              </div>
              <div className="m">
                <b>{p.tipo === 'anticipo' ? dinero(p.importe) : p.importe < -0.5 ? `− ${dinero(-p.importe)}` : `+ ${dinero(p.importe)}`}</b>
                <small>{p.estado === 'ok' ? (p.tipo === 'anticipo' ? 'Recibido' : 'Al día') : p.estado === 'futuro' ? 'Al finalizar' : `Falta ${dinero(p.falta)}`}</small>
              </div>
            </li>
          ))}
        </ul>
        {cuenta.gastosExtra.length > 0 && <>
          <h4 className="cuentaObraTit">Gastos extra a reintegrar</h4>
          <ul className="cuentaObraLinea">
            {cuenta.gastosExtra.map((g) => (
              <li key={g.id} className={g.devuelto ? 'ok' : 'extra'}>
                <i>{g.devuelto ? '✓' : '!'}</i>
                <div><b>{g.descripcion || 'Gasto extra'}</b><small>{fechaCorta(g.fecha)}{g.devuelto ? ' · ya reintegrado, no suma' : ' · extra no pagado, suma al total'}</small></div>
                <div className="m"><b>{dinero(g.importe)}</b><small>{g.devuelto ? 'Reintegrado' : 'Pendiente'}</small></div>
              </li>
            ))}
          </ul>
          <p className="gestionAyuda" style={{ marginTop: 6 }}>Cuando el cliente te devuelva un gasto, en <b>Registrar cobro</b> elegí <b>“A gastos extra”</b>: el gasto pasa a pagado (o queda pendiente lo que falte).</p>
        </>}
      </>}
    </div>
  )
}
