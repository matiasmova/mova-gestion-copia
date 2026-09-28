// Doble confirmación para acciones que borran datos y no tienen vuelta atrás.
// 1) Muestra el aviso de la acción.  2) Pide una segunda confirmación.
// Con `escribir: true` (lo más grave: obras y presupuestos) el segundo paso
// exige escribir ELIMINAR, para que no se confirme de un toque sin querer.
export function confirmarEliminacion(mensaje: string, opciones: { escribir?: boolean } = {}): boolean {
  if (!window.confirm(mensaje)) return false
  if (opciones.escribir) {
    const texto = window.prompt('⚠ ÚLTIMA CONFIRMACIÓN\n\nEsta acción NO se puede deshacer.\nPara confirmar, escribí ELIMINAR:')
    if (texto == null) return false
    if (texto.trim().toUpperCase() !== 'ELIMINAR') {
      window.alert('No se eliminó nada: el texto no coincide.')
      return false
    }
    return true
  }
  return window.confirm('⚠ ÚLTIMA CONFIRMACIÓN\n\n¿Seguro que querés eliminarlo? Esta acción NO se puede deshacer.')
}
