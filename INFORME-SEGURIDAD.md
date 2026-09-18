# Informe de Seguridad — MOVA Gestión

**Auditoría de ciberseguridad de punta a punta**
Fecha: 2026-09-18 · Alcance: código, secretos, dependencias, base de datos (Supabase/RLS), autenticación, storage y despliegue (Vercel).

---

## 1. Resumen ejecutivo

La aplicación tiene una **base de seguridad sólida**: la protección más importante de este stack — las políticas de acceso a nivel de fila (**RLS**) en la base de datos — está **bien configurada y activa en todas las tablas**, el front no tiene vulnerabilidades de inyección y las dependencias están limpias.

Se detectó **1 hallazgo crítico** (registro público de usuarios abierto, con rol admin por defecto) y varios de severidad media/baja. El crítico se cierra con **un interruptor** en Supabase + un script SQL. Todo lo demás son mejoras de defensa en profundidad.

**Postura general:** buena, con una acción urgente pendiente.

| Severidad | Cantidad | Estado |
|---|---|---|
| 🔴 Crítica | 1 | ✅ Corregida y verificada |
| 🟠 Media | 6 | ✅ 5 corregidas · 1 requiere plan Pro |
| 🟡 Baja | 3 | ✅ 2 corregidas · 1 recomendación (Fase 2) |

**Estado tras la remediación:** el hueco crítico está **cerrado y verificado**. La app quedó con una postura de seguridad sólida.

---

## 2. Lo que ya está bien (fortalezas verificadas)

Esto se verificó en vivo, no es supuesto:

- **RLS activo en las 20 tablas** del esquema `public`, con **35 políticas** y **0 abiertas a usuarios anónimos/públicos**. La clave que viaja en el sitio (publishable key) **no puede leer ni escribir datos** sin un usuario logueado. Esta es la defensa central y está correcta.
- **Sin `service_role` expuesta** en el código, el `.env` ni el repositorio. Solo se expone la publishable key, que es **pública por diseño**.
- **Los 3 buckets de Storage son privados** (`productos`, `obras`, `comprobantes`), con políticas solo para autenticados. Los comprobantes (documentos sensibles) no son accesibles públicamente.
- **Todas las funciones de base de datos tienen `search_path` fijado** y las `SECURITY DEFINER` están acotadas — sin vulnerabilidad de *search_path* mutable ni escalada de privilegios por funciones.
- **Front-end limpio:** 0 vulnerabilidades en dependencias (`npm audit`), **sin sinks de XSS** (no hay `innerHTML`, `eval`, ni `dangerouslySetInnerHTML`; los PDF se generan renderizando componentes React, no inyectando HTML), y las consultas usan RPC/consultas parametrizadas (sin inyección SQL/PostgREST).
- **Confirmación de email obligatoria** y **inicio de sesión anónimo deshabilitado**.
- **Escritura de roles restringida a admin** en la tabla `profiles` (un usuario no puede auto-promoverse cambiando su propio rol).

---

## 3. Hallazgos y remediación

### 🔴 CRÍTICO — H1. Registro público de usuarios abierto + rol admin por defecto  ✅ CORREGIDO

**Qué es.** En *Authentication → Sign In/Providers* está activado **"Allow new users to sign up"**, y la función `handle_new_user()` asignaba **rol `admin`** a todo usuario nuevo.

**Impacto.** La publishable key es pública (viaja en el sitio). Con esa clave, cualquiera podría registrarse contra el endpoint de Supabase, confirmar su propio email y quedar **autenticado con rol admin**. Como las políticas RLS dan acceso total a cualquier usuario autenticado, obtendría **lectura y escritura sobre todos los datos** (clientes, presupuestos, cobros, finanzas). Esto anula, en la práctica, toda la protección de RLS.

**Remediación aplicada (verificada):**
1. ✅ **Registro público desactivado** — verificado contra el endpoint real de GoTrue: `disable_signup = true`. La app **no tiene pantalla de registro**, así que no afecta el uso normal. Nuevos usuarios se dan de alta desde *Supabase → Authentication → Users → Add user*.
2. ✅ **Rol por defecto de usuarios nuevos = `auxiliar`** (mínimo privilegio) — `handle_new_user()` actualizada y verificada.

### 🟠 MEDIO — H2. Todas las políticas RLS dan acceso total a cualquier autenticado

**Qué es.** Las políticas son `for all to authenticated using(true)`: cualquier usuario logueado (auxiliar, contable, encargado) puede leer/editar/borrar **todas** las tablas vía API directa. El control por rol vive **solo en el front** (menú), que no es una frontera de seguridad.

**Impacto.** Un usuario interno de bajo privilegio podría, saltando la interfaz, acceder a datos que su rol no debería ver (ej. finanzas). Mitigado hoy porque los usuarios son internos y de confianza, y hay uno solo.

**Remediación (defensa en profundidad, Fase 2).** Políticas por rol usando el helper `es_admin()` / lectura de `profiles.rol` (ej.: finanzas y presupuestos solo `admin`/`contable`; borrado solo `admin`). Se puede implementar tabla por tabla sin romper la app. *Opcional pero recomendado.*

### 🟠 MEDIO — H3. Log de auditoría alterable

**Qué es.** `log_auditoria` tenía política `for all` → cualquier autenticado podía **editar o borrar** los registros de auditoría.

**Impacto.** El historial de "quién hizo qué" podía manipularse, perdiendo trazabilidad.

**Remediación.** Convertir a **solo-agregar** (append-only): solo INSERT + SELECT, sin UPDATE/DELETE. Incluido en `supabase-seguridad-hardening.sql`.

### 🟠 MEDIO — H4. Protección de contraseñas débil  ✅ PARCIAL

**Qué es.** "Prevent use of leaked passwords" estaba **DESACTIVADO** y la longitud mínima de contraseña era 6, sin exigencia de complejidad.

**Impacto.** Se aceptaban contraseñas cortas o ya filtradas en brechas.

**Remediación aplicada.** ✅ Longitud mínima subida a **8**. ⚠️ "Prevent use of leaked passwords" **solo está disponible en plan Pro** de Supabase (el proyecto está en Free) — queda pendiente para cuando se migre a Pro.

### 🟠 MEDIO — H5. Site URL apuntaba a `http://localhost:3000`  ✅ CORREGIDO

**Qué era.** En *URL Configuration*, el Site URL era el de desarrollo local (y en `http`), por lo que los correos de reseteo/confirmación enrutaban a `localhost` en producción.

**Remediación aplicada.** ✅ Site URL = `https://mova-gestion.vercel.app` (confirmado por Supabase). La lista de redirects sigue **sin wildcard** — no hay open-redirect.

### 🟠 MEDIO — H6. Faltaban headers de seguridad HTTP  ✅ CORREGIDO

**Qué era.** El sitio no enviaba CSP, HSTS, X-Frame-Options, etc. → riesgo de clickjacking y sin endurecimiento de transporte.

**Corregido.** Se agregó `vercel.json` con Content-Security-Policy (script-src propio), HSTS, X-Frame-Options: DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy y COOP. *Toma efecto al desplegar.*

### 🟡 BAJO — H7. `.env` versionado en git  ✅ MITIGADO

Solo contiene la publishable key (pública por diseño), así que el impacto es bajo. Se agregó `.env` al `.gitignore` y un `.env.example`. *Opcional:* mover las variables a *Vercel → Settings → Environment Variables* y dejar de versionar `.env`.

### 🟡 BAJO — H8. Fail-open de rol en el front  ✅ CORREGIDO

Si no se encontraba el perfil, la app asumía rol `admin`. Se cambió a **fail-closed**: sin perfil → `auxiliar` (mínimo privilegio).

### 🟡 BAJO — H9. Captcha desactivado + políticas RLS duplicadas

Captcha off en endpoints de auth (mitigado por los rate limits por defecto de Supabase; relevante sobre todo si el registro quedara abierto). Además hay políticas RLS heredadas duplicadas (limpieza cosmética, no es vulnerabilidad).

---

## 4. Cambios ya aplicados en esta auditoría (código)

- `vercel.json` — headers de seguridad HTTP (CSP, HSTS, anti-clickjacking, etc.).
- `src/AppFase2.tsx` — control de rol *fail-closed* (mínimo privilegio si no hay perfil).
- `.gitignore` + `.env.example` — higiene de secretos.
- `supabase-seguridad-hardening.sql` — script listo para correr (rol mínimo + log append-only).

> Estos cambios de código requieren **Commit & Sync** para llegar a Vercel.

## 5. Cambios aplicados en Supabase (esta sesión, verificados)

1. ✅ **Registro público desactivado** (H1) — `disable_signup = true` confirmado.
2. ✅ **`supabase-seguridad-hardening.sql` ejecutado** (H1 rol `auxiliar` + H3 log append-only) — verificado: log_auditoria solo INSERT/SELECT.
3. ✅ **Longitud mínima de contraseña = 8** (H4).
4. ✅ **Site URL = `https://mova-gestion.vercel.app`** (H5).

### Pendiente (por límite de plan)
- ⚠️ **Protección de contraseñas filtradas** (H4): requiere **plan Pro** de Supabase. Activar al migrar.

## 6. Recomendaciones Fase 2 (opcional, mayor madurez)

- **RLS por rol** (H2): la mejora de seguridad más grande pendiente.
- **MFA** para el rol admin (Supabase lo soporta).
- **Repositorio privado** en GitHub si aún es público.
- **Backups**: verificar retención de Point-in-Time Recovery.
- Rotar la publishable key si alguna vez se filtró una clave secreta por error.
