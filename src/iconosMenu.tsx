// Íconos del menú lateral (estilo lineal, se pintan con el color del texto).

const TRAZOS: Record<string, string[]> = {
  dashboard: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M9 21v-6h6v6'],
  tablero: ['M3 3v18h18', 'M8 17v-5', 'M13 17V8', 'M18 17v-9'],
  clientes: ['M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M2 21a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7.5', 'M22 21a6 6 0 0 0-4-5.6'],
  presupuestos: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M8 13h8', 'M8 17h5'],
  obras: ['M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16', 'M2 21h20', 'M9 7h1', 'M14 7h1', 'M9 11h1', 'M14 11h1', 'M9 15h1', 'M14 15h1', 'M10 21v-3h4v3'],
  catalogo: ['M21 8 12 3 3 8v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
  soluciones: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3'],
  compras: ['M10.5 20a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0', 'M19.5 20a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0', 'M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21 8H6'],
  personal: ['M4 18h16', 'M5 18v-3a7 7 0 0 1 14 0v3', 'M10 8V5h4v3', 'M3 21h18'],
  finanzas: ['M7 7h13', 'M17 4l3 3-3 3', 'M17 17H4', 'M7 14l-3 3 3 3'],
  notificaciones: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a2 2 0 0 0 3.4 0'],
  usuarios: ['M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', 'm9 12 2 2 4-4'],
  configuracion: ['M4 6h10', 'M18 6h2', 'M4 12h4', 'M12 12h8', 'M4 18h12', 'M20 18h0', 'M16 4v4', 'M10 10v4', 'M18 16v4'],
  salir: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
}

export default function IconoMenu({ nombre, tamano = 18 }: { nombre: string; tamano?: number }) {
  const trazos = TRAZOS[nombre] ?? TRAZOS.dashboard
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {trazos.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}
