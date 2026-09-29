# Conectar MOVA Gestión con Tiendanube (www.movaelectronica.com.ar)

La app manda: precio y stock se modifican en MOVA Gestión y se publican solos en la web.
Si algo se vende por la web, se descuenta del stock de la app antes de publicar.

## Puesta en marcha (una sola vez)

1. **SQL** — Supabase → SQL Editor → correr `supabase-tiendanube-fase-19.sql`.
2. **App en Tiendanube**
   - Entrar a https://partners.tiendanube.com con la cuenta de la tienda (si pide, crear la cuenta de socio: es gratis).
   - *Aplicaciones → Crear aplicación* → nombre **MOVA Gestión** (uso propio / para mi tienda).
   - Permisos: **Productos: leer y escribir**.
   - URL de redirección: `https://aceukzftfkjhmponaktd.supabase.co/functions/v1/tiendanube`
   - Guardar y copiar el **ID de la app (client_id)** y el **client_secret**.
3. **Secrets en Supabase** — Edge Functions → Secrets → agregar:
   - `TIENDANUBE_CLIENT_ID` = el ID de la app
   - `TIENDANUBE_CLIENT_SECRET` = el secret
   (No pegarlos en ningún chat ni en el código.)
4. **Función** — Edge Functions → *Deploy a new function* → nombre `tiendanube` → pegar
   `supabase/functions/tiendanube/index.ts` → **desactivar "Verify JWT"** (Tiendanube vuelve a
   esta función sin sesión; la función controla sola quién la usa) → Deploy.
5. **Conectar** — en la app: Configuración → 🛒 Tienda web → **Conectar con Tiendanube** →
   aceptar en Tiendanube → vuelve solo a la app.
6. **Traer productos** — botón **⬇ Traer productos de la web** (vincula por SKU o nombre y crea los que faltan).
7. **Automático** — correr `supabase-cron-tiendanube.sql` reemplazando `<CRON_SECRET>` por el mismo
   valor del secret CRON_SECRET (el de los recordatorios). Sincroniza cada 15 minutos.

## Cómo funciona
- Precio publicado = precio de venta de la app (con su descuento) + IVA (opcional) y redondeado (opcional).
- Productos en dólares: al cambiar la cotización, el precio en pesos cambia y se publica en la siguiente sincronización.
- Stock: si en la web el producto tiene stock ilimitado, no se toca. Servicios: no se sincroniza stock.
- Cada producto tiene el tilde "Sincronizar con la web" en su ficha para excluirlo.
- Historial en Configuración → Tienda web → Últimos movimientos.
