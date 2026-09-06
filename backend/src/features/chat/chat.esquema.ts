export const ESQUEMA_SQLITE = `
# Base de datos SQLite del POS - Estructura REAL (volcada de sqlite_master)

IMPORTANTE: Esta es la estructura EXACTA de la base de datos. Usá los nombres de columnas tal cual aparecen aca. NO inventes columnas.

## Convenciones de fechas
Las fechas son timestamps Unix en segundos (INTEGER big_integer).
- Tablas que usan "creado_en": categoria, categoria_gasto, cliente, gasto, historial_precio (NO), licencia, marca, movimiento_stock (NO), presentacion_compra, producto, promocion, proveedor, recargo, unidad, usuario
- Tablas que usan "creada_en": venta
- Tablas que usan "fecha": compra, gasto, movimiento_stock, historial_precio, caja_retiro, cliente_movimiento_cuenta, turno_caja (abierto_en/cerrado_en)
- Para filtrar "hoy": DATE(creada_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') o DATE(fecha, 'unixepoch', 'localtime') = DATE('now', 'localtime')
- Para "este mes": fecha >= strftime('%s', 'now', 'start of month')

## Glosario de enums (valores exactos)
- venta.estado: "completada" | "anulada". Una venta anulada tiene anulada_en NOT NULL y estado="anulada". Para ventas válidas: estado='completada' AND anulada_en IS NULL.
- turno_caja.estado: "abierto" | "cerrado"
- compra: anulada=0 (activa), anulada=1 (anulada). No hay campo estado string.
- gasto: anulado=0 (activo), anulado=1 (anulado). No hay campo estado string.
- cliente_movimiento_cuenta.tipo: "pago" | "cargo" | "ajuste_debito" | "ajuste_credito"
- movimiento_stock.tipo: "STOCK_INICIAL" | "COMPRA" | "DEVOLUCION_VENTA" | "VENTA" | "AJUSTE_DE_STOCK" | "ANULACION_COMPRA" (TODOS EN MAYUSCULAS)
- venta_pago.metodo: "efectivo" | "debito" | "credito" | "transferencia" | "mercado_pago" | "cuenta_corriente"
- gasto.metodo_pago: "efectivo" | "transferencia" | "debito" | "credito" | "cheque" | "otro"
- historial_precio.tipo: "costo" | "venta"
- recargo.tipo: "fijo" | "porcentaje"
- presupuesto.estado: "pendiente" | "aprobado" | "cancelado" (el estado "vencido" se calcula al leer: pendiente + vence_en < ahora, nunca se guarda)
- cliente.condicion_iva: "consumidor_final" (default) u otro string libre
- cliente.tipo_documento: "DNI" (default) u otro string libre
- usuario.rol: "admin" | "vendedor"
- licencia.estado: "activa" | "suspendida"

## Seeds de categoria_gasto (9 categorías por defecto)
"Servicios", "Alquileres", "Sueldos y Jornales", "Impuestos y Tasas",
"Insumos y Embalaje", "Mantenimiento y Reparaciones", "Fletes y Logística",
"Marketing y Publicidad", "Otros Gastos"

## Datos iniciales
- La tabla cliente tiene una fila semilla: nombre="Consumidor Final", documento="Sin documento", condicion_iva="consumidor_final", limite_credito=0, saldo_actual=0, permite_credito=false
- La tabla unidad tiene una fila semilla: abreviatura="un", nombre="Unidades"

## Estructura de tablas (DDL real)

CREATE TABLE "caja_retiro" ( "id" integer PRIMARY KEY AUTOINCREMENT, "turno_caja_id" bigint NOT NULL, "usuario_id" bigint NOT NULL, "autorizado_por_usuario_id" bigint NOT NULL, "monto" double NOT NULL, "motivo" varchar NOT NULL, "nota" varchar NULL, "fecha" bigint NOT NULL, FOREIGN KEY ("turno_caja_id") REFERENCES "turno_caja" ("id") ON DELETE CASCADE, FOREIGN KEY ("usuario_id") REFERENCES "usuario" ("id") ON DELETE RESTRICT, FOREIGN KEY ("autorizado_por_usuario_id") REFERENCES "usuario" ("id") ON DELETE RESTRICT );
CREATE TABLE "categoria" ( "id" integer PRIMARY KEY AUTOINCREMENT, "nombre" varchar NOT NULL UNIQUE, "activo" boolean NOT NULL DEFAULT TRUE, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "categoria_gasto" ( "id" integer PRIMARY KEY AUTOINCREMENT, "nombre" varchar NOT NULL UNIQUE, "descripcion" varchar NULL, "color" varchar NULL, "activo" boolean NOT NULL DEFAULT TRUE, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "cliente" ( "id" integer PRIMARY KEY AUTOINCREMENT, "nombre" varchar NOT NULL, "razon_social" varchar NULL, "tipo_documento" varchar NOT NULL DEFAULT 'DNI', "documento" varchar NULL, "telefono" varchar NULL, "celular" varchar NULL, "email" varchar NULL, "direccion" varchar NULL, "localidad" varchar NULL, "condicion_iva" varchar NOT NULL DEFAULT 'consumidor_final', "limite_credito" double NOT NULL DEFAULT 0, "permite_credito" boolean NOT NULL DEFAULT TRUE, "saldo_actual" double NOT NULL DEFAULT 0, "nota" varchar NULL, "activo" boolean NOT NULL DEFAULT TRUE, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "cliente_movimiento_cuenta" ( "id" integer PRIMARY KEY AUTOINCREMENT, "cliente_id" bigint NOT NULL, "tipo" varchar NOT NULL, "monto" double NOT NULL, "saldo_anterior" double NOT NULL, "saldo_posterior" double NOT NULL, "concepto" varchar NOT NULL, "comprobante" varchar NULL, "metodo_pago" varchar NULL, "nota" varchar NULL, "venta_id" bigint NULL, "usuario_id" bigint NOT NULL, "fecha" bigint NOT NULL, "anulado" boolean NOT NULL DEFAULT FALSE, "anulado_motivo" varchar NULL, "anulado_en" bigint NULL, "anulado_por_usuario_id" bigint NULL, FOREIGN KEY ("cliente_id") REFERENCES "cliente" ("id") ON DELETE RESTRICT, FOREIGN KEY ("usuario_id") REFERENCES "usuario" ("id") ON DELETE RESTRICT );
CREATE TABLE "combo" ( "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "nombre" varchar(150) NOT NULL, "codigo_interno" varchar(30) NOT NULL UNIQUE, "codigo_barras" varchar(30) UNIQUE, "precio_venta" double NOT NULL DEFAULT 0, "activo" boolean NOT NULL DEFAULT TRUE, "nota" text, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "combo_item" ( "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "combo_id" bigint NOT NULL, "producto_id" bigint NOT NULL, "cantidad" double NOT NULL DEFAULT 1, FOREIGN KEY ("combo_id") REFERENCES "combo" ("id") ON DELETE CASCADE, FOREIGN KEY ("producto_id") REFERENCES "producto" ("id") );
CREATE TABLE "compra" ( "id" integer PRIMARY KEY AUTOINCREMENT, "proveedor_id" bigint, "numero_comprobante" varchar, "usuario_id" bigint NOT NULL, "nota" varchar, "total" double NOT NULL, "actualiza_costo" boolean NOT NULL DEFAULT TRUE, "fecha" bigint NOT NULL, "anulada" boolean NOT NULL DEFAULT FALSE, "anulada_en" bigint, "anulada_usuario_id" bigint, "anulada_nota" varchar );
CREATE TABLE "compra_item" ( "id" integer PRIMARY KEY AUTOINCREMENT, "compra_id" bigint NOT NULL, "producto_id" bigint NOT NULL, "cantidad" double NOT NULL, "precio_costo" double NOT NULL, "subtotal" double NOT NULL, "presentacion_compra_id" bigint, "factor_conversion_usado" double, "presentacion_nombre" varchar, "actualiza_costo" boolean, "fecha_vencimiento" varchar NULL, "lote" varchar NULL );
CREATE TABLE "config" ( "clave" varchar NOT NULL PRIMARY KEY, "valor" varchar NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "gasto" ( "id" integer PRIMARY KEY AUTOINCREMENT, "categoria_gasto_id" bigint NULL, "monto" double NOT NULL, "fecha" bigint NOT NULL, "concepto" varchar NOT NULL, "comprobante" varchar NULL, "metodo_pago" varchar NOT NULL DEFAULT 'efectivo', "proveedor_id" bigint NULL, "nota" varchar NULL, "usuario_id" bigint NOT NULL, "anulado" boolean NOT NULL DEFAULT FALSE, "anulado_motivo" varchar NULL, "anulado_en" bigint NULL, "anulado_por_usuario_id" bigint NULL, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL, "compra_id" bigint NULL, "turno_caja_id" bigint NULL );
CREATE TABLE "historial_precio" ( "id" integer PRIMARY KEY AUTOINCREMENT, "producto_id" bigint NOT NULL, "tipo" varchar NOT NULL, "precio" double NOT NULL, "fecha" bigint NOT NULL );
CREATE TABLE "licencia" ( "id" integer PRIMARY KEY AUTOINCREMENT, "licencia_servidor_id" varchar NOT NULL, "clave" varchar NOT NULL, "comercio_id" varchar NOT NULL, "comercio_nombre" varchar NOT NULL, "instalacion_id" varchar NOT NULL, "estado" varchar NOT NULL, "ultima_validacion" bigint NOT NULL, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL, "rol" varchar NOT NULL DEFAULT 'servidor' );
CREATE TABLE "marca" ( "id" integer PRIMARY KEY AUTOINCREMENT, "nombre" varchar NOT NULL UNIQUE, "activo" boolean NOT NULL DEFAULT TRUE, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "movimiento_stock" ( "id" integer PRIMARY KEY AUTOINCREMENT, "producto_id" bigint NOT NULL, "tipo" varchar NOT NULL, "cantidad" double NOT NULL, "stock_resultante" double NOT NULL, "usuario_id" bigint NOT NULL, "nota" varchar, "fecha" bigint NOT NULL );
CREATE TABLE "presentacion_compra" ( "id" integer PRIMARY KEY AUTOINCREMENT, "producto_id" bigint NOT NULL, "nombre" varchar NOT NULL, "factor_conversion" double NOT NULL, "activo" boolean NOT NULL DEFAULT TRUE, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "presupuesto" ( "id" integer PRIMARY KEY AUTOINCREMENT, "numero" bigint NOT NULL, "cliente_id" bigint NULL, "usuario_id" bigint NOT NULL, "total" double NOT NULL, "descuento" double NOT NULL DEFAULT 0, "validez_dias" integer NOT NULL DEFAULT 7, "vence_en" bigint NOT NULL, "estado" varchar NOT NULL DEFAULT 'pendiente', "nota" text NULL, "venta_id" bigint NULL, "convertido_en" bigint NULL, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL, "recargo" double NOT NULL DEFAULT 0, "recargo_concepto" varchar NULL );
CREATE TABLE "presupuesto_item" ( "id" integer PRIMARY KEY AUTOINCREMENT, "presupuesto_id" bigint NOT NULL, "producto_id" bigint NOT NULL, "cantidad" double NOT NULL, "precio_unitario" double NOT NULL, "subtotal" double NOT NULL, "descuento_item" double NOT NULL DEFAULT 0 );
CREATE TABLE "producto" ( "id" integer PRIMARY KEY AUTOINCREMENT, "codigo_barras" varchar NULL, "codigo_interno" varchar NOT NULL UNIQUE, "nombre" varchar NOT NULL, "cantidad" double NOT NULL DEFAULT 0, "stock_minimo" double NOT NULL DEFAULT 0, "unidad_id" bigint NOT NULL, "precio_venta" double NOT NULL DEFAULT 0, "precio_costo" double NOT NULL DEFAULT 0, "permitir_sin_stock" boolean NOT NULL DEFAULT FALSE, "activo" boolean NOT NULL DEFAULT TRUE, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL, "marca_id" bigint, "fecha_vencimiento" varchar NULL, "lote" varchar NULL );
CREATE TABLE "producto_categoria" ( "id" integer PRIMARY KEY AUTOINCREMENT, "producto_id" bigint NOT NULL, "categoria_id" bigint NOT NULL );
CREATE TABLE "promocion" ( "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT, "nombre" varchar NOT NULL, "activo" boolean NOT NULL DEFAULT TRUE, "prioridad" integer NOT NULL DEFAULT 0, "condiciones_json" varchar NOT NULL, "efectos_json" varchar NOT NULL, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "proveedor" ( "id" integer PRIMARY KEY AUTOINCREMENT, "nombre" varchar NOT NULL, "telefono" varchar, "email" varchar, "direccion" varchar, "nota" varchar, "activo" boolean NOT NULL DEFAULT TRUE, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "recargo" ( "id" integer PRIMARY KEY AUTOINCREMENT, "nombre" varchar NOT NULL, "tipo" varchar NOT NULL, "valor" double NOT NULL DEFAULT 0, "activo" boolean NOT NULL DEFAULT TRUE, "categoria" varchar NULL, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL );
CREATE TABLE "turno_caja" ( "id" integer PRIMARY KEY AUTOINCREMENT, "usuario_id" bigint NOT NULL, "monto_inicial" double NOT NULL, "abierto_en" bigint NOT NULL, "cerrado_en" bigint NULL, "monto_contado_efectivo" double NULL, "observaciones_cierre" varchar NULL, "estado" varchar NOT NULL DEFAULT 'abierto', FOREIGN KEY ("usuario_id") REFERENCES "usuario" ("id") ON DELETE RESTRICT );
CREATE TABLE "unidad" ( "id" integer PRIMARY KEY AUTOINCREMENT, "abreviatura" varchar NOT NULL UNIQUE, "nombre" varchar NULL, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL, "activo" boolean NOT NULL DEFAULT TRUE );
CREATE TABLE "usuario" ( "id" integer PRIMARY KEY AUTOINCREMENT, "usuario" varchar NOT NULL UNIQUE, "password_hash" varchar NOT NULL, "rol" varchar NOT NULL, "creado_en" bigint NOT NULL, "actualizado_en" bigint NOT NULL, "activo" boolean NOT NULL DEFAULT TRUE, "permisos" varchar NULL );
CREATE TABLE "venta" ( "id" integer PRIMARY KEY AUTOINCREMENT, "turno_caja_id" bigint NOT NULL, "usuario_id" bigint NOT NULL, "cliente_id" bigint NULL, "total" double NOT NULL, "descuento" double NOT NULL DEFAULT 0, "estado" varchar NOT NULL DEFAULT 'completada', "nota" varchar NULL, "anulada_en" bigint NULL, "anulada_por_usuario_id" bigint NULL, "anulada_motivo" varchar NULL, "creada_en" bigint NOT NULL, "recargo" double NOT NULL DEFAULT 0, "recargo_concepto" varchar NULL );
CREATE TABLE "venta_item" ( "id" integer PRIMARY KEY AUTOINCREMENT, "venta_id" bigint NOT NULL, "producto_id" bigint NOT NULL, "cantidad" double NOT NULL, "precio_unitario" double NOT NULL, "subtotal" double NOT NULL, "descuento_item" double NOT NULL DEFAULT 0 );
CREATE TABLE "venta_pago" ( "id" integer PRIMARY KEY AUTOINCREMENT, "venta_id" bigint NOT NULL, "metodo" varchar NOT NULL, "monto" double NOT NULL );

## Notas de negocio
- Las ventas NO tienen campo usuario_id que identifique al vendedor; solo turno_caja_id y usuario_id del cajero.
- Un turno de caja puede tener varias ventas, caja_retiros y gastos asociados.
- Los productos se unen a categorías via producto_categoria (tabla puente con id propio).
- Los presupuestos pueden convertirse en venta (venta_id, convertido_en).
- El precio de costo del producto se actualiza con cada compra si actualiza_costo=true.
- La cuenta corriente del cliente se actualiza al crear/cancelar ventas: tipo="cargo" al vender, tipo="pago" al cobrar.
- Los presupuestos vencidos NO se guardan como tal; se calculan al vuelo cuando estado="pendiente" y vence_en < now.
`;

export const EJEMPLOS_CONSULTAS: Array<{ pregunta: string; sql: string }> = [
  {
    pregunta: '¿Cuánto facturé hoy?',
    sql: `SELECT SUM(total) AS total_hoy FROM venta WHERE estado = 'completada' AND anulada_en IS NULL AND DATE(creada_en, 'unixepoch', 'localtime') = DATE('now', 'localtime') LIMIT 1`,
  },
  {
    pregunta: '¿Cuáles son los productos con stock bajo el mínimo?',
    sql: `SELECT p.nombre, p.cantidad, p.stock_minimo, u.abreviatura FROM producto p JOIN unidad u ON u.id = p.unidad_id WHERE p.cantidad <= p.stock_minimo AND p.activo = 1 ORDER BY p.cantidad ASC LIMIT 50`,
  },
  {
    pregunta: '¿Quién es el cliente que más debe?',
    sql: `SELECT nombre, documento, saldo_actual FROM cliente WHERE saldo_actual > 0 AND activo = 1 ORDER BY saldo_actual DESC LIMIT 10`,
  },
  {
    pregunta: '¿Cuánto gasté en alquiler este mes?',
    sql: `SELECT SUM(g.monto) AS total FROM gasto g JOIN categoria_gasto cg ON cg.id = g.categoria_gasto_id WHERE cg.nombre = 'Alquileres' AND g.anulado = 0 AND g.fecha >= strftime('%s', 'now', 'start of month') LIMIT 1`,
  },
  {
    pregunta: '¿Cuáles son los 5 productos más vendidos este mes?',
    sql: `SELECT p.nombre, SUM(vi.cantidad) AS total_vendido FROM venta_item vi JOIN producto p ON p.id = vi.producto_id JOIN venta v ON v.id = vi.venta_id WHERE v.estado = 'completada' AND v.anulada_en IS NULL AND v.creada_en >= strftime('%s', 'now', 'start of month') GROUP BY p.id ORDER BY total_vendido DESC LIMIT 5`,
  },
];
