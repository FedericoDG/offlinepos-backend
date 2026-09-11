export const MANUAL_SISTEMA = `
## Manual del sistema POS

Aplicacion de escritorio (Tauri) para gestion de comercios.

### Pantallas
- **POS**: pantalla de cobro. Atajos: F2 buscador productos, F3 cliente, F4 vuelto, F5-F9 metodos de pago, F10 cobrar, F11 pago combinado, F12 cobrar+imprimir.
- **Productos**: alta/edicion/baja. Cada uno tiene: nombre, codigo interno (unico), codigo barras, precio costo/venta, stock, stock minimo, unidad, marca, categoria, vencimiento, lote, presentaciones de compra (bultos/packs con factor de conversion). Vender sin stock desactivado por defecto.
- **Unidades/Marcas/Categorias**: gestion de cada una. Categorias pueden ser multiples si se habilita.
- **Inventario**: vista consolidada de stock con alertas.
- **Compras**: registro a proveedores, genera movimiento stock y puede actualizar costo.
- **Proveedores**: gestion de distribuidores.
- **Gastos**: gestión y planificación de egresos operativos por categoría (Servicios, Alquileres, Sueldos, Impuestos, Insumos, Mantenimiento, Fletes, Marketing, Otros). Posee dos pestañas: **Gastos Registrados** (egresos ya devengados y ocurridos) y **Gastos Programados y Recurrentes** (compromisos futuros o periódicos como alquileres, sueldos y servicios). Permite distinguir gastos automáticos de boletas variables que requieren confirmación de importe, con badges visuales (Recurrente en violeta, Programado en azul) y filtro por origen (Manual, Programado única vez, Recurrente). Se anulan pero no eliminan físicamente.
- **Clientes**: registro. Puede habilitar cuenta corriente con limite de credito.
- **Caja**: apertura/cierre de turnos. Retiros con autorizacion. Reporte por turno.
- **Presupuestos**: cotizaciones convertibles a venta. Tienen vencimiento.
- **Combos**: agrupaciones con precio especial. Al vender, descuenta componentes del stock.
- **Promociones**: descuentos automaticos al cobrar en POS.
- **Recargos**: adicionales por metodo de pago o categoria.
- **Vencimientos**: control de fechas con alertas (vencido, 7d, 15d, 30d, 60d).
- **Informe Financiero**: resumen de ventas, compras, gastos, descuentos, recargos, retiros, deuda clientes, resultado neto. Graficos. Exportable a Excel.
- **Analitica/BI**: 5 pestanas (Stock y Capital, Ventas y Tendencias, Rentabilidad Pareto, Auditoria, Asistente IA).
- **Usuarios**: roles admin/empleado con permisos granulares.
- **Configuracion**: modulos activos (Catalogo, Impuestos y Facturacion con IVA y alicuotas AFIP, etc.), impresora, balanza.
- **Respaldos**: copias comprimidas (.db.zst), solo modo servidor.
- **Asistente**: este chat.

### Roles
- **Admin**: acceso total.
- **Empleado**: permisos limitados, configurable individualmente.

### Modo servidor/cliente
Servidor = PC principal con la DB. Clientes = terminales conectadas por red. Respaldos solo en servidor.

### Promociones
Cada promocion tiene prioridad, condiciones (dia semana, metodo pago, monto minimo, productos) y efectos (porcentaje, monto fijo, lleva_x_paga_y, segunda unidad). Se aplican automaticamente al cobrar.

### Recargos
Fijo (monto) o Porcentaje. Se aplican al total de la venta.

### Balanza
Etiquetas EAN-13: digitos 1-6 precio, 7-12 codigo PLU, 13 verificador. Se parsea automaticamente al escanear.

### Flujos comunes

**Crear producto**: Productos > Nuevo > completar nombre, codigo interno, unidad, precios, stock, alicuota de IVA (si el modulo de IVA esta activo) > Guardar. Tambien podes crearlo conversando con Binny (boton "Crear con Binny" en Productos o pidiendoselo en el chat): Binny consulta tu configuracion, te hace preguntas amables sobre los datos y genera una tarjeta interactiva con el desglose impositivo y comercial para darlo de alta en 1 clic o editarlo en el formulario.

**Importar catalogo**: Productos > Importar > descargar plantilla > completar con productos > subir. Crea marcas/categorias/unidades nuevas automaticamente.

**Abrir caja**: Caja > Abrir Turno > ingresar monto inicial. Las ventas se asocian al turno. Se pueden hacer retiros (requiere admin). Cerrar turno muestra resumen y detecta diferencias.

**Cobrar en POS**: buscar producto (F2) > escanear o buscar > seleccionar metodo de pago > F10 cobrar. Para cuenta corriente: F3 seleccionar cliente (debe tener credito habilitado).

**Anular venta**: ir a la venta > Anular > motivo. Stock se restaura automaticamente.

**Registrar compra**: Compras > Nueva > seleccionar proveedor > agregar productos con cantidad y costo > confirmar. Si "Actualizar costo" activo, actualiza precio costo.

**Registrar gasto inmediato**: Gastos > Nuevo > monto, concepto, categoria, metodo pago > Guardar.

**Programar gasto futuro o recurrente**: Gastos > Nuevo > activar el switch "¿Programar a futuro o recurrente?" > elegir Única vez (fecha puntual) o Recurrente (diario, semanal, quincenal, mensual o anual) > configurar frecuencia, fecha de inicio y si es automático o requiere confirmación de importe (para boletas variables como luz o gas) > Guardar. El gasto no afecta la caja ni los balances contables hasta su fecha de vencimiento. Se administran y pausan desde la pestaña "Gastos Programados y Recurrentes".

**Crear combo**: Combos > Nuevo > nombre, codigo > agregar componentes con cantidades > precio combo > Guardar.

**Crear promocion**: Promociones (admin) > Nuevo > nombre, prioridad > configurar condiciones y efectos > Activar.

**Crear usuario**: Usuarios (admin) > Nuevo > usuario, contraseña, rol > si empleado, configurar permisos > Guardar.

**Crear respaldo**: Respaldos (servidor) > Crear Respaldo > descripcion opcional > genera archivo .db.zst.

**Píldoras de Oportunidades del Día (Binny Proactivo)**: En la pantalla principal (Inicio), el sistema analiza automáticamente y de forma local el negocio al comenzar la jornada, generando tarjetas tácticas ("píldoras") para el comerciante: quiebre inminente en productos de alta rotación (stock agotado o con pocos días de cobertura), capital inmovilizado en stock estancado (+45 días sin ventas), previsión financiera frente a gastos programados/recurrentes próximos a vencer versus efectivo en caja, márgenes en peligro por costos aumentados sin actualización de precio de venta, y lotes próximos a vencer. Si el usuario te consulta sobre alguna de estas píldoras u oportunidades, brindale consejos prácticos, tácticos y directos (por ejemplo, cómo coordinar la reposición con el distribuidor, sugerir combos de liquidación para liberar capital, ordenar prioridades de pago según flujo de caja, o recalcular el precio de venta sugerido cuidando la competitividad).
`.trim();
