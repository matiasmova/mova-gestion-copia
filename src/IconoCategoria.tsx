// Íconos de línea (sobrios, del color del texto) para las categorías de productos.
const TRAZOS: Record<string, string[]> = {
  Teclas: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M10 8h4v8h-4z'],
  Switch: ['M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7z', 'M16 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'],
  Sensores: ['M12 11.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z', 'M8.5 8.5a5 5 0 0 0 0 7', 'M15.5 8.5a5 5 0 0 1 0 7', 'M5.6 5.6a9 9 0 0 0 0 12.8', 'M18.4 5.6a9 9 0 0 1 0 12.8'],
  Hub: ['M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', 'M12 3v6.5', 'M4.5 19l5.6-5.1', 'M19.5 19l-5.6-5.1'],
  'Cámaras': ['M3 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3z', 'M16 10.5l5-3v9l-5-3'],
  WiFi: ['M2 8.8a15 15 0 0 1 20 0', 'M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 19.5h.01'],
  LED: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3'],
  Accesorios: ['M9 2v5', 'M15 2v5', 'M6 7h12v4a6 6 0 0 1-12 0z', 'M12 17v5'],
  Cerraduras: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4', 'M12 15v2'],
  'Iluminación solar': ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  'Protectores de tensión': ['M13 2 4 14h7l-1 8 9-12h-7z'],
  Termostatos: ['M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z', 'M12 9v6'],
  Pantallas: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  Alexa: ['M7 5c0 1.1 2.2 2 5 2s5-.9 5-2-2.2-2-5-2-5 .9-5 2z', 'M7 5v13c0 1.1 2.2 2 5 2s5-.9 5-2V5', 'M7 15c0 1.1 2.2 2 5 2s5-.9 5-2'],
  Productos: ['M21 8 12 3 3 8v8l9 5 9-5z', 'M3 8l9 5 9-5', 'M12 13v8'],
  Servicios: ['M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z'],
  Todo: ['M4 5h16', 'M4 12h16', 'M4 19h16'],
  sin: ['M3 12V3h9l9 9-9 9z', 'M7.5 7.5h.01'],
}

export default function IconoCategoria({ nombre, tamano = 15 }: { nombre: string | null | undefined; tamano?: number }) {
  const trazos = TRAZOS[(nombre ?? '').trim()] ?? TRAZOS.sin
  return <svg className="icoCat" width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {trazos.map((d) => <path key={d} d={d} />)}
  </svg>
}
