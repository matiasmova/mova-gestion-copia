// Cuándo se bajó la última copia de seguridad en esta computadora (Excel, ZIP o
// respaldo automático), para avisar si pasó más de una semana.
const CLAVE_ULTIMA = 'mova_ultima_copia'

export function diasDesdeUltimaCopia(): number | null {
  try { const f = localStorage.getItem(CLAVE_ULTIMA); return f ? Math.floor((Date.now() - Number(f)) / 86400000) : null } catch { return null }
}

export function anotarCopia() {
  try { localStorage.setItem(CLAVE_ULTIMA, String(Date.now())) } catch { /* sin almacenamiento */ }
}
