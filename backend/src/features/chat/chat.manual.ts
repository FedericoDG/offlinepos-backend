export const MANUAL_SISTEMA = `
## Manual de uso del sistema POS

El sistema es una aplicacion de escritorio (Tauri) con interfaz grafica para gestion de comercios (minimercados, almacenes, kioscos, etc.). Cuenta con las siguientes pantallas y funcionalidades:

### Pantallas disponibles

- **Punto de Venta (POS)**: pantalla principal de cobro. Atajos de teclado:
  - F1: Ayuda de atajos
  - F2: Buscador de productos (escanear codigo de barras o buscar por nombre)
  - F3: Seleccionar cliente (venta nominada o cuenta corriente)
  - F4: Calculadora de vuelto (pago con efectivo)
  - F5: Pago con Efectivo
  - F6: Pago con Debito
  - F7: Pago con Credito
  - F8: Pago con Transferencia
  - F9: Pago con Mercado Pago
  - F10: Cobrar / Finalizar venta
  - F11: Alternar Pago Unico / Pago Combinado
  - F12: Cobrar e Imprimir Ticket Directo

- **Productos**: alta, edicion y baja de productos del catalogo. Cada producto tiene: nombre, codigo interno (unico), codigo de barras (opcional), precio de costo, precio de venta, stock actual, stock minimo, unidad de medida, marca, categoria, fecha de vencimiento y lote. Se pueden exportar a Excel e importar desde una plantilla oficial.

- **Unidades de medida**: gestionar las unidades (ej: "un.", "Kg.", "Lt."). Se crean automaticamente al importar catalogo o manualmente desde esta pantalla.

- **Marcas**: gestionar las marcas de productos.

- **Categorias**: gestionar las categorias/rubros de productos. Un producto puede tener multiples categorias si la opcion esta habilitada.

- **Inventario**: vista consolidada de stock con alertas de reposicion (stock bajo minimo, productos sin stock).

- **Compras**: registro de compras a proveedores. Cada compra genera movimiento de entrada en stock y puede actualizar automaticamente el precio de costo.

- **Proveedores**: gestion de distribuidores. Se asocian a productos y compras.

- **Gastos**: registro de gastos operativos del negocio, clasificados por categoria (Servicios, Alquileres, Sueldos, Impuestos, Insumos, Mantenimiento, Fletes, Marketing, Otros). Se pueden anular pero no eliminar.

- **Clientes**: registro de clientes. Puede habilitarles cuenta corriente con limite de credito.

- **Caja**: apertura y cierre de turnos de caja. Registro de retiros de efectivo con autorizacion. Reporte detallado de cada turno (ventas por metodo de pago, retiros, gastos asociados).

- **Presupuestos**: cotizaciones que pueden convertirse en ventas. Tienen fecha de vencimiento, pueden incluir descuentos y recargos, y pueden asignarse a un cliente.

- **Combos**: agrupaciones de productos con precio especial (ej: "Combo Burger + Papas"). Al vender un combo, se descuenta el stock de cada componente.

- **Promociones**: reglas de descuento automaticas que se aplican al momento de cobrar en el POS (se detallan mas abajo).

- **Recargos**: adicionales por forma de pago o categoria (ej: 10% por pago con credito, cargo por delivery).

- **Vencimientos**: control de fechas de vencimiento de productos con lote, con alertas por rangos (vencido, 7 dias, 15 dias, 30 dias, 60 dias).

- **Informe Financiero**: resumen completo de ventas, compras, gastos, descuentos, recargos, retiros, deuda de clientes y resultado neto. Con graficos de evolucion y desglose por metodo de pago. Exportable a Excel.

- **Inteligencia de Negocio (Analitica)**: dashboard con 5 pestanas: Stock y Capital Inmovilizado, Ventas y Tendencias, Rentabilidad y Pareto (80/20), Auditoria y Anomalias, y el propio Asistente IA.

- **Usuarios**: gestion de usuarios con roles (admin/empleado) y permisos granulares por modulo.

- **Configuracion**: modulos activos, formato de impresion de tickets (58mm/80mm), telefono, direccion, pie de ticket, balanza.

- **Respaldos**: copias de seguridad de la base de datos comprimidas con zstd. Solo disponibles en modo servidor.

- **Asistente (Chat)**: este mismo chat donde el usuario puede hacer preguntas sobre datos del negocio (consultas SQL) o sobre como usar el sistema.

### Roles y permisos

El sistema tiene dos roles:
- **Admin**: acceso total a todas las pantallas y funciones. No se le pueden quitar permisos.
- **Empleado/Vendedor**: permisos limitados por defecto. Solo puede cerrar caja. Los permisos disponibles son: ver arqueo en vivo, cerrar caja, cancelar venta del carrito, ver historial de turnos, acceso a productos, stock, compras, gastos, clientes, presupuestos y proveedores. Cada permiso se habilita o deshabilita individualmente desde "Usuarios".

### Modo servidor y cliente

El sistema puede funcionar en modo **servidor** (PC principal que-hosting la base de datos) o en modo **cliente** (terminales que se conectan al servidor por red). Los respaldos solo estan disponibles en modo servidor. Las terminales cliente necesitan configurar la direccion del servidor para conectarse.

---

### Promociones automaticas

Las promociones son reglas que se aplican automaticamente al cobrar en el POS. Cada promocion tiene:
- **Nombre**: identificacion de la promocion.
- **Prioridad**: numero entero. Las de mayor prioridad se evaluan primero.
- **Condiciones** (condiciones_json): definen cuando se activa. Pueden incluir:
  - Dias de la semana (0=domingo, 1=lunes, ... 6=sabado)
  - Metodos de pago aceptados (efectivo, debito, credito, transferencia, mercado_pago)
  - Clientes especificos
  - Monto minimo de compra
  - Cantidad minima de unidades
  - Alcance: "todos", "segmento" (por categorias/marcas/productos), o "productos" especificos
  - Tope de descuento maximo
- **Efectos** (efectos_json): definen que descuento aplica. Tipos disponibles:
  - "descuento_porcentaje": porcentaje de descuento sobre los items que cumplen
  - "descuento_monto_fijo": monto fijo de descuento por unidad
  - "descuento_global_porcentaje": porcentaje sobre el total de la venta
  - "descuento_global_monto": monto fijo sobre el total de la venta
  - "lleva_x_paga_y": promo 3x2, 2x1, etc.
  - "segunda_unidad_porcentaje": segunda unidad con X% de descuento

Las promociones se evaluan en el POS al momento de cobrar. Si se cumplen las condiciones, el efecto se aplica automaticamente. Solo los admins pueden crear, editar o eliminar promociones.

### Recargos

Los recargos son adicionales que se aplican al total de la venta. Tipos:
- **Fijo**: monto fijo en pesos (ej: $200 de cargo por delivery).
- **Porcentaje**: porcentaje sobre el total (ej: 10% por pago con credito).

Cada recargo tiene nombre, tipo, valor y puede tener una categoria (agrupacion). Solo se aplican si estan activos. Solo los admins pueden gestionarlos.

### Control de vencimientos

El sistema rastrea la fecha de vencimiento de los productos. Para cada producto con fecha de vencimiento, clasifica en estados:
- **Vencido**: ya paso la fecha
- **Critico (7 dias)**: vence en 0 a 7 dias
- **Alerta 15 dias**: vence en 8 a 15 dias
- **Alerta 30 dias**: vence en 16 a 30 dias
- **Alerta 60 dias**: vence en 31 a 60 dias
- **En regla**: mas de 60 dias para vencer

Se pueden filtrar por rango, buscar por nombre/codigo/lote/marca, y exportar a Excel con filas coloreadas por estado. El monto en riesgo se calcula como stock x precio de costo.

### Presentaciones de compra

Las presentaciones permiten comprar productos en unidades diferentes a la que se vende. Ejemplo: comprar una caja de 12 latas y que el sistema divida automaticamente el stock. Cada presentacion tiene:
- Nombre (ej: "Caja x12")
- Factor de_conversion (ej: 12)
Al registrar una compra con presentacion, el sistema multiplica la cantidad por el factor para calcular el stock real.

### Balanza electronica

El sistema soporta balanzas comerciales que imprimen etiquetas con codigos EAN-13. El formato de la balanza integra:
- Digitos 1-6: precio por kg o por unidad
- Digitos 7-12: codigo interno del producto (PLU)
- Digito 13: verificador

El sistema parsea automaticamente estos codigos escaneados en el POS para productos pesables (unidad "Kg."). Los codigos PLU tipicos van de 00101 a 00999. Se habilita desde Configuracion > Balanzas Comerciales.

### Etiquetas

El modulo de etiquetas permite imprimir etiquetas de productos con codigo de barras para estanteria o para la propia balanza. Se accede desde la pantalla de Productos. Requiere que el modulo este habilitado en Configuracion.

### Respaldos

Solo disponibles en modo servidor. El sistema crea copias comprimidas (.db.zst) de la base de datos usando zstd nivel 22. Incluyen un encabezado JSON con descripcion y fecha. Funciones:
- Crear respaldo: flushing de WAL + VACUUM INTO + compresion
- Listar respaldos: ordenados por fecha descendente
- Restaurar: descomprime, valida integridad SQLite, sobreescribe la DB y reinicia la app
- Importar respaldo externo: acepta archivos .db o .db.zst
- Eliminar respaldo: borra el archivo del disco
- Abrir carpeta: abre la carpeta de respaldos en el explorador
Todas las operaciones requieren verificacion de contraseña de admin.

### Movimientos de stock

Cada cambio de stock se registra como un movimiento con tipo:
- **STOCK_INICIAL**: carga inicial al crear el producto
- **COMPRA**: entrada por compra a proveedor
- **VENTA**: salida por venta
- **DEVOLUCION_VENTA**: devolucion de un cliente (entrada)
- **AJUSTE_DE_STOCK**: ajuste manual (puede ser entrada o salida)
- **ANULACION_COMPRA**: salida al anular una compra

Los movimientos se pueden consultar desde la pantalla de Inventario o_STOCK.

### Configuracion inicial (Asistente de instalacion)

Al iniciar el sistema por primera vez, se muestra un asistente de 4 pasos:
1. **Metodos de Pago**: habilitar/deshabilitar efectivo, debito, credito, transferencia, Mercado Pago
2. **Impresora Termica**: configurar ancho de papel (58mm o 80mm), telefono, direccion, pie de ticket
3. **Catalogo de Productos**: habilitar marcas, categorias, categorias multiples, presentaciones
4. **Modulos del Sistema**: habilitar proveedores, gastos, clientes, presupuestos, combos, promociones, vencimientos, etiquetas, recargos, balanzas

Se puede saltar con la configuracion recomendada. Todos los ajustes se pueden modificar despues desde Configuracion.

### Exportaciones a Excel

El sistema permite exportar a Excel (.xlsx) desde multiples pantallas:
- Productos, Inventario, Compras, Gastos, Clientes, Proveedores, Presupuestos, Control de Vencimientos, Informe Financiero, Reporte de Turno de Caja

### Informe Financiero - que contiene

- **5 KPIs principales**: Total Ventas, Total Compras, Total Gastos, Total Egresos (Compras+Gastos), Resultado Neto (Ventas-Egresos)
- **5 metricas secundarias**: Ticket Promedio, Descuentos Otorgados, Recargos Aplicados, Retiros de Caja, Deuda de Clientes
- **Arqueo de Cajas**: faltantes, sobrantes, diferencia neta, efectivo fisico, flujo de caja teorico
- **Graficos**: evolucion de ventas/compras/gastos, distribucion por metodo de pago, gastos por categoria
- Periodos: hoy, semana, mes, mes anterior, historico completo, rango personalizado

### Analitica/BI - pestanas disponibles

1. **Asistente IA**: propio de este chat
2. **Stock y Capital Inmovilizado**: capital total en inventario, valor de venta proyectado, margen, productos en riesgo de quiebre (dias de cobertura, velocidad de venta, fecha estimada de quiebre, sugerencia de compra para 15 dias), muertos (sin rotacion en N dias), distribucion de capital por categoria y marca
3. **Ventas y Tendencias**: pronostico estadistico de ingresos (7, 14, 30 dias), patron de demanda por dia de semana, productos en aceleracion (+20% demanda), productos en desaceleracion
4. **Rentabilidad y Pareto**: margen bruto promedio, concentracion Pareto (clases A/B/C), margenes en riesgo (<15% o negativos), top 20 mas rentables, riesgo de concentracion de clientes y proveedores, tabla completa de curva ABC
5. **Auditoria y Anomalias**: deteccion automatica de 4 tipos: incrementos de costo >=15%, turnos con alta tasa de anulacion, ventas extraordinariamente grandes, ajustes manuales negativos de stock (mermas)

### Flujos comunes

**Crear un producto nuevo:**
1. Ir a la pantalla "Productos"
2. Hacer clic en "Nuevo Producto"
3. Completar: nombre (obligatorio), codigo interno (unico), codigo de barras (opcional)
4. Asignar unidad de medida, marca y categoria (si estan habilitadas)
5. Ingresar precio de costo y precio de venta
6. Establecer stock inicial y stock minimo
7. Guardar

**Importar catalogo de productos desde Excel:**
1. Ir a "Productos" -> "Importar"
2. Descargar la plantilla oficial (genera un Excel con ejemplos)
3. Completar la plantilla con los productos (respetando las columnas: Nombre, Codigo de Barras, Codigo Interno, Precio Costo, Precio Venta, Stock, Stock Minimo, Marca, Categoria/Rubro, Unidad)
4. Subir el archivo completado
5. El sistema importa automaticamente y crea marcas, categorias y unidades nuevas

**Abrir y cerrar caja:**
1. Ir a "Caja"
2. "Abrir Turno": ingresar monto inicial (efectivo en caja)
3. Durante el turno, las ventas se asocian al turno abierto
4. Se pueden hacer retiros de efectivo durante el turno (requiere autorizacion de admin)
5. "Cerrar Turno": el sistema muestra resumen (total ventas, retiros, gastos). Se puede cargar el efectivo contado para detectar diferencias
6. Si hay diferencia, se registra automaticamente como faltante o sobrante

**Crear y convertir un presupuesto:**
1. Ir a "Presupuestos"
2. "Nuevo Presupuesto": agregar productos con cantidades y precios
3. Asignar cliente (opcional), agregar nota
4. Guardar (estado: pendiente)
5. Cuando el cliente aprueba, cambiar estado a "aprobado" y el sistema genera la venta

**Venta en cuenta corriente:**
1. En el POS, presionar F3 y seleccionar el cliente
2. El cliente debe tener "permite credito" activo y saldo dentro del limite
3. Al cobrar, elegir metodo "Cuenta Corriente"
4. El monto se registra como deuda del cliente

**Anular una venta:**
1. Ir a la venta que se desea anular
2. Seleccionar "Anular"
3. Ingresar motivo de anulacion
4. El stock se restaura automaticamente

**Registrar una compra:**
1. Ir a "Compras"
2. "Nueva Compra": seleccionar proveedor (opcional)
3. Agregar productos con cantidad y precio de costo
4. Si "Actualizar costo" esta activado, el precio de costo del producto se actualiza automaticamente
5. Se puede elegir una presentacion de compra (ej: caja x12) para que el stock se calcule con factor de conversion
6. Confirmar: el stock se incrementa

**Registrar un gasto:**
1. Ir a "Gastos"
2. "Nuevo Gasto": ingresar monto, concepto, categoria, metodo de pago
3. Guardar. Los gastos se reflejan en el informe financiero

**Crear un combo:**
1. Ir a "Combos"
2. "Nuevo Combo": asignar nombre, codigo interno
3. Agregar productos que lo componen con cantidades
4. Definir precio de venta del combo
5. Guardar. El combo aparece como producto en el POS. Al venderlo, se descuenta los componentes del stock

**Crear una promocion:**
1. Ir a "Promociones" (requiere admin)
2. "Nueva Promocion": asignar nombre y prioridad
3. Configurar condiciones (dias de semana, metodo de pago, monto minimo, productos especificos, etc.)
4. Configurar efecto (porcentaje, monto fijo, lleva_x_paga_y, segunda unidad, etc.)
5. Activar. La promocion se aplica automaticamente al cobrar en el POS si se cumplen las condiciones

**Crear un recargo:**
1. Ir a "Recargos" (requiere admin)
2. "Nuevo Recargo": nombre, tipo (fijo o porcentaje), valor
3. Activar. El recargo se aplica al total de la venta en el POS

**Exportar datos a Excel:**
1. Ir a la pantalla que se desea exportar (Productos, Compras, Gastos, etc.)
2. Hacer clic en el boton "Exportar Excel"
3. Seleccionar ubicacion de guardado
4. El archivo se genera con formato y columnas correspondientes a la pantalla

**Crear un respaldo:**
1. Ir a "Respaldos" (solo modo servidor)
2. Hacer clic en "Crear Respaldo"
3. Ingresar una descripcion (opcional)
4. El sistema genera un archivo comprimido .db.zst con la base de datos completa
5. Los respaldos se pueden restaurar, eliminar o importar externamente

**Crear un usuario nuevo:**
1. Ir a "Usuarios" (requiere admin)
2. "Nuevo Usuario": ingresar nombre de usuario y contraseña
3. Elegir rol (admin o empleado)
4. Si es empleado, configurar los permisos individuales (acceso a productos, stock, compras, gastos, clientes, presupuestos, proveedores, cerrar caja, ver arqueo, ver historial, cancelar venta)
5. Guardar

**Configurar la balanza:**
1. Ir a "Configuracion"
2. Habilitar "Balanzas Comerciales"
3. La balanza imprime etiquetas con formato EAN-13 donde los digitos codifican precio y codigo PLU
4. En el POS, escanear el codigo de barras de la etiqueta de la balanza
5. El sistema parsea automaticamente el precio y el codigo del producto
`.trim();
