export const MANUAL_SISTEMA = `
## Manual del sistema POS
App de escritorio (Tauri) para comercios.

### Pantallas y rutas
- **POS**: cobro. F2 buscar, F3 cliente, F4 vuelto, F5-F9 medios de pago, F10 cobrar, F11 combinado, F12 cobrar+imprimir.
- **Productos**: alta/edición/baja (nombre, código interno único, barras, costo/venta, stock, stock mínimo, unidad, marca, categoría, vencimiento, lote, presentaciones con factor). Vender sin stock: desactivado por defecto. Importar: Productos > Importar (plantilla; crea marcas/categorías/unidades nuevas).
- **Unidades/Marcas/Categorías**: gestión; categorías múltiples si se habilita.
- **Inventario**: stock consolidado con alertas.
- **Compras**: Compras > Nueva > proveedor > productos con cantidad y costo > confirmar ("Actualizar costo" recalcula el costo).
- **Proveedores/Clientes**: padrón; clientes con cuenta corriente y límite de crédito.
- **Caja**: Caja > Abrir Turno (monto inicial) > retiros (admin) > Cerrar Turno (resumen, detecta diferencias).
- **Presupuestos**: cotizaciones con vencimiento, convertibles a venta.
- **Combos**: Combos > Nuevo > nombre, código > componentes con cantidades > precio > Guardar (al vender descuenta stock de componentes).
- **Promociones**: descuentos automáticos en POS (prioridad; condiciones: día, medio de pago, monto mínimo, productos; efectos: %, monto fijo, lleva_x_paga_y, 2da unidad).
- **Recargos**: fijo o % sobre el total.
- **Vencimientos**: alertas 7/15/30/60 días.
- **Informe Financiero**: ventas, compras, gastos, descuentos, recargos, retiros, deuda, neto. Gráficos. Exporta a Excel.
- **Analítica/BI**: Stock y Capital, Ventas y Tendencias, Rentabilidad Pareto, Auditoría, Asistente IA.
- **Usuarios**: admin total / empleado con permisos configurables.
- **Configuración**: módulos, impresora, balanza.
- **Respaldos**: .db.zst, solo servidor.

### Roles y red
- Admin total; empleado limitado configurable. Servidor = PC con la DB (+respaldos); clientes = terminales en red.

### Flujos (rutas exactas para guiar al comerciante)
- **Crear producto**: Productos > Nuevo > nombre, código interno, unidad, precios, stock, alícuota IVA (si IVA activo) > Guardar. O con Binny ("Crear con Binny" o en el chat).
- **Cobrar**: buscar (F2) > método de pago > F10. Cuenta corriente: F3 cliente con crédito habilitado.
- **Anular venta**: venta > Anular > motivo (restaura stock).
- **Presupuesto**: armar carrito en POS > Guardar Presupuesto > imprimir; al aprobarse se convierte en venta.
- **Gasto inmediato**: Gastos > Nuevo > monto, concepto, categoría, medio de pago > Guardar.
- **Gasto programado/recurrente**: Gastos > Nuevo > switch programar > Única vez o Recurrente (diaria, semanal, quincenal, mensual, anual), inicio, automático o con confirmación > Guardar. No afecta caja hasta el vencimiento. Pestaña "Gastos Programados y Recurrentes".
- **Recordatorio**: campana > Nuevo Recordatorio, o pedirle a Binny ("recordame..."). Tono sound_01-05 o silencio.
- **Promoción**: Promociones (admin) > Nuevo > nombre, prioridad, condiciones, efectos > Activar.
- **Usuario**: Usuarios (admin) > Nuevo > usuario, clave, rol (+permisos si empleado).
- **Respaldo**: Respaldos (servidor) > Crear Respaldo > descripción > .db.zst.

### Voz (offline, Configuración > Asistente Binny)
- **Dictado (Whisper)**: mantener el micrófono del chat. Modelos: Tiny ~75MB, Base ~142MB (recomendado), Small ~466MB.
- **Lectura (TTS)**: botón parlante o lectura automática. Motores: Piper (local español ~100MB), Web Speech (nativa), eSpeak NG (liviana).

### Balanza
- EAN-13: dígitos 1-6 precio, 7-12 PLU, 13 verificador. Se parsea al escanear.

### Píldoras proactivas (pantalla Inicio)
- Al arrancar analiza: quiebres inminentes, stock estancado +45 días, gastos próximos vs caja, márgenes en peligro, lotes por vencer. Si preguntan por una píldora: consejos tácticos directos (reposición, combos de liquidación, prioridades de pago, recálculo de precio).

### Módulos (16, en Configuración > Módulos; al desactivar se conservan los datos)
- Catálogo: **Marcas** (usar_marca), **Categorías** (usar_categoria), **Categorías múltiples** (categoria_multiple), **Presentaciones/packs con factor** (usar_presentaciones).
- Operativos: **IVA/ARCA** (usar_iva), **Proveedores+Compras** (usar_proveedor), **Gastos** (usar_gastos), **Clientes+cta.cte.** (usar_clientes), **Presupuestos** (usar_presupuestos), **Combos** (usar_combos), **Promociones** (usar_promociones), **Vencimientos** (usar_vencimientos), **Etiquetas** (usar_etiquetas), **Recargos** (usar_recargos), **Recordatorios** (usar_recordatorios), **Balanza EAN-13** (usar_balanza).
`.trim();
