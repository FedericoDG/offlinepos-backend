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

**Programar recordatorio**: Se pueden agendar desde la barra superior (icono de campana > "Nuevo Recordatorio" o "Crear con Binny") o pidiéndoselo directamente a Binny en el chat (ej. "recordame llamar al proveedor mañana a las 10:00"). Binny genera una tarjeta interactiva donde podés elegir el tono de alarma (5 sonidos disponibles: sound_01 a sound_05, o silencioso), probar cómo suena y programarlo en 1 clic.

**Dictado por voz (Whisper STT)**: En el chat podés dictar mensajes manteniendo presionado el botón del micrófono. El reconocimiento de voz funciona 100% offline y en local procesado por el CPU del equipo. En Configuración > Asistente Binny podés elegir entre 3 modelos: **Whisper Tiny** (~75 MB, ultra liviano), **Whisper Base** (~142 MB, **recomendado** por su excelente velocidad y precisión en español), y **Whisper Small** (~466 MB, máxima precisión).

**Voz del Asistente (TTS)**: Podés escuchar las respuestas de Binny en voz alta presionando el botón de parlante en cada mensaje o activando la lectura automática en la barra de entrada del chat. En Configuración > Asistente Binny podés seleccionar entre 3 motores de audio: **Piper TTS** (neuronal local de alta fidelidad humana en español, ~100 MB, 100% offline), **Web Speech API** (nativa del sistema operativo, 0 MB) y **eSpeak NG** (sintética ligera robótica, 0 MB).

**Crear combo**: Combos > Nuevo > nombre, codigo > agregar componentes con cantidades > precio combo > Guardar.

**Crear promocion**: Promociones (admin) > Nuevo > nombre, prioridad > configurar condiciones y efectos > Activar.

**Crear usuario**: Usuarios (admin) > Nuevo > usuario, contraseña, rol > si empleado, configurar permisos > Guardar.

**Crear respaldo**: Respaldos (servidor) > Crear Respaldo > descripcion opcional > genera archivo .db.zst.

**Píldoras de Oportunidades del Día (Binny Proactivo)**: En la pantalla principal (Inicio), el sistema analiza automáticamente y de forma local el negocio al comenzar la jornada, generando tarjetas tácticas ("píldoras") para el comerciante: quiebre inminente en productos de alta rotación (stock agotado o con pocos días de cobertura), capital inmovilizado en stock estancado (+45 días sin ventas), previsión financiera frente a gastos programados/recurrentes próximos a vencer versus efectivo en caja, márgenes en peligro por costos aumentados sin actualización de precio de venta, y lotes próximos a vencer. Si el usuario te consulta sobre alguna de estas píldoras u oportunidades, brindale consejos prácticos, tácticos y directos (por ejemplo, cómo coordinar la reposición con el distribuidor, sugerir combos de liquidación para liberar capital, ordenar prioridades de pago según flujo de caja, o recalcular el precio de venta sugerido cuidando la competitividad).

### Módulos del Sistema y Catálogo (Estructura del Catálogo y Módulos Operativos)

El sistema permite activar o desactivar de forma granular 16 módulos según el tipo de comercio. Los datos históricos SIEMPRE se conservan de forma segura al desactivar un módulo (nunca se borran).

#### 1. ESTRUCTURA DEL CATÁLOGO DE PRODUCTOS:
1. **Gestión de Marcas** (usar_marca):
   - **Qué hace y para qué sirve**: Permite registrar y asignar marcas comerciales a los productos.
   - **Cómo se usa**: En Productos > formulario de alta/edición se selecciona la marca; permite filtrar el catálogo por marca y consultar reportes.
   - **Mayor rédito comercial**: Negociar con proveedores sabiendo qué marcas tienen mayor rotación y margen; armar promociones específicas por marca y profesionalizar la presentación del inventario.

2. **Gestión de Categorías / Rubros** (usar_categoria):
   - **Qué hace y para qué sirve**: Organiza el catálogo en rubros o familias (Bebidas, Almacén, Limpieza, etc.).
   - **Cómo se usa**: En el Punto de Venta permite filtrar y navegar por pestañas de colores; en Productos organiza el catálogo; en informes desglosa ventas por rubro.
   - **Mayor rédito comercial**: Aplicar el Principio de Pareto (identificar el 20% de rubros que generan el 80% de ganancias), diagramar la reposición física de góndolas según rubros, y configurar promociones automáticas por rubro entero.

3. **Categorías Múltiples por Producto** (categoria_multiple):
   - **Qué hace y para qué sirve**: Permite que un producto pertenezca a más de una categoría a la vez (ej: una gaseosa puede estar en "Bebidas" y en "Ofertas de Fin de Semana"). Requiere que Categorías esté activo.
   - **Cómo se usa**: Al crear o editar un producto se pueden tildar múltiples categorías simultáneamente.
   - **Mayor rédito comercial**: Multiplica las ventas cruzadas e impulsivas al exponer un producto clave en varias secciones o categorías de temporada ("Parrilla", "Navidad", "Desayuno") sin duplicar el código ni desfasar el stock único.

4. **Presentaciones y Bultos (Packs / Cajas)** (usar_presentaciones):
   - **Qué hace y para qué sirve**: Gestiona unidades de venta y compra mayorista/minorista vinculadas con factor de conversión (ej: comprar cajas de 24 y vender por unidad o pack de 6).
   - **Cómo se usa**: Se define en el producto el nombre de la presentación y su factor de conversión. Al comprar cajas, el stock suma unidades automáticamente; al vender packs, descuenta las unidades correspondientes.
   - **Mayor rédito comercial**: Comprar a distribuidores por fardo o caja cerrada con menor costo unitario y vender tanto por menor como por mayor con margen óptimo y stock 100% exacto sin cuentas manuales.

#### 2. MÓDULOS OPERATIVOS DEL SISTEMA:
5. **Impuestos y Facturación (IVA / ARCA)** (usar_iva):
   - **Qué hace y para qué sirve**: Discrimina alícuotas impositivas fiscales (21%, 10.5%, 27%, 0%, exento) en compras, ventas, tickets y reportes impositivos.
   - **Cómo se usa**: Se asocia la alícuota a cada producto; el sistema calcula base imponible y débito/crédito fiscal en cada ticket.
   - **Mayor rédito comercial**: Exportación limpia de Libros de IVA Ventas e IVA Compras para el contador, control exacto del saldo técnico fiscal y prevención de inconsistencias o multas tributarias.

6. **Proveedores y Gestión de Compras** (usar_proveedor):
   - **Qué hace y para qué sirve**: Administra el padrón de proveedores, facturas de compra, actualización de costos de adquisición y cuentas corrientes/deudas con proveedores.
   - **Cómo se usa**: En Compras > Nueva Compra se cargan las facturas de proveedores, lo que incrementa el stock y recalcula costos automáticamente.
   - **Mayor rédito comercial**: Protegerse de la inflación actualizando los precios de venta en el acto ante aumentos de costo, verificar que el distribuidor facture lo acordado y optimizar plazos de pago.

7. **Módulo de Gastos Operativos** (usar_gastos):
   - **Qué hace y para qué sirve**: Registra egresos y gastos del negocio (alquiler, luz, sueldos, fletes, insumos, mantenimiento) tanto inmediatos como programados/recurrentes.
   - **Cómo se usa**: En Gastos se registran salidas inmediatas con comprobante o se programan abonos futuros (fijos o variables con confirmación de monto).
   - **Mayor rédito comercial**: Calcular la ganancia neta REAL del negocio (Ventas - Costos de mercadería - Gastos operativos) en lugar de solo la ganancia bruta, detectando fugas de dinero y reduciendo costos innecesarios.

8. **Clientes y Cuentas Corrientes** (usar_clientes):
   - **Qué hace y para qué sirve**: Padrón de clientes fidelizados, historial de consumo, ventas fiadas (cuenta corriente) y límites de crédito.
   - **Cómo se usa**: En el POS se asocia el cliente con F3 y se permite cobrarle en efectivo o anotar a su cuenta corriente.
   - **Mayor rédito comercial**: Fidelizar a clientes habituales, controlar el riesgo crediticio fijando topes de deuda para evitar incobrables y enviar estados de cuenta o recordatorios de pago por WhatsApp en 1 clic.

9. **Presupuestos y Cotizaciones** (usar_presupuestos):
   - **Qué hace y para qué sirve**: Emisión de cotizaciones formales con precios congelados sin afectar stock ni caja.
   - **Cómo se usa**: En el POS se arma el carrito y se presiona "Guardar Presupuesto". Luego se imprime (térmico o A4) y cuando el cliente lo aprueba, se transforma en venta con 1 clic.
   - **Mayor rédito comercial**: Cerrar ventas mayoristas o corporativas, evitar demoras volviendo a cargar productos en caja y dar una imagen altamente profesional frente a clientes exigentes.

10. **Combos y Kits / Productos Compuestos** (usar_combos):
    - **Qué hace y para qué sirve**: Permite armar paquetes de productos con precio promocional (ej: Fernet + 2 Colas, Desayuno, Kit Escolar).
    - **Cómo se usa**: En Combos se definen los artículos componentes. Al vender el combo en el POS, el sistema descuenta automáticamente el stock de cada producto individual.
    - **Mayor rédito comercial**: Aumentar el ticket promedio combinando productos estrella con productos de baja rotación estancados, liberando capital inmovilizado y atrayendo más clientes.

11. **Promociones y Descuentos Automáticos** (usar_promociones):
    - **Qué hace y para qué sirve**: Motor de reglas automáticas de descuento (3x2, 2do al 50%, descuentos por medio de pago ej: 10% en efectivo, o descuentos por día de la semana).
    - **Cómo se usa**: Se configuran las reglas en Configuración > Promociones; el POS las detecta y aplica automáticamente en caja sin que el cajero deba calcular nada.
    - **Mayor rédito comercial**: Aumentar la afluencia en días lentos (ej: "Miércoles de 15% de descuento en lácteos"), incentivar el cobro en efectivo para tener liquidez inmediata y eliminar favoritismos o errores humanos de cajeros.

12. **Control de Vencimientos y Alertas** (usar_vencimientos):
    - **Qué hace y para qué sirve**: Seguimiento de fechas de caducidad y lotes por producto.
    - **Cómo se usa**: El sistema emite alertas visuales con semáforo (7, 15, 30, 60 días) en Inventario y en el POS para mercadería próxima a vencer.
    - **Mayor rédito comercial**: Reducir a cero las pérdidas por mercadería vencida aplicando promociones de liquidación antes de la fecha de caducidad (criterio FEFO: First Expired, First Out) y proteger la reputación del comercio.

13. **Impresión de Etiquetas y Góndola** (usar_etiquetas):
    - **Qué hace y para qué sirve**: Diseñador e impresor integrado de etiquetas de código de barras y precios para rollo térmico (50x30 mm, etc.), hojas A4 y carteles de góndola.
    - **Cómo se usa**: Desde la lista de productos o compras se seleccionan artículos y se envían a imprimir con los precios vigentes.
    - **Mayor rédito comercial**: Acelerar drásticamente la velocidad de cobro en caja escaneando códigos, evitar discrepancias de precio en góndola y presentar el local ordenado y profesional.

14. **Recargos y Adicionales (Delivery / Servicios)** (usar_recargos):
    - **Qué hace y para qué sirve**: Conceptos de cargos adicionales fijos o porcentuales (envíos a domicilio, fletes, embalaje, recargo por tarjeta).
    - **Cómo se usa**: En el Punto de Venta y en Presupuestos se añade el recargo con 1 clic de forma clara y discriminada en el ticket.
    - **Mayor rédito comercial**: Trasladar costos logísticos de fletes o cadetería sin achicar el margen comercial del producto y mantener transparencia absoluta con el cliente.

15. **Recordatorios y Alertas Personales** (usar_recordatorios):
    - **Qué hace y para qué sirve**: Sistema de tareas y avisos con fecha, hora, sonido de campana y notificación emergente en pantalla.
    - **Cómo se usa**: Se programan desde la barra superior (icono campana) o conversando con Binny.
    - **Mayor rédito comercial**: Despejar la mente del comerciante, asegurar que no se pase ningún pago de servicios, cheque o llamada a proveedor clave, evitando recargos por mora y manteniendo la operatoria al día.

16. **Balanzas Comerciales (EAN-13)** (usar_balanza):
    - **Qué hace y para qué sirve**: Integración con balanzas de peso y precio que imprimen tickets de código de barras EAN-13 (prefijo 20, PLU de 4 o 5 dígitos, y peso/precio embebido).
    - **Cómo se usa**: Al escanear el ticket de la balanza en el POS, el sistema identifica el producto pesable y aplica el peso o precio exacto automáticamente.
    - **Mayor rédito comercial**: Imprescindible para fiambrerías, carnicerías, verdulerías y panaderías. Elimina las colas en caja, agiliza la lectura de mercadería pesable y erradica el 100% de los errores de digitación de gramos o precios por parte del cajero.
`.trim();
