# Manual de uso — MOVA Gestión

**Sistema de gestión integral para Mova Electrónica**
Clientes · Presupuestos · Obras · Stock · Cobranzas · Contabilidad

> Este manual explica, en lenguaje simple, **qué hace cada parte del sistema, cómo se usa paso a paso, cómo se conectan los datos entre sí y cómo se calcula cada número** que aparece en pantalla. Está pensado para leerse de principio a fin la primera vez, y después como consulta rápida.

---

## Índice

1. Qué es MOVA Gestión
2. Cómo ingresar (login, contraseña y roles)
3. Mapa de la aplicación
4. Cómo se conectan los datos (el circuito completo)
5. Guía módulo por módulo
   - 5.1 Home
   - 5.2 Clientes
   - 5.3 Presupuestos
   - 5.4 Obras
   - 5.5 Productos y servicios
   - 5.6 Compras
   - 5.7 Personal
   - 5.8 Finanzas
   - 5.9 Gastos fijos
   - 5.10 Tablero (Dirección)
   - 5.11 Notificaciones
   - 5.12 Usuarios
   - 5.13 Configuración y Auditoría
6. Cómo se calcula cada valor (glosario de fórmulas)
7. Rutina de trabajo recomendada
8. Preguntas frecuentes
9. Glosario de términos

---

## 1. Qué es MOVA Gestión

Es el sistema central de la empresa. Reemplaza las planillas sueltas y unifica en un solo lugar: los **clientes**, los **presupuestos**, las **obras** (instalaciones de domótica), el **stock** de productos, las **compras** a proveedores, el **personal** (ayudantes), los **cobros y gastos**, y un **tablero de dirección** con la foto contable y financiera del negocio.

La idea de fondo es simple: **cargás la información una sola vez y el sistema la reutiliza en todos lados**. Cuando aceptás un presupuesto, ese mismo dato alimenta la obra, la cobranza, la rentabilidad y el tablero, sin volver a escribir nada.

La aplicación funciona desde el navegador (computadora o celular). Toda la información se guarda de forma segura en la nube.

---

## 2. Cómo ingresar

### Iniciar sesión

1. Abrí el enlace de la aplicación.
2. Ingresá tu **correo electrónico** y tu **contraseña**.
3. Tocá **Ingresar**.

### Si olvidaste la contraseña

1. En la pantalla de ingreso, tocá **¿Olvidaste tu contraseña?**
2. Escribí tu correo y tocá **Enviar enlace**.
3. Revisá tu casilla de correo y seguí el enlace para crear una nueva contraseña.

### Cerrar sesión

Abajo a la izquierda, al lado de tu nombre, está el botón de apagado (⏻). También hay un botón **Cerrar sesión** arriba en el Home.

### Roles: qué ve cada persona

Cada usuario tiene un **rol**, y el rol define qué módulos puede ver. Esto protege la información sensible (nadie ve más de lo que necesita para su tarea).

| Módulo | Administrador | Contable | Encargado | Auxiliar |
|---|:---:|:---:|:---:|:---:|
| Home | ✅ | ✅ | ✅ | ✅ |
| Tablero | ✅ | ✅ | — | — |
| Clientes | ✅ | ✅ | ✅ | — |
| Presupuestos | ✅ | ✅ | — | — |
| Obras | ✅ | ✅ | ✅ | ✅ |
| Productos y servicios | ✅ | ✅ | ✅ | ✅ |
| Compras | ✅ | — | ✅ | ✅ |
| Personal | ✅ | ✅ | ✅ | — |
| Finanzas | ✅ | ✅ | — | — |
| Gastos fijos | ✅ | ✅ | — | — |
| Notificaciones | ✅ | ✅ | ✅ | ✅ |
| Usuarios | ✅ | — | — | — |
| Configuración | ✅ | — | — | — |

En resumen: el **Administrador** ve todo; el **Contable** ve lo comercial, financiero y contable (pero no compras ni la administración de usuarios); el **Encargado** trabaja el día a día operativo (clientes, obras, productos, compras, personal); el **Auxiliar** opera en obra, productos y compras.

---

## 3. Mapa de la aplicación

El menú de la izquierda ordena los módulos según el flujo natural de trabajo:

- **Home** — resumen general del negocio.
- **Tablero** — la mirada de dirección (resultado, caja, cobranzas, inventario).
- **Clientes** — la agenda de clientes.
- **Presupuestos** — cotizaciones a clientes.
- **Obras** — trabajos en ejecución y su seguimiento.
- **Productos y servicios** — el catálogo y el stock.
- **Compras** — lo que le comprás a proveedores.
- **Personal** — ayudantes asignados a obras y sus pagos.
- **Finanzas** — cobros, gastos y resumen por obra.
- **Gastos fijos** — gastos de estructura (alquiler, servicios, etc.).
- **Notificaciones** — avisos del sistema.
- **Usuarios** — alta y roles de las personas que usan el sistema.
- **Configuración** — automatizaciones y registro de auditoría.

---

## 4. Cómo se conectan los datos (el circuito completo)

Este es el concepto más importante del sistema. Todo gira alrededor de un circuito:

```
CLIENTE
   │  (le hago una cotización)
   ▼
PRESUPUESTO ──── usa ───► PRODUCTOS Y SERVICIOS (catálogo)
   │                            │
   │  (cuando lo ACEPTO)        └─ al aceptar, descuenta STOCK
   ▼
OBRA
   ├─ Avances (%) ......... define cuánto puedo facturar
   ├─ Fotos .............. registro visual del trabajo
   ├─ Personal ........... ayudantes + lo que les pago
   ├─ Compras/Gastos ..... materiales, ferretería, mano de obra
   ├─ Adicionales ........ cambios de alcance (+ o −)
   └─ Cobros ............. lo que me paga el cliente
        │
        ▼
FINANZAS  +  TABLERO  ◄──── también suma GASTOS FIJOS (estructura)
   (todo lo anterior se consolida acá, en vivo)
```

En palabras:

- Un **cliente** puede tener uno o varios **presupuestos**.
- Cada presupuesto se arma con ítems del **catálogo de productos y servicios**.
- Cuando un presupuesto se marca como **aceptado**, se habilita crear la **obra** y, al mismo tiempo, **se descuenta el stock** de los productos incluidos.
- La **obra** concentra todo el seguimiento: avances, fotos, personal, compras/gastos, adicionales y cobros.
- Los **cobros** que registrás en la obra bajan el **saldo** del presupuesto (todo sincronizado).
- **Finanzas** y **Tablero** leen todo lo anterior y le suman los **gastos fijos** para mostrarte la rentabilidad y la salud del negocio, sin que tengas que recalcular nada a mano.

**Regla de oro para no duplicar costos:** los productos del catálogo que van en el presupuesto ya aportan su costo automáticamente a la rentabilidad. En **Compras/Gastos** cargá solo lo *extra* (ferretería suelta, mano de obra, fletes), **no** vuelvas a cargar los productos del catálogo.

---

## 5. Guía módulo por módulo

Cada módulo ofrece, según el caso, dos formas de ver la información con el botón **Lista / Kanban** (tablero de tarjetas por estado). Elegí la que te resulte más cómoda; el sistema recuerda tu elección.

### 5.1 Home

Es la pantalla de bienvenida. De un vistazo muestra:

- **Clientes** activos, **Obras activas** (en proceso), **Presupuestos** pendientes e **Ingresos del mes**.
- Un selector **Ver mes** para mirar los ingresos cobrados de cualquier mes.
- **Obras por estado** (barra con en proceso / finalizada / en observación).
- **Obras recientes** y **Cuentas por cobrar** (los saldos pendientes más importantes).
- Una pestaña **📅 Calendario** con las fechas de las obras.

Es solo lectura: sirve para orientarte. Para operar, entrá al módulo correspondiente.

### 5.2 Clientes

La agenda de clientes de la empresa.

**Para dar de alta un cliente:**

1. Entrá a **Clientes** y tocá **+ Nuevo cliente**.
2. Completá nombre, apellido, contacto (teléfono, correo) y dirección/localidad.
3. Guardá. El cliente queda disponible para asociarlo a presupuestos y obras.

Tocando una fila (o tarjeta) se abre la **ficha del cliente** con sus datos y su historial relacionado.

### 5.3 Presupuestos

El corazón comercial. Acá cotizás los trabajos.

**Para crear un presupuesto:**

1. Tocá **+ Nuevo presupuesto**.
2. Elegí el **cliente** y ponele un **título** (ej.: "Automatización living + cocina").
3. Agregá **ítems**: pueden ser productos/servicios del catálogo o líneas manuales. Indicá **cantidad** y **precio unitario**.
4. Si corresponde, aplicá un **descuento**: por **porcentaje (%)** o por **monto fijo ($)**.
5. Guardá. Nace en estado **Borrador**.

**Estados de un presupuesto y qué significan:**

- **Borrador** — lo estás armando, todavía no lo mostraste.
- **Enviado** — se lo pasaste al cliente y estás esperando respuesta.
- **Aceptado** — el cliente dijo que sí. **Este es el estado clave.**
- **Rechazado** — el cliente no avanzó.

**Cómo cambiar el estado (importante):** abrí la ficha del presupuesto, elegí el nuevo estado en el selector y tocá **Guardar estado**. El botón aparece solo cuando cambiaste algo, para evitar cambios accidentales.

**Qué pasa al marcar "Aceptado":**

- Se **descuenta el stock** de los productos del catálogo incluidos (si más tarde lo sacás de "aceptado", el stock se **repone** automáticamente).
- En la ficha aparece un recuadro **"Presupuesto aceptado — creá la obra"**: completás dirección, localidad y fechas, y la obra queda creada y **vinculada**, heredando cliente, título y monto.

**Otras acciones desde la ficha:** **Editar** el presupuesto, generar el **📄 PDF** (para imprimir o enviar) y **Eliminar** (baja definitiva; también libera los cobros asociados).

**Números que vas a ver en la ficha:** Total, Pagado, Saldo, cantidad de Ítems y el desglose **Subtotal → Bonificación → Neto gravado → IVA (21%) → Total**. Cómo se calculan está en la sección 6.

### 5.4 Obras

Es el seguimiento de cada trabajo aceptado. **Las obras no se crean a mano**: nacen al aceptar un presupuesto (así siempre quedan vinculadas y con su monto correcto).

Al abrir una obra vas a encontrar pestañas, en este orden:

**1) Estados (línea de tiempo y avances).**
Registrás el **% de avance** físico de la obra. Cada vez que cargás un avance:
- Queda en la línea de tiempo con su fecha y nota.
- La obra actualiza su **porcentaje** y, según eso, su **estado** (en proceso / finalizada / en observación).
- El avance es lo que **habilita cuánto podés cobrar** (ver Finanzas y sección 6).

**2) Fotos.**
Subís fotos del trabajo (antes/durante/después). Las imágenes se **comprimen automáticamente** antes de guardarse para ocupar el mínimo espacio posible, sin que tengas que hacer nada.

**3) Personal.**
Asignás **ayudantes** a la obra y registrás lo que se les paga (ver 5.7).

**4) Rentabilidad.**
La foto económica de *esa* obra: costo vs. ingreso, resultado proyectado y resultado de caja (ver sección 6).

**5) Finanzas (cobros de la obra).**
Registrás acá mismo si **el cliente pagó**: monto, fecha y medio de pago. Cada cobro baja el saldo del presupuesto y se refleja al instante en Finanzas y en el Tablero. También podés ver y **eliminar** cobros mal cargados.

**6) Adicionales.**
Cambios de alcance una vez arrancada la obra (trabajos extra o quitas). Pueden ser **positivos o negativos**. Cuando un adicional está **aprobado**, se suma (o resta) al valor de la obra.

### 5.5 Productos y servicios

El catálogo y el control de stock.

**Para cargar un producto:**

1. Tocá **+ Nuevo** y completá nombre, tipo (**producto** o **servicio**) y proveedor.
2. Cargá el **precio de compra** (lo que te cuesta) y definí el margen. El sistema calcula en los dos sentidos:
   - Si ponés el **% de ganancia**, calcula el **precio de lista**.
   - Si ponés el **precio de lista**, calcula el **% de ganancia**.
3. Opcional: **descuento** (% o $), **IVA** aplicable (21% / 10,5% / 27% / 0%), **link de compra** del proveedor, **stock** actual y **stock mínimo**.
4. Guardá.

**Stock y reposición:** el sistema marca en rojo los productos con **stock bajo** (cuando el stock es **menor o igual** al mínimo definido; si no definís mínimo, usa 5). El KPI de **stock bajo** es clickeable y filtra la lista para verlos rápido.

**Inversión inmovilizada:** para cada producto podés ver la simulación **inversión = precio de compra × stock**, es decir cuánta plata tenés "dormida" en ese ítem.

> Los productos y servicios (servicios no manejan stock) son los que después elegís al armar presupuestos.

### 5.6 Compras

Lo que le comprás a proveedores (materiales, equipos, ferretería).

**Para registrar una compra:**

1. Tocá **+ Nueva compra**, elegí proveedor y cargá los ítems (cantidad y precio unitario).
2. Indicá si está **Pagada** o **Impaga**, y la **fecha de vencimiento** si es a plazo.
3. Guardá. Podés **editar** una compra o cambiar su estado de pago con el botón **Pagado/Impago**.

Las compras marcadas como **Impagas** alimentan el KPI **Por pagar** (acá y en el Tablero → Cuentas por pagar). Así siempre sabés cuánto le debés a proveedores.

### 5.7 Personal

Los ayudantes y su liquidación, por obra.

- **Asignar un ayudante a una obra:** elegís la persona y el **valor acordado** por el trabajo. Podés **editar** o **quitar** la asignación.
- **Jornales:** registrás pagos/jornadas concretas. Podés eliminar un jornal mal cargado.

Con esto el sistema sabe, por obra, **cuánto acordaste pagar** y **cuánto ya pagaste**, y calcula lo que queda pendiente (ver 6).

### 5.8 Finanzas

La vista financiera transversal a todas las obras. Tiene tres pestañas:

**Resumen por obra.** Una fila por obra con: Valor actualizado, Cobrado, Saldo, Pendiente según avance, % pagado vs. % avance y una **Situación** (OK o ⚠ Financiando). Arriba, los KPIs globales: **Valor actual**, **Cobrado**, **Gastos** y **Ganancia neta**. Tocando una obra vas directo a su ficha.

**Cobros.** El listado de todos los cobros. Podés **registrar**, **editar** y **eliminar** cobros. Al registrar, el sistema no te deja cobrar **más que el saldo** del presupuesto.

**Gastos.** El listado de gastos por obra (material, mano de obra, terciarizado, otro), con su categoría y detalle. Desde acá se registran los gastos directos de obra.

La alerta **⚠ Financiando** te avisa cuando el avance de la obra le sacó **25 puntos o más** de ventaja a lo cobrado: estás poniendo plata de tu bolsillo para avanzar. Es la señal para salir a cobrar.

### 5.9 Gastos fijos

Los gastos de **estructura** que no son de una obra puntual: alquiler, servicios, sueldos fijos, contador, seguros, etc.

1. Tocá **+ Nuevo gasto**, elegí **categoría**, cargá **monto** y **fecha**.
2. Guardá. Podés filtrar por mes y ver KPIs del período.

Estos gastos son clave: son los que el **Tablero** resta para calcular el **resultado neto real** de la empresa (no alcanza con mirar solo las obras).

### 5.10 Tablero (Dirección)

La mirada gerencial y contable. Arriba, un selector de **Mes** aplica a todo. Tiene cinco pestañas:

**Resumen.** La foto del mes: Resultado del mes, Ingresos cobrados, Por cobrar y Por pagar, más bloques Comercial (conversión, ticket promedio, presupuestos por estado), Operativo (obras en proceso, costos y gastos del mes) e Inventario (valor de stock, stock bajo).

**Resultado (P&L).** El estado de resultados: Ingresos − Costos directos − Gastos fijos = **Resultado neto**. Muestra los **últimos 6 meses** en una tabla con barras. **Tocá cualquier mes para llevarte a ese período** y ver su detalle. Incluye una estimación de la **posición de IVA** al 21%.

**Caja & Cobranzas.** El **aging** (antigüedad) de lo que te deben: 0-30 / 31-60 / 61-90 / +90 días. **Tocá una fila** y se despliega el detalle de **qué clientes y presupuestos** están en esa antigüedad, ordenados por saldo. Lo vencido **+90** es la alerta principal.

**Cuentas por pagar.** Lo que la empresa debe: **Proveedores** (compras impagas) + **Ayudantes/Personal** (lo acordado menos lo pagado).

**Inventario.** Rotación del stock: por producto muestra stock, unidades vendidas, **rotación** y una **clasificación** (Alta / Media / Baja / Sin movimiento / Agotado), más el **capital inmovilizado**. Los KPIs **Sin movimiento** y **A reponer** son **botones**: tocalos para filtrar la tabla. El **capital dormido** te dice cuánta plata está atada a productos que no rotan.

**Notas de las pestañas del Tablero:** los textos de ayuda al pie de cada pestaña explican, en la propia pantalla, cómo leer cada indicador.

### 5.11 Notificaciones

Avisos del sistema (por ejemplo, plazos de obra próximos a vencer). Es un centro de mensajes para no perder de vista lo urgente.

### 5.12 Usuarios

Solo para el **Administrador**. Acá se dan de alta las personas que usan el sistema y se les asigna su **rol** (Administrador, Contable, Encargado o Auxiliar), que define qué módulos ven (tabla de la sección 2).

### 5.13 Configuración y Auditoría

Solo para el **Administrador**. Dos partes:

- **Automatizaciones:** interruptores para funciones como alertas de plazos, backups, y futuras integraciones (captura de facturas, OCR, PDF automático, georreferenciación).
- **Auditoría:** un registro automático de **quién creó, editó o eliminó** cada dato y **cuándo**. Se llena solo, a partir de cada movimiento, y sirve para control interno y trazabilidad. Muestra fecha, usuario, acción (Alta/Edición/Baja), módulo y registro afectado.

---

## 6. Cómo se calcula cada valor (glosario de fórmulas)

Esta sección detalla, número por número, de dónde sale cada valor. Todos los montos se muestran en **pesos argentinos con dos decimales**.

### 6.1 Presupuesto

| Valor | Cómo se calcula |
|---|---|
| **Subtotal** | Suma de (cantidad × precio unitario) de todos los ítems. |
| **Bonificación / Descuento** | Lo que se resta, sea un **%** del subtotal o un **monto fijo**. |
| **Total** | Subtotal − Descuento. Incluye IVA. |
| **Neto gravado** | Total ÷ 1,21 (la base sin IVA, asumiendo 21%). |
| **IVA (21%) contenido** | Total − (Total ÷ 1,21). |
| **Pagado** | Suma de todos los cobros vinculados a ese presupuesto. |
| **Saldo** | Total − Pagado. Es lo que falta cobrar. |

### 6.2 Productos y servicios

| Valor | Cómo se calcula |
|---|---|
| **Precio de compra** | El costo del producto (lo cargás vos). |
| **Precio de lista** | Precio de compra × (1 + % de ganancia ÷ 100). |
| **% de ganancia** | (Precio de lista ÷ Precio de compra − 1) × 100. Es bidireccional: cambiás uno y se recalcula el otro. |
| **Inversión inmovilizada** | Precio de compra × stock actual. |
| **Stock bajo** | Se marca cuando el stock es **≤** al stock mínimo (por defecto 5). |

### 6.3 Finanzas — Resumen por obra

| Valor | Cómo se calcula |
|---|---|
| **Valor actualizado** | Total de presupuestos aceptados de la obra + adicionales aprobados (los adicionales pueden ser negativos). |
| **Cobrado** | Suma de todos los cobros de la obra. |
| **Saldo** | Valor actualizado − Cobrado (nunca negativo). |
| **Habilitado por avance** | Valor actualizado × (% de avance ÷ 100). Es lo que "corresponde" cobrar según el trabajo hecho. |
| **Pendiente según avance** | Habilitado por avance − Cobrado (nunca negativo). |
| **% pagado** | Cobrado ÷ Valor actualizado × 100 (tope 100%). |
| **Situación "⚠ Financiando"** | Aparece cuando (% de avance − % pagado) ≥ 25. |
| **Ganancia neta (global)** | Valor actualizado total − Gastos totales. |

### 6.4 Rentabilidad de la obra

| Valor | Cómo se calcula |
|---|---|
| **Ingreso: Presupuestos aceptados** | Suma del total de los presupuestos aceptados de la obra. |
| **Ingreso: Adicionales aprobados** | Suma de adicionales aprobados (+/−). |
| **Valor actualizado** | Presupuestos aceptados + Adicionales aprobados. |
| **Cobrado a la fecha** | Suma de los cobros de la obra. |
| **Costo de productos/servicios** | Suma de (cantidad × costo unitario) de los ítems del presupuesto aceptado. Es lo que MOVA paga por los equipos. |
| **Costos registrados** | Gastos cargados en la obra (materiales sueltos, mano de obra, terciarizados, otros). |
| **Costo total (egresos)** | Costo de productos/servicios + Costos registrados. |
| **Resultado proyectado** | Valor actualizado − Costo total. Supone cobrar **todo** lo contratado. |
| **Resultado de caja** | Cobrado a la fecha − Costo total. Es lo que quedó **hoy** (una obra aceptada y aún no cobrada da negativo, y es correcto). |
| **Margen proyectado** | Resultado proyectado ÷ Valor actualizado × 100. |
| **Personal: por pagar** | Acordado (asignaciones) − Pagado (gastos de mano de obra/terciarizado), nunca negativo. |

### 6.5 Tablero — Resultado (P&L) del mes

| Valor | Cómo se calcula |
|---|---|
| **Ingresos** | Suma de los cobros con fecha en el mes seleccionado (criterio de caja: lo efectivamente cobrado). |
| **Costos directos** | Suma de los gastos de obra con fecha en el mes. |
| **Gastos fijos** | Suma de los gastos de estructura con fecha en el mes. |
| **Resultado neto** | Ingresos − Costos directos − Gastos fijos. La utilidad real del mes. |
| **IVA débito (estimado)** | Ingresos − (Ingresos ÷ 1,21). |
| **IVA crédito (estimado)** | Costos directos − (Costos directos ÷ 1,21). |
| **Posición de IVA (aprox.)** | IVA débito − IVA crédito. Es una estimación al 21%; para la liquidación exacta se usan los comprobantes reales. |

### 6.6 Tablero — Caja & Cobranzas (aging)

Se toman **solo los presupuestos aceptados con saldo pendiente**. Para cada uno:

- **Antigüedad (días)** = hoy − fecha del presupuesto.
- Se ubica en un tramo: **0-30**, **31-60**, **61-90** o **+90** días.
- Cada tramo **suma los saldos** de los presupuestos que caen ahí.
- **% del total** = saldo del tramo ÷ saldo total por cobrar × 100.
- El **detalle** de un tramo (al tocarlo) lista cliente, presupuesto, días y saldo, ordenado de mayor a menor.

### 6.7 Tablero — Cuentas por pagar

| Valor | Cómo se calcula |
|---|---|
| **Proveedores** | Suma de (cantidad × precio unitario) de las compras marcadas como **impagas**. |
| **Ayudantes / Personal** | Total acordado en asignaciones − Total pagado en mano de obra/terciarizado (nunca negativo). |
| **Total por pagar** | Proveedores + Ayudantes/Personal. |

### 6.8 Tablero — Inventario (rotación)

Se consideran **solo los productos** (no servicios) activos. Para cada producto:

- **Vendidas** = unidades de ese producto incluidas en **presupuestos aceptados** (histórico).
- **Capital inmovilizado** = costo unitario × stock actual.
- **Rotación** = Vendidas ÷ stock actual (si no hay stock pero hubo ventas, se considera rotación máxima).
- **Clasificación:**
  - **Agotado** — stock 0 pero se vendió.
  - **Sin movimiento** — nunca se vendió.
  - **Alta** — rotación ≥ 3.
  - **Media** — rotación entre 1 y 3.
  - **Baja** — rotación menor a 1.
- **Valor de stock** = suma de todos los capitales inmovilizados.
- **Capital dormido** = capital inmovilizado de los productos "sin movimiento" o de "baja" rotación.
- **A reponer** = productos con stock ≤ stock mínimo.

### 6.9 Tablero — Indicadores comerciales

| Valor | Cómo se calcula |
|---|---|
| **Tasa de conversión** | Presupuestos aceptados ÷ (aceptados + rechazados) × 100. |
| **Ticket promedio** | Promedio del total de los presupuestos aceptados. |
| **Por cobrar** | Suma de los saldos de todos los presupuestos aceptados. |
| **Obras en proceso** | Cantidad de obras activas en estado "en proceso". |

---

## 7. Rutina de trabajo recomendada

**Cada día:**
- Registrar los **cobros** que entraron (en la obra o en Finanzas).
- Marcar como **pagadas** las compras que se abonaron.
- Cargar **avances** de las obras que progresaron.

**Cada semana:**
- Revisar **Finanzas → Resumen por obra** y prestar atención a las obras **⚠ Financiando** (salir a cobrar).
- Revisar **Tablero → Caja & Cobranzas**, sobre todo el tramo **+90 días**.
- Controlar **stock bajo** en Productos y el sugerido de reposición del Tablero.

**Cada mes:**
- Cargar los **gastos fijos** del período.
- Mirar el **Tablero → Resultado (P&L)** para ver el resultado neto del mes y la tendencia de 6 meses.
- Revisar el **capital dormido** en Inventario (qué liquidar o dejar de reponer).

---

## 8. Preguntas frecuentes

**Acepté un presupuesto pero no descontó stock.**
El descuento de stock ocurre al pasar a **Aceptado** con los productos del **catálogo** cargados como ítems. Las líneas manuales (que no son del catálogo) no afectan stock.

**Registré un cobro y el saldo no cambió.**
El cobro tiene que estar vinculado al **presupuesto** (o a la obra correcta). Verificá que elegiste el presupuesto al registrarlo.

**La rentabilidad de una obra aceptada me da negativa.**
Es normal si todavía **no cobraste**. El **resultado de caja** es "cobrado − costos"; mirá el **resultado proyectado** para ver la utilidad esperada al cobrar todo.

**No veo un módulo que otra persona sí ve.**
Depende de tu **rol** (sección 2). Pedile al Administrador que ajuste tu rol si necesitás acceso.

**¿Los números del Tablero se actualizan solos?**
Sí. Todo lo que cargás en los módulos se refleja en Finanzas y en el Tablero en vivo; no hay que recalcular ni exportar nada.

**¿Por qué la posición de IVA es "aproximada"?**
Se estima al 21% sobre lo cobrado y los costos. Para la liquidación exacta se usan los comprobantes con su IVA real (algunos productos tienen alícuotas distintas).

---

## 9. Glosario de términos

- **Presupuesto aceptado:** cotización que el cliente aprobó. Habilita la obra y descuenta stock.
- **Valor actualizado:** el monto vigente de una obra = presupuestos aceptados + adicionales aprobados.
- **Saldo:** lo que falta cobrar (Total − Pagado).
- **Avance:** porcentaje de trabajo físico realizado en una obra.
- **Pendiente según avance:** lo que ya se podría haber cobrado según el avance, y todavía no se cobró.
- **Financiando:** la obra avanzó mucho más de lo que se cobró; la empresa está poniendo capital.
- **Resultado proyectado:** utilidad esperada si se cobra todo lo contratado.
- **Resultado de caja:** utilidad real a hoy (cobrado − costos).
- **Aging / antigüedad:** cuántos días hace que se debe un saldo.
- **Capital inmovilizado / dormido:** plata invertida en stock, especialmente el que no rota.
- **Rotación:** cuántas veces se vendió el stock de un producto.
- **Gastos fijos:** costos de estructura, no atribuibles a una obra puntual.
- **Auditoría:** registro automático de quién hizo cada cambio y cuándo.

---

*MOVA Gestión — Espacios Inteligentes. Manual de uso para el cliente.*
