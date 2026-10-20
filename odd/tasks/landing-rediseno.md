# Landing AIPOS — rediseño con design-taste-frontend

Objetivo: rediseñar la landing estática de AIPOS con el skill `design-taste-frontend`.
Repo: `backend_panel_administracion/landing` · Branch: sin commits (pedido explícito).
Runner: `astro build` + `node <skill>/scripts/inspect.mjs` (Chrome real, 1440/768/390).

## Specs

- **S1 — Alcance.** Rediseñar la landing existente en
  `/home/federico/Escritorio/POS/backend_panel_administracion/landing` siguiendo el run completo
  del skill: registrar el antes, elegir una dirección deal, idea + cosa viva, gate con
  `inspect.mjs`, crítica sobre capturas, capa de movimiento y reporte final.
- **S2 — Stack y contenido.** Mantener Astro 7 estático y sin dependencias nuevas. Conservar el
  contenido real: nombre AIPOS, módulos (ventas, stock, compras, proveedores, IA), offline,
  Windows, los 6 beneficios, los 3 pasos, los 8 tipos de comercio, el público, las 6 preguntas,
  WhatsApp `+54 9 266 503 4652`, mail `hola@binariodevlabs.com` y el crédito a Binario Dev Labs.
  Usar las capturas reales de `public/` y `public/galeria/`.
- **S3 — Sin JS.** Todo el contenido se lee sin JavaScript. El menú funciona con `<details>`. La
  galería sin JS sigue siendo enlaces reales a cada captura. El simulador muestra su estado final
  (venta registrada sin conexión) y su control sólo aparece con JS.
- **S4 — Sin commit.** No ejecutar `git commit` ni `git add` (instrucción explícita del usuario).
- **S5 — Gate.** 0 FAIL de `inspect.mjs` en 1440, 768 y 390; abrir todas las capturas del último
  round y escribir la crítica final. `lint.mjs` sin FAIL.

## Tasks

- T1 · Auditoría y antes (S1) — `inspect.mjs` en `.taste-skill/before`; lectura del código y de las
  capturas. Hecho.
- T2 · Dirección, idea y copy deck (S1) — dirección `editorial-report`; idea: el corte de internet
  como eje de la página y el ticket que sigue imprimiendo. Hecho.
- T3 · Sistema de diseño y página (S1, S2, S3) — hecho. `src/styles/site.css` + `src/pages/index.astro`.
  Tokens, Young Serif / Source Serif 4, campos azul/papel/negro/amarillo, hero con interruptor y ticket,
  mosaico de funciones, recibo de puesta en marcha, tres capítulos con capturas, lista póster, FAQ,
  cierre y pie.
- T4 · Galería y visor (S3) — hecho. Contact sheet 5x2 / 3 / 2 con label strip, visor reestilizado;
  keyboard, swipe, foco encerrado y enlaces reales sin JS.
- T5 · Gate, look y movimiento (S5) — hecho. `inspect.mjs`: 0 FAIL en 1440/768/390, 1 WARN
  (`no-footage`, sin clip honesto del producto); `lint.mjs`: 0 FAIL. Movimiento: titular enmascarado,
  entradas por partes, feedback y deriva lenta de las láminas. Reduced motion y sin JS verificados.
- T6 · Reporte (S1) — hecho: ver «Cierre».

## Log

- L1 · Pedido del usuario, textual: «En /home/federico/Escritorio/POS/backend_panel_administracion/landing
  tengo una landing page estática hecha con Astro. Quiero que uses el skill "design-taste-frontend"
  para rediseñar el sitio. Al terminar NO HAGAS COMMIT!!!»
- L2 · Antes: 12 FAIL y 8 WARN. La página actual es un SaaS oscuro genérico: glows, gradientes,
  kickers, tarjetas numeradas, sombras y pastillas. Lo propio (offline, el mostrador argentino, el
  ticket) no aparece en el diseño.
- L3 · Dirección deal: `editorial-report` (seed 207716189), Young Serif / Source Serif 4, campos
  planos ultramar/negro/amarillo. Redraws: `features` → `features-mosaic-of-unlike-tiles`,
  `how-it-works` → `how-it-works-itinerary-on-a-slip`, `list` → `list-poster-lines`,
  `gallery` → `gallery-tiles-with-label-strips` (las capturas reales sustituyen los word tiles),
  `showcase` → `showcase-portrait-on-its-own-ground` (tres capítulos con las capturas verticales).
- L4 · Idea: «En esta página, el corte de internet de un comercio argentino se vuelve el eje de la
  composición y un simulador: el ticket sigue imprimiendo con la conexión cortada». Cosa viva: el
  botón «Cortá la conexión» sobre un ticket de ejemplo con datos reales de la captura 04.
- L5 · Paleta: ultramar derivado del azul del logo (#16239f), papel hueso (#eeece5), tinta
  (#0b0b0c), amarillo (#f5d140) como único acento. Sin violeta de página (el violeta de Binny queda
  sólo dentro de la captura del producto).
- L6 · Sin commits por pedido explícito; el trabajo queda en el working tree.
- L7 · Antes: `inspect.mjs` 12 FAIL / 8 WARN. Después: 0 FAIL / 1 WARN en los tres anchos.
  `lint.mjs`: 0 FAIL. `astro build`: OK. Sin errores de consola.
- L8 · Pruebas funcionales: el interruptor pasa de `Conectada/En línea` a `Cortada/Sin conexión` y
  vuelve; el visor abre, avanza (1/10 → 2/10) y cierra con Escape devolviendo el foco; sin JS el
  interruptor no se muestra, el ticket queda en el estado final y las miniaturas son enlaces reales.
- L9 · Crítica final: 8.3 / 10 (diseño 8, usabilidad 8.5, creatividad 8.5, contenido 8.5). Sin
  problemas que un extraño note en la primera pasada. Puntos flojos asumidos: el campo amarillo de
  la primera baldosa de funciones, el aire bajo la respuesta de la IA junto a la lámina y el tamaño
  de las miniaturas de la hoja de contactos.
- L10 · Redraws y por qué: `features` → mosaico de baldosas distintas (seis beneficios no entran en
  las notas al margen de un solo panel); `how-it-works` → recibo de puesta en marcha (el proceso es
  un artefacto impreso); `list` → líneas de póster (la lista de comercios es un muro de palabras);
  `gallery` → baldosas con label strip (hay capturas reales, no faltan fotos); `showcase` → tres
  capítulos con las capturas verticales (el producto ya trae sus propias láminas).
- L11 · Imágenes: todas son capturas propias del producto en `public/` y `public/galeria/`; no se
  usaron fotografías de archivo ni se inventaron clientes, testimonios ni métricas. La venta del
  ticket (productos y precios) y las cifras del informe salen de las capturas reales del sistema.
  Las duraciones de puesta en marcha (4/15 min, «una tarde») son contenido de muestra a confirmar.

## Rehacer con referencia Apple (corrección del usuario)

- L12 · El usuario rechazó la dirección editorial: «Parece una web de 1995… Necesitaba algo ultra
  elegante, que comunique con claridad y simpleza». Pidió **Apple** como referencia. La dirección
  `editorial-report` quedó descartada.
- L13 · Nueva dirección: producto, no afiche. Blanco `#fff` y gris `#f5f5f7`, tinta `#1d1d1f`,
  Inter, azul de acción `#0071e3`, sombras suaves, radios de 12–20 px, nav translúcido de 48 px y
  pie tipo sitemap. Se quitaron el serif gigante, el ultramar, el amarillo, el ticket, el eje al 42 %
  y el interruptor.
- L14 · Estructura nueva: portada centrada con el panel real; recorrido por el producto con tres
  pantallas reales conmutables con radios y CSS; capítulo negro «La venta sigue» con el 0; seis
  funciones; tres pasos; galería 5×2; FAQ en acordeón; cierre y pie.
- L15 · Verificación: `astro build` OK; `inspect.mjs` 0 FAIL / 1 WARN (`no-footage`) con dos
  excepciones declaradas de la referencia Apple (`--allow shadow,hairline`: sombras suaves en las
  capturas y divisores de 1 px en nav/FAQ/pie). Lint del skill: marca esas mismas decisiones de
  estilo Apple; no son accidentes. Sin errores de consola. Probados el tour (radio → imagen),
  el menú móvil, el visor (abrir/cerrar/Escape) y el modo sin JS. La página quedó en 8.2 pantallas y
  491 palabras (antes 12.7 y 960).
- L16 · Sin commit, como pidió el usuario. El sitio sigue en el working tree; el dev server en
  `http://127.0.0.1:4321`.

- L17 · Corrección del usuario: el rediseño había reescrito su copy. Se restauró **todo el contenido
  original** desde `git show HEAD:landing/src/pages/index.astro`: beneficios, «Y además», pasos, las
  tres destacadas con sus bullets, el público, la bajada de la galería, las seis preguntas, el cierre
  y el pie. También el `<title>`, la meta description y los OG. Se volvió a la estructura original
  (portada, beneficios, pasos, tres destacadas, público, galería, preguntas, cierre, pie); se
  descartaron el tour segmentado y el capítulo negro, que no eran parte del brief.
- L18 · Única libertad visual: el envase Apple (Inter, blanco/gris, azul, capturas grandes, sombras
  suaves, kickers como etiquetas chicas). La galería pasó de carrusel a grilla 5×2 y se restauraron
  sus rótulos de grupo; en la portada se usa el panel plano en lugar de la captura inclinada /01.png.
  El copy de contenido está completo; el script de comparación contra git sólo detectó clases CSS y
  el alt de la portada.
- L19 · Gate final: `astro build` OK; `inspect.mjs` 0 FAIL / 1 WARN (`no-footage`) con las
  excepciones declaradas `eyebrow,shadow,hairline,headline-lines` (los kickers y el título largo son
  el copy del usuario; las sombras y divisores son la referencia Apple). Sin errores de consola.
  Sin JS, menú, FAQ y visor funcionan. Sin commit, por pedido del usuario.

- L20 · El usuario pidió la estética de https://pontiun.com/. Se inspeccionó el sitio en Chrome
  (1440/390): serif de display P22 Mackinac Pro 56/40, Manrope de texto, teal `#12658a`, blanco y
  `#f7f7f6`, borde `#e1e3e5`, radio 12, sombras suaves, mockups de navegador, cielo en la portada,
  CTA teal, pie en columnas. Se trasladó ese lenguaje a la landing sin tocar el copy: Fraunces como
  alternativa libre cercana a la Mackinac, Manrope exacta, los mismos colores y medidas, ventanas de
  navegador para las capturas, tarjetas de 1px, galería en tarjetas, cierre teal y pie de columnas.
- L21 · El copy se verificó otra vez contra `git show HEAD:landing/src/pages/index.astro`: las únicas
  cadenas largas que no aparecen son nombres de clases CSS y stacks de fuentes; no falta ninguna
  frase. Gate: `astro build` OK; `inspect.mjs` 0 FAIL / 1 WARN (`no-footage`) con las excepciones de
  estilo de Pontiun (gradiente del cielo, sombras de los mockups, tarjetas y hairlines, kickers del
  copy, escala tipográfica y gris de cuerpo). Sin errores de consola; sin JS funcionan menú, FAQ y
  visor. Sin commit.

- L22 · La landing pasó a ofrecer **dos versiones**: offline $35.000/mes (sin límites de usuarios ni productos, 500 mensajes de IA, datos locales, Windows) y online $45.000/mes (en la nube, 5 usuarios y 5.000 productos de muestra, 500 mensajes de IA). Se sumaron los accesos a `https://app.aipos.com.ar` (nav, menú móvil, tarjeta online, cierre, pie y FAQ) y un botón flotante de WhatsApp. El usuario pidió commit y push de la landing.
