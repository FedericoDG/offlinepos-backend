export const MANUAL_SISTEMA = `
## Manual del sistema POS

Aplicacion de escritorio (Tauri) para gestion de comercios.

### Pantallas
- **POS**: pantalla de cobro. Atajos: F2 buscador productos, F3 cliente, F4 vuelto, F5-F9 metodos de pago, F10 cobrar, F11 pago combinado, F12 cobrar+imprimir.
- **Productos**: alta/edicion/baja. Cada uno tiene: nombre, codigo interno (unico), codigo barras, precio costo/venta, stock, stock minimo, unidad, marca, categoria, vencimiento, lote.
- **Unidades/Marcas/Categorias**: gestion de cada una. Categorias pueden ser multiples si se habilita.
- **Inventario**: vista consolidada de stock con alertas.
- **Compras**: registro a proveedores, genera movimiento stock y puede actualizar costo.
- **Proveedores**: gestion de distribuidores.
- **Gastos**: gastos operativos por categoria (Servicios, Alquileres, Sueldos, Impuestos, Insumos, Mantenimiento, Fletes, Marketing, Otros). Se anulan pero no eliminan.
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
- **Configuracion**: modulos activos, impresora, balanza.
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

**Crear producto**: Productos > Nuevo > completar nombre, codigo interno, unidad, precios, stock > Guardar.

**Importar catalogo**: Productos > Importar > descargar plantilla > completar con productos > subir. Crea marcas/categorias/unidades nuevas automaticamente.

**Abrir caja**: Caja > Abrir Turno > ingresar monto inicial. Las ventas se asocian al turno. Se pueden hacer retiros (requiere admin). Cerrar turno muestra resumen y detecta diferencias.

**Cobrar en POS**: buscar producto (F2) > escanear o buscar > seleccionar metodo de pago > F10 cobrar. Para cuenta corriente: F3 seleccionar cliente (debe tener credito habilitado).

**Anular venta**: ir a la venta > Anular > motivo. Stock se restaura automaticamente.

**Registrar compra**: Compras > Nueva > seleccionar proveedor > agregar productos con cantidad y costo > confirmar. Si "Actualizar costo" activo, actualiza precio costo.

**Registrar gasto**: Gastos > Nuevo > monto, concepto, categoria, metodo pago > Guardar.

**Crear combo**: Combos > Nuevo > nombre, codigo > agregar componentes con cantidades > precio combo > Guardar.

**Crear promocion**: Promociones (admin) > Nuevo > nombre, prioridad > configurar condiciones y efectos > Activar.

**Crear usuario**: Usuarios (admin) > Nuevo > usuario, contraseña, rol > si empleado, configurar permisos > Guardar.

**Crear respaldo**: Respaldos (servidor) > Crear Respaldo > descripcion opcional > genera archivo .db.zst.
`.trim();
