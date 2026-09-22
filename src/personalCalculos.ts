// Cálculo de lo que corresponde pagarle a cada persona de una obra.
// Lo usan la pestaña Personal y la de Rentabilidad, para que den lo mismo.
//
//  · Por día / por hora  -> se devenga con los jornales cargados:
//                           jornadas (u horas) × valor.
//  · Por obra / por etapa -> valor acordado total, que se devenga con el
//                           avance de la obra (valor × % de avance).
//  · Por porcentaje       -> % del valor de la obra, también según avance.

export type PersonaCalc = { id: number; costo_dia: number | null }

export type AsignacionCalc = {
  personal_id: number | null
  modalidad: string | null
  valor_acordado: number | null
}

export type PagoCalc = { personal_id: number | null; monto: number }

export type JornalCalc = {
  personal_id: number | null
  jornada: number
  horas: number | null
}

export type CalculoPersona = {
  modalidad: string
  // Valor tal como se acordó (por día, por hora, total de la obra o %).
  valorBase: number
  // Total del contrato en pesos; null si es por día o por hora.
  totalContrato: number | null
  // Lo que corresponde haber pagado hasta hoy.
  devengado: number
  pagado: number
  // devengado − pagado: positivo = falta pagar; negativo = adelantado.
  diferencia: number
  // Costo total previsto de esta persona en la obra.
  proyectado: number
  // Lo que falta pagar para completar el costo previsto.
  porPagarProyectado: number
  jornadas: number
  horas: number
  // Falta cargar el valor por día / por hora para poder calcular.
  faltaValor: boolean
}

const redondear = (n: number) => Math.round(n * 100) / 100

export function calcularPersona(
  asignacion: AsignacionCalc,
  persona: PersonaCalc | undefined,
  pagos: PagoCalc[],
  jornales: JornalCalc[],
  valorObra: number,
  avance: number,
): CalculoPersona {
  const modalidad = asignacion.modalidad ?? 'por_obra'
  const base = Number(asignacion.valor_acordado) || 0
  const factorAvance = Math.min(Math.max(avance || 0, 0), 100) / 100

  const pagado = redondear(
    pagos
      .filter((p) => p.personal_id === asignacion.personal_id)
      .reduce((suma, p) => suma + (Number(p.monto) || 0), 0),
  )
  const suyos = jornales.filter((j) => j.personal_id === asignacion.personal_id)
  const jornadas = suyos.reduce((s, j) => s + (Number(j.jornada) || 0), 0)
  const horas = suyos.reduce((s, j) => s + (Number(j.horas) || 0), 0)

  let devengado = 0
  let totalContrato: number | null = null
  let faltaValor = false

  if (modalidad === 'por_dia') {
    const valorDia = base > 0 ? base : Number(persona?.costo_dia) || 0
    faltaValor = valorDia === 0
    devengado = jornadas * valorDia
  } else if (modalidad === 'por_hora') {
    faltaValor = base === 0
    devengado = horas * base
  } else if (modalidad === 'porcentaje') {
    totalContrato = (valorObra * base) / 100
    devengado = totalContrato * factorAvance
  } else {
    // por_obra, por_etapa y cualquier otra: valor total según avance.
    totalContrato = base
    devengado = totalContrato * factorAvance
  }

  devengado = redondear(devengado)
  if (totalContrato != null) totalContrato = redondear(totalContrato)

  const proyectado = redondear(
    Math.max(totalContrato != null ? totalContrato : devengado, pagado),
  )

  return {
    modalidad,
    valorBase: base,
    totalContrato,
    devengado,
    pagado,
    diferencia: redondear(devengado - pagado),
    proyectado,
    porPagarProyectado: redondear(Math.max(proyectado - pagado, 0)),
    jornadas,
    horas,
    faltaValor,
  }
}
