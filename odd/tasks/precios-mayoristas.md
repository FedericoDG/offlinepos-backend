# Precios mayoristas (SEPA) consultables por Binny

**Estado:** EN CURSO · **Inicio:** 2026-10-13
**Rama:** `feature/precios-mayoristas` · **Repo:** `backend_panel_administracion`

---

## Objetivo

Que el comerciante escriba en el chat:

```
/consultar-precio sal fina
/consultar-precio decime el precio de coca cola 500 cm3
```

y Binny le responda **a cuánto la tienen los mayoristas**, comparando entre cadenas:

> **SAL FINA 500 G**
> · MAKRO — $1.250 · entre $1.250 y $1.280 en 22 sucursales
> · COTO — $1.310
>
> *El más barato: MAKRO, $60 menos.*

## Problema / punto de partida

El comerciante no tiene forma de saber **si el costo que paga es bueno**. Los
mayoristas publican sus precios (SEPA, el sistema de precios del gobierno), pero
son dumps crudos de **176.703 filas** que nadie puede leer.

## La fuente de datos (verificada sobre el dump real de MAKRO)

Un **ZIP** con tres archivos:

| Archivo | Contenido | Volumen real |
|---|---|---|
| `comercio.csv` | El mayorista (CUIT, razón social, web, versión SEPA) | 1 fila + pie |
| `sucursales.csv` | Sus sucursales (nombre, dirección, barrio, horarios) | 25 filas |
| `productos.csv` | Precio por producto **y por sucursal** | 176.703 filas · 10.827 productos · 24 sucursales |

**Detalles del formato que el parser tiene que respetar:**

- Separador `|` (no coma)
- **UTF-8 con BOM** al inicio
- Saltos **CRLF**
- **19 campos** (el último vacío)
- `comercio.csv` trae una **línea de pie** que no es dato
- Números con punto decimal (`4256.2`)
- La cadena se identifica por **CUIT** (no por `id_comercio`, que puede cambiar)

## Lo que dice la spec oficial (Anexo II, Res. 448-E/2016)

Verificado contra `/home/federico/Escritorio/POS/res448-2.pdf`:

| Regla | Consecuencia |
|---|---|
| El ZIP se llama **`sepa.zip`** y trae **obligatoriamente los 3 archivos** | El endpoint valida los tres |
| **`comercio.csv` tiene una fila por BANDERA** | Un comercio puede publicar varias banderas con precios distintos → **la cadena se identifica por `(CUIT, bandera)`** |
| **`productos_ean`** | `1` = `id_producto` es un EAN real (GTIN/UPC); `0` = código interno del comercio. **Solo los `1` se cruzan por código de barras** |
| **`unidad_venta`** | Es la **cantidad de unidades del bulto** (no un código); `precio_bulto = precio_unitario × unidad_venta` |
| **`productos_marca`** | Si el producto no tiene marca se consigna literalmente `"Sin marca"` |
| **Comillas dobles** | Un valor que contiene el separador `\|` viene **envuelto en comillas**; una comilla literal se escribe **duplicada** (`""`). Un `split('\|')` parte mal esas filas |

**Sobre los dumps reales de MAKRO:** `productos_ean` viene en `1` en las 176.701
filas (todos EAN reales), no hay comillas, y `comercio.csv` trae una sola bandera.

## Decisiones

| Tema | Decisión |
|---|---|
| Quién sube | El dueño, a mano, desde el panel |
| Formato | **Un ZIP** con los 3 CSV |
| Qué se guarda | **Solo el precio actual** (upsert). Sin histórico |
| Granularidad | Una fila por **(cadena, producto)**, con mín/máx por sucursal |
| Identidad de la cadena | **CUIT** |
| La consulta | `/consultar-precio <lenguaje natural>` en el chat, con un **tool de Binny** |

## Arquitectura

```
[Panel] subís un ZIP  →  POST /api/precios-mayoristas/importar
                              │  descomprime · valida · agrega por producto · UPSERT
                              ▼
                      Cadena · SucursalCadena · PrecioMayorista
                              ▲
                              │  tool del servidor
                              │
[Chat] /consultar-precio sal fina → Binny entiende el producto y responde
```

## El punto clave: la tabla NO crece con el tiempo

Como es **upsert** por `(CUIT, EAN)`, el tamaño converge a *productos × cadenas*:

| Escenario | Filas |
|---|---|
| 10 cadenas | ~108.000 |
| 20 cadenas | ~216.000 |
| Subiendo todos los días durante 5 años | **lo mismo** |

Solo crece si aparece un **producto nuevo** o una **cadena nueva**.

---

## Checklist

### Fase 1 — Ingesta (T1-T4)

- [x] **T1** — Modelos Prisma `Cadena`, `SucursalCadena`, `PrecioMayorista` + migración
      (`20261013221303_add_precios_mayoristas`).
- [x] **T2** — Parser de los 3 CSV (BOM, CRLF, `|`, 19 campos, pie) en
      `parser.ts`, verificado contra el dump real: 1 comercio, 24 sucursales,
      176.701 productos válidos (10.827 EAN únicos) y las líneas de pie
      descartadas. **Los 3 archivos traen pie**, no solo `comercio.csv`.
- [x] **T3** — Agregación por producto (moda + mín/máx + sucursales) y upsert
      masivo con `INSERT ... ON CONFLICT` por lotes. Medido: **10.827 productos
      en 1,8 s**; la segunda corrida da **0 creados / 10.827 actualizados**.
- [x] **T4** — Endpoint admin `POST /api/precios-mayoristas/importar` (ZIP con `multer` +
      `adm-zip`) y `GET /api/precios-mayoristas` (listado de cadenas). Probado de
      punta a punta: subida real de 4,6 MB → 1,6 s; sin archivo, con formato
      cambiado y sin token responden 400/400/401 con mensajes claros.

### Fase 2 — Consulta (T5-T7)

- [x] **T5** — Búsqueda por nombre sobre 10.800 productos por cadena
      (`busqueda.ts`): normaliza, separa las unidades que el dump trae pegadas
      (`BSX25KG` → `bsx 25 kg`), traduce `cm3`→`ml`, saca las stopwords y
      matchea con límite de palabra. Rankea ponderando por largo del término
      (los números y las unidades pesan 1, las palabras su largo), así
      "mayonesa" gana sobre "natura" + "kg". Usa `word_similarity` (pg_trgm)
      como desempate.
- [x] **T6/T7** — Camino dedicado para `/consultar-precio` (`consulta.ts` +
      `chat.service.ts`): el comando se detecta en `preguntarAgente`, antes del
      agente. **No usa el modelo** — el tokenizador ya se queda con las palabras
      útiles, así que la respuesta se arma con los datos de la base. Es
      instantánea, gratis y no puede inventar un precio.
      *(Decisión: se descartó el tool del lado del servidor porque las 20
      herramientas actuales las ejecuta el desktop; un tool de servidor exigía
      tocar el ciclo del agente, que es la parte más delicada de Binny.)*

### Fase 3 — Panel (T8)

- [x] **T8** — Pantalla "Precios mayoristas" en el panel: tabla de cadenas
      cargadas (bandera, razón social y CUIT, productos, sucursales, fecha del
      dump y fecha de importación) + modal para subir el ZIP
      (`src/app/(panel)/precios-mayoristas/`, `src/actions/precios-mayoristas.ts`)
      y el ítem en la navegación. Compila y la ruta queda registrada.

### Fase 4 — Verificación (T9)

- [ ] **T9** — Verificador: los totales del dump coinciden con lo guardado.

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **La calidad de la búsqueda** es lo que hace o rompe la feature: *"coca cola 500 cm3"* tiene que encontrar `COCA-COLA 500ML` | Tokenizar + rankear; devolver los mejores 3-5 y que Binny pregunte si hay empate |
| R2 | **Necesita internet** (Binny vive en el backend) | Es una función "con conexión"; no rompe nada offline |
| R3 | **Volumen**: ~10.800 filas por cadena, cantidad de cadenas desconocida | El upsert mantiene el tamaño acotado (ver arriba) |
| R4 | El formato de los dumps puede cambiar sin aviso | Validar el encabezado y fallar con un mensaje claro |

## Criterios de aceptación

1. Subir el ZIP de MAKRO desde el panel deja la base con ~10.800 productos y 25 sucursales.
2. Subirlo dos veces **no duplica nada** (upsert).
3. `/consultar-precio sal fina` devuelve el precio por cadena.
4. Un producto que no existe se informa con honestidad (sin inventar).

## Progreso

- 2026-10-13 — Plan cerrado con el dueño. Rama creada.
- 2026-10-13 — **Fase 1 completa y verificada.** El dump real de MAKRO (176.703
  filas) entra en **1,6 s**: 24 sucursales y 10.827 productos. Subirlo dos veces
  da 0 creados / 10.827 actualizados (idempotente). Los tres caminos de error
  (falta un archivo, formato cambiado, sin token) responden con mensajes claros.
  Siguiente: Fase 2 (búsqueda + tool de Binny + `/consultar-precio`).
- 2026-10-13 — **Fase 2 completa.** La búsqueda resuelve los casos reales del
  dueño (`coca cola 500 cm3` → GASEO COCA COLA BTX500ML; `mayonesa natura 1 kg`
  → los MAYONESA) y el comando `/consultar-precio` responde **sin usar el
  modelo**, con los precios de la base. Queda la Fase 3 (pantalla de subida en
  el panel).
- 2026-10-13 — **Pedidos del dueño sobre la respuesta**: (1) cada precio guarda
  `importado_en` para que Binny sepa a qué fecha corresponde (SEPA actualiza a
  diario); (2) la respuesta aclara **"mayoristas"** de forma explícita —
  es lo más importante; (3) por defecto se responde en **tabla**, y si el
  comerciante pide lista/WhatsApp se devuelve en viñetas.
- 2026-10-13 — **Fase 3 completa** (pantalla del panel). Se probó con los ZIP
  reales: 5 cadenas cargadas (MAKRO, NINI, BASUALDO, MAXICONSUMO, YAGUAR),
  41.129 precios. Un ZIP (`sepa-68`) falla **correctamente**: viene en un
  formato v1 con columnas distintas y **vacío** (0 productos).
