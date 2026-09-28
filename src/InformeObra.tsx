export type ObraInforme = {
  id: number; nombre_obra: string; direccion: string | null; localidad: string | null
  estado: string | null; porcentaje_avance: number | null
  fecha_inicio: string | null; fecha_fin_estimada: string | null; descripcion: string | null
}
// Compatibilidad: informe y pagos ya no tienen cálculos ni formatos separados.
export { default } from './EstadoObraPDF'
