// Roles, menú y permisos de la app (los usa el menú y la pantalla Usuarios).

export type Rol = 'admin' | 'encargado' | 'auxiliar' | 'contable'
export const ROLES: Record<Rol, string> = {
  admin: 'Administrador', encargado: 'Encargado', auxiliar: 'Auxiliar', contable: 'Contable',
}
export const ROLES_VALIDOS: Rol[] = ['admin', 'encargado', 'auxiliar', 'contable']

// Inicio reúne el resumen y lo que antes era el Tablero (balance, cobranzas,
// personal, gastos fijos e inventario), cada cosa en su pestaña.
export const NAVEGACION = [
  ['dashboard', 'principal', 'Inicio'],
  ['agenda', 'principal', 'Agenda'],
  ['clientes', 'comercial', 'Clientes'],
  ['relevamientos', 'comercial', 'Relevamientos'],
  // Presupuestos y Obras se ven juntos en "Trabajos" (un solo ítem del menú).
  ['presupuestos', 'comercial', 'Trabajos · presupuestos'],
  ['obras', 'comercial', 'Trabajos'],
  ['soluciones', 'comercial', 'Soluciones'],
  ['catalogo', 'operacion', 'Productos y servicios'],
  ['compras', 'operacion', 'Compras'],
  ['personal', 'operacion', 'Personal'],
  ['finanzas', 'operacion', 'Movimientos'],
  ['usuarios', 'sistema', 'Usuarios'],
  ['configuracion', 'sistema', 'Configuración'],
] as const

// Secciones del menú, en orden.
export const GRUPOS_MENU: [string, string][] = [
  ['principal', 'Principal'],
  ['comercial', 'Comercial'],
  ['operacion', 'Operación'],
  ['sistema', 'Sistema'],
]

export type Vista = (typeof NAVEGACION)[number][0]

// Qué roles ven cada módulo. Si un módulo no figura acá, lo ven todos.
export const PERMISOS: Partial<Record<Vista, Rol[]>> = {
  clientes: ['admin', 'encargado', 'contable'],
  relevamientos: ['admin', 'encargado', 'contable'],
  presupuestos: ['admin', 'contable'],
  soluciones: ['admin', 'contable'],
  finanzas: ['admin', 'contable'],
  compras: ['admin', 'encargado', 'auxiliar'],
  personal: ['admin', 'encargado', 'contable'],
  usuarios: ['admin'],
  configuracion: ['admin'],
}
// Vistas que existen pero no tienen ítem propio en el menú.
export const FUERA_DEL_MENU: Vista[] = ['presupuestos']

export const puedeVer = (rol: Rol, vista: Vista) =>
  (PERMISOS[vista] ?? ROLES_VALIDOS).includes(rol)
