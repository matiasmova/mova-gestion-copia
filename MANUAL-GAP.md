# Validación: Manual de Funciones vs. App actual — MOVA Gestión

Comparación punto por punto del "Manual de Funciones" contra lo que la app **ya tiene hoy**.
Leyenda: ✅ hecho · ⚠️ parcial · ❌ falta.

---

## Resumen por sección

| # | Sección del manual | Estado | Qué falta / nota |
|---|---|---|---|
| 2 | **Clientes** (datos + ficha con obras/presupuestos/pagos/saldo) | ✅ | Falta campo **WhatsApp** aparte y "Documentación". La **ficha de cliente** (estilo CRM) ya está y muestra obras, presupuestos, cobros, saldo. |
| 3 | **Presupuestos** (elegir cliente → datos → ítems → estados) | ⚠️ | Existe con ítems y PDF. **Falta**: estados Borrador/Enviado/Aceptado (hoy pendiente/aceptado/rechazado) y **convertir Aceptado → Obra automáticamente** conservando el original. |
| 4 | **Obras** (nace del presupuesto, hereda datos) + estado obra + **estado financiero** separado | ⚠️ | Existen obras y estados. **Falta**: herencia automática desde presupuesto, estados Planificación/En proceso/Finalizada, y **estado financiero** (Sin cobrar/Parcial/Cobrado) como campo aparte. |
| 5 | **Avances** (timeline, %, fotos) + **importe habilitado para cobrar** + personal involucrado | ⚠️ | Timeline, %, fotos y descripción ✅. **Falta**: importe habilitado por avance, personal por avance, adicionales por avance. |
| 6 | **Control económico** (valor original + adicionales = actualizado; habilitado/pendiente según avance; resultado) | ⚠️ | Hay contratado/cobrado/saldo y comparativa pagado-vs-avance. **Falta**: adicionales, "valor actualizado", "pendiente según avance" en $, y resultado con personal. |
| 7 | **Modificaciones y Adicionales** (historial, estados, solo aprobados afectan) | ❌ | **No existe.** Módulo nuevo (tabla `adicionales`). Es de lo más importante que falta. |
| 8 | **Cobros** (vinculados a obra, concepto, avance relacionado) | ⚠️ | Cobros a obra ✅ (ya se puede cobrar a la obra con/sin presupuesto). **Falta**: campo concepto y "avance relacionado". |
| 9 | **Personal** (especialidad, modalidad por obra/día/%/etapa, valor acordado) | ⚠️ | Existe con costo hora/día y asignaciones. **Falta**: especialidad, modalidad de pago, valor acordado. |
| 10 | **Personal por obra** (acordado/pagado/pendiente por trabajador) | ⚠️ | Hay asignaciones y costos de mano de obra. **Falta**: seguimiento acordado/pagado/pendiente por trabajador. |
| 11 | **Asistencia / Jornales** (días trabajados) | ❌ | **No existe.** Módulo nuevo (tabla `jornales`). |
| 12 | **Compras y Gastos** (vinculadas a obra + categorías) | ✅/⚠️ | Existe compras/comprobantes + gastos por categoría. Revisar que las **categorías** sean las del manual (eléctrico, domótica, redes, etc.). |
| 13 | **Rentabilidad por obra** (ingresos − egresos; proyectado vs flujo real) | ⚠️ | Hay economía por obra. **Falta**: integrar personal como egreso y separar **resultado proyectado vs flujo real**. |
| 14 | **Tarjeta de obra** (resumen económico + accesos directos) | ⚠️ | La tarjeta tiene cliente/estado/avance. **Falta**: resumen económico en la tarjeta (valor actualizado, cobrado, pendiente) y botones de acceso directo. |
| 15 | **Finanzas** (consolida ingresos/egresos/cuentas por cobrar) | ⚠️ | Existe con resumen/cobros/gastos. **Falta**: valor actualizado y "pendiente según avance" en cuentas por cobrar. |
| 16 | **Documentos PDF** (Presupuesto, Resumen de pagos, Resumen de obra) | ⚠️ | Presupuesto PDF ✅ e Informe de fin de obra ✅. **Falta**: **Resumen de pagos PDF**. |
| 17-18 | **No duplicar + flujo** | ✅ | La arquitectura ya sigue el principio: los datos viven en cada módulo y Finanzas/ficha los consolidan. |

---

## Lo que ya tenés (y que el manual no pedía o está resuelto mejor)

- **Ficha de cliente estilo CRM** con listas relacionadas (obras, presupuestos, cobros) y botones WhatsApp/Email.
- **Seguridad real (RLS por rol)** — el manual no lo menciona y es clave.
- **Usuarios y roles** (admin/encargado/auxiliar/contable).
- **Productos con stock, costo, % ganancia, descuento y simulación de precio**.
- **Calendario de recordatorios** y **notificaciones automáticas** (plazos, saldos).
- **Presupuesto PDF profesional** con descuento en $ y %.
- **Georreferencia** de clientes y obras con mapa.

---

## Gaps principales (lo que hay que construir)

1. **Presupuesto Aceptado → crear Obra automáticamente** (heredando datos) y conservar el presupuesto original como historial. *(base del flujo del manual)*
2. **Adicionales / Modificaciones** con estados (Pendiente/Aprobado/Rechazado); solo los aprobados suman al **valor actualizado**. *(módulo nuevo)*
3. **Economía por avance**: valor actualizado, importe habilitado según avance, **pendiente según avance**, pendiente total, y **estado financiero** de la obra.
4. **Rentabilidad por obra**: ingresos − (compras + personal + otros), con **resultado proyectado vs flujo real**.
5. **Jornales / asistencia** y **personal por obra** con modalidad y acordado/pagado/pendiente.
6. **Tarjeta de obra** enriquecida (resumen económico + accesos directos).
7. **Resumen de pagos PDF**.
8. Menores: **WhatsApp** en cliente, **concepto/avance** en cobros, categorías de compras del manual, estados con la nomenclatura del manual.

---

## Roadmap sugerido (por fases; agrupado por cambios de base)

**Fase 1 — Economía por avance (rápida, casi todo front):**
"Pendiente según avance", "habilitado según avance" y estado financiero en Finanzas y en la tarjeta de obra. Responde 3 de las 5 preguntas finales sin tocar mucho la base. + WhatsApp en cliente.

**Fase 2 — Presupuesto → Obra + Adicionales:**
Botón "Convertir en obra" al aceptar; tabla `adicionales` con estados; "valor actualizado" = presupuesto + adicionales aprobados. Es el corazón del manual.

**Fase 3 — Personal y jornales:**
Modalidad de pago, personal por obra (acordado/pagado/pendiente), tabla `jornales`, y que los pagos de personal impacten como egreso de obra.

**Fase 4 — Rentabilidad y documentos:**
Rentabilidad por obra (proyectado vs real), tarjeta de obra con accesos directos, y **Resumen de pagos PDF** + Resumen de obra PDF.

**Objetivo final** (las 5 preguntas por obra): qué se contrató · cuánto avanzamos · cuánto cobramos/falta · cuánto gastamos · cuánto deja. Con las Fases 1-4 quedan las cinco respondidas.

*Documento vivo; se actualiza a medida que avanzamos.*

---

## ✅ Cierre Fases 2 · 3 · 4 (implementado)

**Fase 2 — Presupuesto→Obra + Adicionales**
- Botón **🏗️ Crear obra** en presupuestos aceptados (hereda cliente/título/descr. y conserva el presupuesto vinculado).
- Módulo **Adicionales** (pestaña ➕ en la obra) con estados pendiente/aprobado/rechazado; solo aprobados suman.
- **Valor actualizado** (presupuesto + adicionales aprobados) en Finanzas y en la obra. *(tabla `adicionales`)*

**Fase 3 — Personal y jornales**
- Personal con **especialidad** y **modalidad de pago**.
- Pestaña **👷 Personal** en la obra: acordado / pagado / pendiente por trabajador; asignar persona (modalidad + valor acordado); **registrar pago** (impacta como egreso) y **registrar jornal**. *(cols. en `obra_asignaciones` + `personal`; tabla `jornales`)*

**Fase 4 — Rentabilidad y documentos**
- Pestaña **📊 Rentabilidad**: ingresos (valor actualizado / cobrado) vs egresos (compras + mano de obra + otros), **resultado proyectado vs de caja** y margen %.
- **Tarjeta de obra** con resumen económico (valor / cobrado / pendiente) + accesos directos.
- **🧾 Resumen de pagos PDF** por obra (valor, cobrado, saldo + detalle de cobros).

**Las 5 preguntas por obra quedan respondidas:** qué se contrató (actualizado) · cuánto avanzamos · cuánto cobramos/falta · cuánto gastamos · cuánto deja.

*Pendientes menores (opcionales):* WhatsApp aparte en cliente, concepto/avance en cobros, email automático (Edge Function + Resend), Resumen de obra PDF ampliado (hoy cubierto por el Informe de fin de obra).
