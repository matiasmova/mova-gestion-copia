# MOVA Gestión — Instructivo de funcionamiento (end to end)

Cómo está pensado el sistema y qué calcula cada cosa. Guía para el uso diario.

---

## 1. El flujo, de principio a fin

```
CLIENTE  →  PRESUPUESTO  →  (aceptado)  →  OBRA  →  seguimiento  →  COBROS  →  resultado
```

1. **Cliente**: se carga la persona/empresa (datos, ubicación, WhatsApp/email).
2. **Presupuesto**: se arma con productos y servicios del catálogo. Estados: **Borrador → Enviado → Aceptado** (o Rechazado).
3. **Aceptado → Obra**: al pasar el presupuesto a *Aceptado* y guardarlo, aparece la sección para **crear la obra** (dirección, fechas). La obra queda **vinculada** al presupuesto y hereda cliente, título y monto. **Las obras solo nacen así** (no hay “nueva obra” suelta).
4. **Obra en curso**: se cargan avances (Estados), fotos, personal, compras y cobros.
5. **Resultado**: Rentabilidad y Finanzas muestran cuánto deja la obra.

Regla de oro: **el dato se carga una sola vez** en su módulo y el resto lo consolida. No se duplica.

---

## 2. Módulos

### Home
Resumen: clientes, obras activas, presupuestos pendientes, ingresos del mes (filtrable), obras por estado y cuentas por cobrar.

### Clientes
Listado (Lista/Kanban). Al clickear se abre la **ficha CRM**: datos, mapa, KPIs (obras, contratado, cobrado, saldo) y listas relacionadas (obras, presupuestos, cobros) + WhatsApp/email.

### Presupuestos
- Vista **Lista / Kanban** (columnas por estado).
- **Estados**: Borrador, Enviado, Aceptado, Rechazado. El estado **no se aplica solo**: se cambia y se toca **Guardar estado**.
- Al guardar en **Aceptado** → aparece el formulario para **crear la obra**.
- **Descuento** en **$ o %** (bonificación) sobre el subtotal.
- Ficha de detalle con ítems agrupados, cobros, PDF y **Eliminar** definitivo.

### Obras
- Solo las que nacen de un presupuesto aceptado. Vista **Lista / Kanban**.
- **Estados**: En proceso, Finalizada, Finalizada en observación.
- Ficha con pestañas: **Estados · Fotos · Personal · Rentabilidad · Finanzas · Adicionales**.
  - **Estados**: línea de tiempo de avances (con %, fecha, estado). Cada avance es **editable** (por si hubo un error de carga). El % del último avance marca el avance de la obra.
  - **Fotos**: antes/durante/después.
  - **Personal**: trabajadores asignados con **acordado / pagado / por pagar** y jornales.
  - **Rentabilidad**: ver punto 3.
  - **Finanzas**: compras y costos de esa obra.
  - **Adicionales**: ver punto 3.

### Productos y servicios
- Vista Lista/Kanban con **foto**, y **link de compra** (dónde se compra).
- Precios con nombres correctos: **Precio de compra** → **% de ganancia** ↔ **Precio de lista** (se calculan entre sí). El **descuento** (%/$) se aplica sobre el precio de lista.
- **Stock** y **stock mínimo** (umbral de alerta, editable por producto).
- KPIs: **Inversión en stock** (precio de compra × stock), productos activos y **Stock bajo** (clickeable: filtra los que hay que reponer).
- Al cargar un presupuesto, **el stock se descuenta** de los productos usados.

### Compras
Materiales y comprobantes por obra. Se pueden **editar**. Cada compra se refleja automáticamente como gasto en Finanzas.

### Personal
Especialidad y modalidad de pago. Por obra: acordado, pagado (impacta como egreso) y por pagar; más jornales/asistencia.

### Finanzas
Consolida todo: **Valor actual** (presupuestos + adicionales aprobados), **Cobrado**, **Gastos**, **Ganancia neta**, y el desglose de **por cobrar**, **total a ayudantes** y **materiales/varios**.

### Notificaciones
Alertas **dentro de la app** (campana): obras por vencer, saldos por cobrar y recordatorios. *No salen por email todavía* (requiere conectar un servicio de correo).

### Usuarios y Configuración
Roles (admin / encargado / auxiliar / contable) con permisos por módulo. Seguridad real por **RLS** en la base: cada usuario ve y hace solo lo que su rol permite.

---

## 3. Cómo se calcula cada número

**Valor actualizado de una obra**
`= Σ presupuestos aceptados de la obra  +  Σ adicionales APROBADOS`

**Adicionales** (pestaña en la obra): son cambios/extras posteriores al presupuesto (más tomas, un cambio de alcance, una bonificación). Tienen estado **pendiente / aprobado / rechazado** y **solo los aprobados** suman al valor actualizado. Sirve para dejar registro de por qué cambió el monto de la obra.

**Pendiente según avance** (Finanzas): lo que ya podrías cobrar según cuánto avanzó la obra.
`habilitado = valor actualizado × % de avance` · `pendiente s/avance = habilitado − cobrado`.

**Rentabilidad de la obra** (pestaña Rentabilidad):
- **Ingresos**: valor actualizado (proyectado) y cobrado (real).
- **Egresos** = **costo de los productos/servicios del presupuesto** (lo que MOVA paga por los equipos) **+ gastos registrados** (mano de obra, ferretería, varios cargados en Compras/gastos).
- **Resultado proyectado** = valor actualizado − egresos (lo que dejaría si se cobra todo).
- **Resultado de caja** = cobrado − egresos (lo que quedó hoy). *Por eso una obra aceptada con productos, pero sin cobrar aún, da negativo.*
- Tip para no duplicar: en Compras/gastos cargá **lo extra** (ferretería, mano de obra). No vuelvas a cargar los productos del catálogo: su costo ya sale del presupuesto.

**Ganancia neta (Finanzas)** = valor actual − gastos.

**Inversión en stock (Productos)** = Σ (precio de compra × stock) de los productos.

---

## 4. Seguridad y datos
- Base de datos en Supabase con **RLS por rol** en todas las tablas.
- Fotos de storage comprimidas a WebP al subir (ocupan mínimo). Los 25 productos del catálogo referencian la imagen de la tienda (no ocupan storage).
- Las contraseñas/altas de usuarios se gestionan desde Supabase (no desde la app), por seguridad.

*Documento vivo: se actualiza a medida que evoluciona el sistema.*
