# Auditoría administrativa-contable — MOVA Gestión

Análisis con mirada de dirección y contaduría: qué da visibilidad hoy, qué falta para tener control 360°, y en qué orden conviene avanzar.

---

## 1. Resumen ejecutivo

El sistema ya cubre muy bien el **ciclo operativo-comercial**: cliente → presupuesto → obra → avances → costos → cobros → rentabilidad por obra, con seguridad por rol (RLS). 

Lo que falta para una **vista contable/financiera de empresa** (no solo por obra) es: impuestos (IVA), gastos fijos/estructura, flujo de caja proyectado por fecha, antigüedad de saldos (aging), y un estado de resultados por período. Sin eso, la "ganancia" que se ve es **margen por obra**, no la **utilidad neta de la empresa**.

---

## 2. Fortalezas actuales (ya suman a la visión 360)

- Rentabilidad por obra: ingreso (valor actualizado) vs **costo** (productos del presupuesto + gastos registrados), con resultado **proyectado** y **de caja**.
- Finanzas consolida valor actual, cobrado, gastos, ganancia y por cobrar.
- Control de stock valorizado (inversión en stock) y alertas de reposición.
- Personal por obra: acordado / pagado / por pagar + jornales.
- Trazabilidad comercial: estados de presupuesto y de obra, adicionales aprobados.
- Todo vinculado: desde Finanzas se abre la obra; cobros editables/eliminables.

---

## 3. Hallazgos y falencias (por severidad)

**Altas (afectan la exactitud del resultado):**
1. **IVA / impuestos**: los precios no discriminan IVA (débito/crédito). Para una empresa argentina, el resultado real y la liquidación mensual necesitan IVA. *Falta.*
2. **Gastos fijos / de estructura** (alquiler, sueldos fijos, servicios, contador, combustible, herramientas): no se registran. Por eso la ganancia por obra ≠ utilidad de la empresa. *Falta un módulo de gastos generales, no atados a una obra.*
3. **Estado de resultados (P&L) por período** (mes/año): hoy la rentabilidad es por obra. Falta el consolidado por período: ingresos − costos directos − gastos fijos = resultado.
4. **Doble conteo de costo**: el costo del producto sale del presupuesto y, si además se carga una compra del mismo ítem, se duplica. Hoy se evita por convención (documentada); conviene un **control/aviso**.

**Medias (gestión financiera):**
5. **Flujo de caja proyectado**: no hay proyección por fecha (qué entra y sale las próximas semanas según vencimientos). Solo cobrado vs gastos a hoy.
6. **Antigüedad de saldos (aging de cuentas por cobrar)**: falta ver "vencido 0-30 / 30-60 / +60".
7. **Cuentas por pagar a proveedores**: existe "por pagar a ayudantes"; falta el equivalente para proveedores/compras a crédito.
8. **Rotación de inventario / obsolescencia**: hay valor de stock, falta rotación (cuánto se vende y qué queda parado).

**Bajas (control interno / prolijidad):**
9. **Trazabilidad de cambios** (quién creó/modificó y cuándo): no hay log de auditoría.
10. **Facturación electrónica (AFIP)**: no integra numeración/CAE. Los PDF son comerciales, no fiscales.
11. **Conciliación de cobros** por medio de pago (caja/banco).
12. **Inflación / precios históricos**: en ARS conviene guardar el precio al momento de la operación (el presupuesto ya lo hace por ítem; el catálogo se actualiza).

---

## 4. Mejoras propuestas (orden sugerido)

1. **Módulo de Gastos fijos/estructura** + **Estado de resultados mensual** (el salto más grande hacia "utilidad real de la empresa").
2. **IVA**: campo de alícuota en productos y presupuestos, y reporte de IVA débito/crédito.
3. **Flujo de caja proyectado** + **aging de cuentas por cobrar**.
4. **Cuentas por pagar** (proveedores) y conciliación por medio de pago.
5. **Rotación de inventario** y sugerido de compra.
6. **Log de auditoría** (usuario + fecha en cada alta/edición) — clave para control interno.
7. (Opcional) **Facturación electrónica AFIP**.

---

## 5. Dashboards recomendados

El **Home** ya es un tablero básico. Se pueden construir tableros dedicados por indicador, a pedido. Los que un director/contador querría:

- **Tablero financiero**: P&L del mes, flujo de caja proyectado, cuentas por cobrar con aging, ganancia neta real (con gastos fijos).
- **Tablero comercial**: embudo de presupuestos (borrador→enviado→aceptado), **tasa de conversión**, ticket promedio, ranking de productos/servicios.
- **Tablero operativo**: obras por estado, avance vs cobrado, obras "financiando" (avance > cobro), plazos por vencer.
- **Tablero de inventario**: valor de stock, stock bajo, rotación, capital inmovilizado.

> Decime qué indicador necesitás ver y armo el tablero específico (con filtros por fecha/obra/cliente).

---

## 6. Controles internos sugeridos (contador)

- Regla anti-duplicado costo (producto de presupuesto vs compra).
- Cierre mensual: bloquear edición de cobros/gastos de meses cerrados.
- Respaldo: Supabase hace backup automático; definir política de retención.
- Segregación de funciones por rol (ya existe base con RLS): quién cobra ≠ quién concilia.

*Documento vivo. Prioridad recomendada: 1) Gastos fijos + P&L mensual, 2) IVA, 3) Flujo de caja + aging.*
