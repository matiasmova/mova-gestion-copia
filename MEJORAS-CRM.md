# MOVA Gestión — Análisis profundo y mejoras nivel CRM

Documento de trabajo. Estado a la fecha y hoja de ruta para llevar la app de "gestión de obras"
a un **CRM operativo de domótica** (ventas → obra → cobranza → post-venta).

---

## 1. Qué ya quedó funcionando

- **Clientes** con ubicación georreferenciada (lat/lng + mapa + "usar mi ubicación").
- **Obras** con avance, ficha, y **Informe de fin de obra** en PDF (trabajos realizados, equipos, formas de uso, garantía, firma).
- **Presupuestos** con ítems, estados y **PDF profesional** (descuento en $ y %, logo, contacto).
- **Productos/servicios** con stock, foto, costo, % ganancia, descuento y **simulación de precio**.
- **Finanzas**: cobros a **obra** y a presupuesto, gastos por categoría, comparativa pagado vs. avance.
- **Dashboard** con **filtro por mes** (ingresos y cobros del mes elegido).
- **Calendario** de recordatorios en el dashboard.
- **Usuarios y roles** (admin/encargado/auxiliar/contable) + **seguridad RLS** (la clave pública ya no accede a los datos).

---

## 2. Notificaciones: cómo funciona hoy y cómo hacerlo "real"

**Hoy:** el módulo Notificaciones solo **muestra** las filas de la tabla `notificaciones` y permite marcarlas
como leídas. Está vacío porque **nada las genera todavía**. Es un "buzón" sin cartero.

**Cómo darle vida (3 caminos, de menor a mayor esfuerzo):**

1. **Generación al abrir la app (rápido, sin backend).** Al cargar el dashboard, la app calcula alertas
   en vivo: obras próximas a vencer (`fecha_fin_estimada` cercana), saldos por cobrar, recordatorios de hoy.
   Se muestran como notificaciones sin depender de un proceso externo. Es lo que conviene primero.
2. **Trigger en la base (medio).** Un `trigger` en Postgres que, por ejemplo, al cambiar una obra a
   "Finalizada" inserte una notificación "generar informe / cobrar saldo".
3. **Job programado con pg_cron (completo).** Una tarea diaria en Supabase que recorre obras y recordatorios
   e inserta notificaciones (vencimientos, post-obra a 90 días, saldos). Es la versión "automática de verdad".

**Recomendación:** empezar por el punto 1 (alertas en vivo) y sumar pg_cron cuando el volumen lo justifique.

---

## 3. Emails al cliente (avisos, presupuestos, fin de obra)

Sí, se puede. Con la clave pública **no** se pueden mandar mails automáticos (haría falta la `service_role`,
que nunca va en el frontend). Dos niveles:

- **Nivel 1 — Rápido, sin costo (mailto / WhatsApp).** Botones "Enviar por email" que abren el correo del
  usuario con el mensaje ya armado (asunto + cuerpo), o "Enviar por WhatsApp" con `wa.me`. Sirve para
  presupuestos, aviso de visita y fin de obra **hoy mismo**. La persona solo aprieta "enviar".
- **Nivel 2 — Automático (Edge Function + proveedor de email).** Una **Supabase Edge Function** con un
  proveedor como **Resend** (tiene plan gratis) envía el email de forma automática:
  - Presupuesto enviado → mail al cliente con el PDF.
  - Recordatorio de visita → mail el día anterior.
  - Fin de obra → mail con el informe.
  Requiere: cuenta en el proveedor, la Edge Function y (para automáticos) pg_cron.

**Recomendación:** Nivel 1 para arrancar ya; Nivel 2 cuando quieras automatizar. Para PDFs por mail, el
Nivel 2 es el camino correcto.

---

## 4. Panel de Obra — rediseño (benchmark de mercado)

Investigué apps líderes de gestión de obra / field service: **Procore** y **Buildertrend** (construcción),
**Fieldwire** (tareas y planos en obra), **Jobber** y **Housecall Pro** (servicios a domicilio), y **monday**
(tablero general). El patrón común: la obra es un **expediente con pestañas**, no una tarjeta plana.

**Propuesta para MOVA — Ficha de obra con pestañas:**

- **Resumen:** cliente, dirección + mapa, estado, % de avance, fechas, y mini-resumen financiero (presupuesto, cobrado, saldo).
- **Bitácora / Avances:** línea de tiempo con fecha, descripción y **fotos** (antes/durante/después). Cada avance sube el %.
- **Checklist de tareas:** lista de tareas de la obra con responsable y estado (pendiente/haciendo/hecho) → alimenta el % de avance automáticamente.
- **Materiales y equipos:** lo instalado en la obra (con enlace al stock de productos).
- **Finanzas de la obra:** presupuesto, cobros, gastos y saldo, todo de esa obra.
- **Documentos:** planos, manuales, comprobantes.
- **Personal asignado:** quién trabaja en la obra y su costo de mano de obra.

Extras de nivel: estados de obra tipo *pipeline* (Relevamiento → Presupuestado → En ejecución → Entregada →
Post-venta), y un botón directo a **Informe de fin de obra** (ya lo tenés) y a **cobro**.

---

## 5. Mejoras nivel CRM (lo que lleva la app al siguiente nivel)

Un CRM de domótica no es solo obras: es **relación con el cliente de punta a punta**.

1. **Pipeline de ventas / leads.** Antes de la obra hay un prospecto. Estados: Nuevo → Contactado →
   Presupuestado → Ganado/Perdido. Tablero tipo kanban. Hoy salteás del cliente directo a la obra.
2. **Historial de interacciones por cliente.** Registrar llamadas, visitas, mensajes, presupuestos enviados.
   Que al abrir un cliente veas toda su historia (timeline). Es el corazón de un CRM.
3. **Seguimiento post-obra.** Recordatorio automático a 30/90 días para mantenimiento o ampliaciones
   (venta recurrente). La domótica se amplía con el tiempo: ahí está el negocio repetido.
4. **Recordatorios automáticos** (vencimientos, cobros, post-obra) → notificaciones + email.
5. **Reportes / tablero gerencial.** Ingresos por mes, obras por estado, ranking de clientes, margen por
   obra, cobranzas proyectadas. Ya empezamos con el filtro por mes.
6. **Datos por cliente:** además de ubicación, guardar la **app que usa** (Tuya/Sonoff), equipos instalados,
   y notas técnicas → soporte más rápido.
7. **Automatizaciones** (Telegram/N8N para facturas, geocodificación automática, PDF por mail).

---

## 6. Roadmap sugerido (por el mismo camino, en fases cortas)

**Fase A — Cerrar lo pedido (casi listo):** informe en obra ✅, instagram/PDF ✅, filtro de mes ✅.
Falta pulir el **panel de obra con pestañas** (sección 4).

**Fase B — Comunicación:** botones "Enviar por email/WhatsApp" (Nivel 1) en presupuesto, aviso de visita y
fin de obra. Notificaciones "en vivo" en el dashboard (sección 2, punto 1).

**Fase C — CRM:** historial de interacciones por cliente + seguimiento post-obra + pipeline de leads.

**Fase D — Automático:** Edge Function + Resend para emails, pg_cron para recordatorios, Telegram/N8N para facturas.

**Transversal — Seguridad:** ya está el RLS base. Próximo nivel: reglas por rol a nivel fila (ej. el
auxiliar ve solo sus obras asignadas) y revisión de políticas de Storage.

---

*Este documento se actualiza a medida que avanzamos.*
