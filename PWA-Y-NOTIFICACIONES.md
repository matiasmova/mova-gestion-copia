# MOVA Gestión — App en el celular, Compartir y Notificaciones

Guía de puesta en marcha de: **app instalable (PWA)**, **botón Compartir presupuesto** y **notificaciones push de recordatorios**.

---

## 1. Qué quedó hecho (en el código)

- **PWA instalable:** manifest, íconos (desde el logo MOVA), service worker y meta tags. La app se puede instalar en el celular con ícono propio y pantalla completa.
- **Compartir presupuesto:** botón **📲 Compartir** en la ficha del presupuesto. Abre el menú nativo del teléfono (WhatsApp, mail, etc.). En computadora, abre WhatsApp Web.
- **Notificaciones push (base):** tabla `push_subscriptions` (ya creada), service worker que recibe los avisos, y en el módulo **Notificaciones** un botón para **activar las notificaciones en el dispositivo**.

Falta solo desplegar el **enviador automático** (Parte 5) para que los recordatorios lleguen solos.

---

## 2. Publicar los cambios

En VS Code: **Commit & Sync**. Vercel reconstruye en ~1-2 min. Recién ahí quedan activos la PWA, el botón Compartir y el service worker en `mova-gestion.vercel.app`.

---

## 3. Instalar la app en el celular (para el cliente)

**iPhone (Safari):**
1. Abrir `https://mova-gestion.vercel.app` en **Safari**.
2. Tocar **Compartir** (el cuadradito con la flecha) → **Agregar a inicio**.
3. Queda el ícono de MOVA en la pantalla. Abrir siempre desde ese ícono.

**Android (Chrome):**
1. Abrir el link en Chrome.
2. Aparece **“Instalar app”** (o menú ⋮ → **Instalar aplicación**).
3. Queda el ícono en el cajón de apps.

> No se descarga nada de ninguna tienda: es un acceso directo que se comporta como app.

---

## 4. Compartir un presupuesto

Abrir el presupuesto → botón **📲 Compartir** → elegir **WhatsApp** (o lo que sea) en el menú del teléfono. Se envía un resumen con código, cliente, total y saldo.

---

## 5. Activar las notificaciones automáticas (una sola vez, técnico)

> ✅ **YA DESPLEGADO Y PROBADO (18/09/2026).** La Edge Function `enviar-recordatorios`
> está desplegada, con sus 3 secrets cargados, Verify JWT desactivado, y el cron
> `enviar-recordatorios` corriendo cada 15 minutos (`*/15 * * * *`, activo).
> Prueba real: se enviaron 2 notificaciones (status 200, `{"enviados":2}`).
> `CRON_SECRET` usado: `mova-cron-a7F3kQ9pL2xN8vR4t`.
> Esta sección queda solo como referencia por si hay que rehacerlo.

Las notificaciones necesitan un “enviador” que corre en Supabase. Pasos:

### 5.1 Claves VAPID
Ya están generadas. La **pública** ya está en el código (`src/push.ts`). La **privada** te la paso por chat — es secreta: va **solo** en los secrets de Supabase, nunca en el código.

### 5.2 Desplegar la Edge Function
Supabase → **Edge Functions** → **Create a new function** → nombre **`enviar-recordatorios`** → pegar el contenido de `supabase/functions/enviar-recordatorios/index.ts` → **Deploy**.
(Alternativa por CLI: `supabase functions deploy enviar-recordatorios --no-verify-jwt`.)

### 5.3 Cargar los secrets
Supabase → **Edge Functions → Secrets** (o Project Settings → Edge Functions) → agregar:
- `VAPID_PUBLIC_KEY` = (la pública, te la paso)
- `VAPID_PRIVATE_KEY` = (la privada, te la paso)
- `CRON_SECRET` = una frase larga inventada por vos (ej. `mova-cron-9f3k2x...`)

### 5.4 Programar el cron
SQL Editor → pegar `supabase-cron-recordatorios.sql`, reemplazar `<CRON_SECRET>` por el mismo valor de arriba → **Run**. Queda enviando cada 15 minutos.

### 5.5 Probar
1. En la app (ya publicada e instalada), ir a **Notificaciones** → activar el switch **“Notificaciones en el teléfono”** y aceptar el permiso.
2. Crear un recordatorio con fecha de hoy.
3. En ≤15 min llega la notificación. (Para probar ya: en Edge Functions, botón **Invoke**/“Run” con el header `x-cron-secret`.)

---

## 6. Cómo activa el cliente las notificaciones

Dentro de la app → módulo **Notificaciones** → switch **“Notificaciones en el teléfono”** → **Permitir**.
En **iPhone** esto solo aparece si la app fue **agregada a inicio** primero (Parte 3) — es requisito de Apple.

---

## Notas
- Web Push no tiene costo. La protección de contraseñas filtradas (aparte) sí requiere plan Pro.
- Si el cliente cambia de teléfono, activa el switch de nuevo en el equipo nuevo.
- Las suscripciones vencidas se limpian solas cuando el enviador detecta que ya no existen.
