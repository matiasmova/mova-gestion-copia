import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type Perfil = {
  id: string
  nombre: string | null
  rol: string
  activo: boolean
  created_at: string
}

const ROLES = [
  ['admin', 'Administrador'],
  ['encargado', 'Encargado'],
  ['auxiliar', 'Auxiliar'],
  ['contable', 'Contable'],
] as const

export default function Usuarios() {
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  async function cargar() {
    setCargando(true)
    setError('')
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nombre, rol, activo, created_at')
      .order('created_at', { ascending: true })
    if (error) {
      console.error(error)
      setError('No se pudieron cargar los usuarios. ¿Se corrió la migración fase 5?')
    } else {
      setPerfiles((data ?? []) as Perfil[])
    }
    setCargando(false)
  }

  async function cambiarRol(perfil: Perfil, rol: string) {
    const { error } = await supabase.from('profiles').update({ rol }).eq('id', perfil.id)
    if (error) {
      setError('No se pudo cambiar el rol.')
      return
    }
    setPerfiles((arr) => arr.map((x) => (x.id === perfil.id ? { ...x, rol } : x)))
    setAviso(`Rol de ${perfil.nombre ?? 'usuario'} actualizado a ${rol}.`)
  }

  async function cambiarActivo(perfil: Perfil) {
    const { error } = await supabase.from('profiles').update({ activo: !perfil.activo }).eq('id', perfil.id)
    if (error) {
      setError('No se pudo cambiar el estado.')
      return
    }
    setPerfiles((arr) => arr.map((x) => (x.id === perfil.id ? { ...x, activo: !x.activo } : x)))
  }

  return (
    <div className="gestionPage">
      <div className="pageHeader">
        <div>
          <p className="subtitle">SEGURIDAD</p>
          <h2>Usuarios y permisos</h2>
          <p className="welcome">Roles de acceso del equipo</p>
        </div>
      </div>

      {error && <p className="loginError">{error}</p>}
      {aviso && <p className="pagoSaldo">{aviso}</p>}

      {cargando ? (
        <p>Cargando usuarios...</p>
      ) : (
        <div className="gestionTabla">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Alta</th>
              </tr>
            </thead>
            <tbody>
              {perfiles.length === 0 ? (
                <tr>
                  <td colSpan={4}>Todavía no hay usuarios cargados.</td>
                </tr>
              ) : (
                perfiles.map((perfil) => (
                  <tr key={perfil.id}>
                    <td>
                      <strong>{perfil.nombre || 'Sin nombre'}</strong>
                    </td>
                    <td>
                      <select value={perfil.rol} onChange={(e) => cambiarRol(perfil, e.target.value)}>
                        {ROLES.map(([valor, etiqueta]) => (
                          <option key={valor} value={valor}>
                            {etiqueta}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        className={perfil.activo ? 'gestionEstado ok' : 'gestionEstado alerta'}
                        onClick={() => cambiarActivo(perfil)}
                      >
                        {perfil.activo ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td>{new Date(perfil.created_at).toLocaleDateString('es-AR')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="gestionAviso" style={{ marginTop: 16, textAlign: 'left' }}>
        <strong>¿Cómo agregar un usuario nuevo?</strong>
        <br />
        Por seguridad, los usuarios se crean desde <b>Supabase → Authentication → Users → Add user</b> (o
        la persona se registra desde el login). Apenas ingresa por primera vez, aparece en esta lista y le
        asignás el rol. Cada rol ve distintos módulos: <b>Administrador</b> (todo), <b>Encargado</b>
        (obras, clientes y compras), <b>Auxiliar</b> (obras asignadas), <b>Contable</b> (finanzas y
        presupuestos).
      </div>
    </div>
  )
}
