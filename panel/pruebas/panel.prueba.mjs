/**
 * Pruebas del panel de punta a punta, con un navegador real contra el build
 * de produccion. Lo que se comprueba es lo que ve una persona.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Donde escucha el panel ya compilado y donde dejar las capturas de pantalla.
const BASE = process.env.PANEL_URL ?? 'http://localhost:3000';
const CAPTURAS = process.env.CAPTURAS ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'capturas');
mkdirSync(CAPTURAS, { recursive: true });

let total = 0, fallas = 0;
let etapa = 'arranque';
const erroresDeConsola = [];

function seccion(t) { etapa = t; console.log(`\n${t}`); }
function prueba(etiqueta, ok, detalle) {
  total++;
  if (ok) return console.log(`  ok    ${etiqueta}`);
  fallas++;
  console.log(`  FALLA ${etiqueta}`);
  if (detalle !== undefined) console.log(`        obtenido: ${JSON.stringify(detalle)}`);
}
function igual(etiqueta, obtenido, esperado) {
  prueba(`${etiqueta} (esperado ${JSON.stringify(esperado)})`, JSON.stringify(obtenido) === JSON.stringify(esperado), obtenido);
}

// CHROMIUM solo hace falta si Playwright no trae su propio navegador.
const navegador = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, locale: 'es-AR' });
const p = await contexto.newPage();
p.on('pageerror', (e) => erroresDeConsola.push({ etapa, texto: `pageerror: ${e.message}` }));
p.on('console', (m) => { if (m.type() === 'error') erroresDeConsola.push({ etapa, texto: m.text().slice(0, 160) }); });

const ir = (ruta) => p.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' });
const textoDe = async (sel) => (await p.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const filaDe = (nombre) => p.locator('tbody tr').filter({ hasText: nombre }).first();
const filasVisibles = () => p.locator('tbody tr').count();
const estadoDe = async (nombre) => (await filaDe(nombre).innerText()).replace(/\s+/g, ' ').trim();

// El simulado guarda estado: se lo deja como nuevo para que la suite se pueda
// correr las veces que haga falta sin reiniciar el proceso.
const API = process.env.API_URL ?? 'http://localhost:4000';
await fetch(`${API}/__reiniciar`).catch(() => {});

// ============================================================ sesion y guardas
seccion('Sesión y guardas de acceso');

await ir('/dashboard');
prueba('sin sesión, /dashboard manda al login', p.url().includes('/login'));
prueba('y recuerda a dónde quería ir', p.url().includes('volver=%2Fdashboard'), p.url());

await ir('/suscripciones');
prueba('cualquier ruta privada también', p.url().includes('/login'));

await ir('/login');
await p.fill('input[name=email]', 'joaquin@binario.com');
await p.fill('input[name=password]', 'contrasena-mala');
await p.click('button[type=submit]');
await p.waitForTimeout(1200);
prueba('con contraseña incorrecta no entra', p.url().includes('/login'));
prueba('y muestra el motivo', (await p.locator('[role=alert]').first().innerText()).toLowerCase().includes('credenciales'));

await p.fill('input[name=email]', 'joaquin@binario.com');
await p.fill('input[name=password]', '123456');
await Promise.all([p.waitForURL('**/dashboard', { timeout: 20000 }), p.click('button[type=submit]')]);
prueba('con las credenciales correctas entra al dashboard', p.url().includes('/dashboard'));

await ir('/login');
prueba('ya logueado, /login redirige al panel', p.url().includes('/dashboard'), p.url());

await ir('/una-ruta-que-no-existe');
prueba('una ruta inexistente muestra el 404 propio', (await p.content()).includes('Esta página no existe'));

// ================================================================== dashboard
seccion('Dashboard');

await ir('/dashboard');
const kpis = await p.locator('[data-slot=card]').allInnerTexts();
const kpiTexto = kpis.join(' | ').replace(/\s+/g, ' ');

// El dashboard lista comercios, licencias, planes y consumo de chat. Los
// números de plata viven en Cobranza y los vencimientos en Suscripciones: acá se
// comprueba lo que esta pantalla muestra.
prueba('resume cuántos comercios hay', /Comercios\s+\d+/.test(kpiTexto), kpiTexto.slice(0, 120));
prueba('las licencias servidor activas', /Licencias servidor activas/.test(kpiTexto));
prueba('los planes activos', /Planes activos/.test(kpiTexto));
prueba('el consumo de chat del mes', /Consumo chat del mes/.test(kpiTexto));
prueba('y la tabla de comercios con su plan', /Comercios y estado de su plan/.test(kpiTexto));
prueba('explica de dónde sale el plan', /no una suscripción/.test(kpiTexto));

const filasComercios = await p.locator('table tbody tr').allInnerTexts();
prueba('la tabla lista comercios', filasComercios.length > 0, filasComercios.length);
prueba('cada comercio ofrece ver sus claves', /Ver claves/.test(filasComercios[0] ?? ''), (filasComercios[0] ?? '').slice(0, 110));
await p.screenshot({ path: `${CAPTURAS}/01-dashboard.png`, fullPage: true });

// ============================================================== vencimientos
// Las pantallas de suscripciones y cobranza se quitaron del panel en el rediseño
// (commit d8bf4e1, 2026-10-07): ya no existen /suscripciones ni /pagos, y el panel
// responde "Esta página no existe". Las reglas que mostraban —vencimiento, días de
// gracia, cobros y deuda— siguen cubiertas en backend/pruebas (casos de borde de
// vencimiento y cobranza). Si esas pantallas vuelven, estas secciones se recuperan
// del historial del archivo.

seccion('Licencias: buscador y paginación desde el backend');

// La pantalla se llama Claves y el paginador cuenta claves, no licencias.
await ir('/licencias');
const pie = await textoDe('text=/de \\d+ claves/');
prueba('el pie dice cuántas hay en total', /de \d+ claves/.test(pie), pie);
igual('la primera página trae 20 filas', await filasVisibles(), 20);

const totalLic = Number((pie.match(/de ([\d.]+) claves/) ?? [])[1]?.replace(/\./g, ''));
prueba('hay más de una página', totalLic > 20, totalLic);

await ir('/licencias?pagina=2');
prueba('la página 2 trae filas', (await filasVisibles()) > 0);
prueba('y el paginador lo refleja', (await p.locator('text=/Página 2 de/').count()) === 1);

await ir('/licencias');
await p.fill('input[aria-label="Buscar por comercio…"]', 'kiosco');
await p.waitForTimeout(1500);
prueba('el buscador queda en la URL', p.url().includes('q=kiosco'), p.url());
const nombres = await p.locator('tbody tr td:nth-child(2)').allInnerTexts();
prueba('y solo muestra ese comercio', nombres.every((n) => /Kiosco/i.test(n)), nombres.slice(0, 3));

await ir('/licencias?q=zzzz');
igual('una búsqueda sin resultados no rompe', await filasVisibles(), 1);
prueba('y explica que no hay coincidencias', (await textoDe('tbody tr')).includes('zzzz'));

await ir('/licencias?q=kiosco');
prueba('se ve una clave suspendida por bajar de plan',
  (await p.locator('tbody tr', { hasText: 'suspendida' }).count()) >= 1);
await p.screenshot({ path: `${CAPTURAS}/03-licencias.png`, fullPage: true });

seccion('Licencias: generar sueltas y cambio de PC');

// Las claves se generan sueltas ("libres") y el cupo del plan se controla al
// asignarlas en el alta, no acá: no hay emisión directa contra un comercio.
await ir('/licencias');
const totalAntes = Number(((await textoDe('text=/de \\d+ claves/')).match(/de ([\d.]+) claves/) ?? [])[1]);
await p.getByRole('button', { name: /generar claves/i }).click();
await p.waitForTimeout(500);
const dialogoGenerar = await textoDe('[role=dialog]');
prueba('generar claves explica que el cupo se controla al asignar',
  /cupo del plan se controla/i.test(dialogoGenerar), dialogoGenerar.slice(0, 160));
prueba('pide la cantidad con 1 por defecto',
  (await p.locator('[role=dialog] input[name=cantidad]').inputValue()) === '1');
await p.fill('[role=dialog] input[name=cantidad]', '2');
await p.locator('[role=dialog]').getByRole('button', { name: 'Generar', exact: true }).click();
await p.waitForTimeout(2000);
prueba('y avisa que ya se pueden copiar desde la tabla',
  (await p.locator('[data-sonner-toast]', { hasText: /desde la tabla/i }).count()) === 1);
const totalDespues = Number(((await textoDe('text=/de \\d+ claves/')).match(/de ([\d.]+) claves/) ?? [])[1]);
igual('la tabla trae las 2 nuevas', totalDespues, totalAntes + 2);
await p.screenshot({ path: `${CAPTURAS}/04-generar-claves.png` });

await ir('/licencias?q=almac');
const conInstalacion = p.locator('tbody tr').filter({ has: p.getByRole('button', { name: /instalaciones/i }) }).first();
prueba('solo las licencias con máquinas activadas ofrecen Instalaciones',
  (await conInstalacion.count()) === 1);
await conInstalacion.getByRole('button', { name: /instalaciones/i }).click();
await p.waitForTimeout(600);
const dialogo = await textoDe('[role=dialog]');
prueba('el diálogo muestra la máquina activada', /última validación/i.test(dialogo), dialogo.slice(0, 200));
prueba('y advierte sobre el momento de liberar', /vuelve a tomar el puesto/i.test(dialogo));
await p.screenshot({ path: `${CAPTURAS}/05-instalaciones.png` });

await p.getByRole('button', { name: /^Liberar$/ }).click();
await p.waitForTimeout(300);
prueba('liberar pide confirmación antes de hacerlo',
  (await p.getByRole('button', { name: /^Confirmar$/ }).count()) === 1);
await p.getByRole('button', { name: /^Confirmar$/ }).click();
await p.waitForTimeout(2000);
prueba('y avisa cuando la liberó',
  (await p.locator('[data-sonner-toast]', { hasText: /liberada/i }).count()) === 1);
await p.keyboard.press('Escape');

// ================================================================== comercios
seccion('Comercios');

// La tabla muestra plan directo, cupo de servidores y deuda estimada: ya no
// hay vencimiento ni suscripción a la vista.
await ir('/comercios');
const sinPlan = await estadoDe('Bazar El Sol');
prueba('el comercio recién dado de alta se marca sin plan', /Sin plan/.test(sinPlan), sinPlan);
prueba('y aparece con cero claves', /0\/— servidor/.test(sinPlan), sinPlan);
prueba('sin plan no hay deuda que estimar', /Al día/.test(sinPlan), sinPlan);

const conPlan = await estadoDe('Almacén San Martín');
prueba('el que tiene Pro muestra su plan', /Pro/.test(conPlan), conPlan);
prueba('con el cupo de una caja que declara ese plan', /\/1 servidor/.test(conPlan), conPlan);
prueba('y al día', /Al día/.test(conPlan), conPlan);

const vencido = await estadoDe('Ferretería El Tornillo');
prueba('el vencido muestra su deuda estimada', /Debe \d+ período/.test(vencido), vencido);

// El alta es una pantalla propia: nombre, plan y claves libres a asignar, con
// el cupo del plan validado al asignar.
await p.getByRole('link', { name: /nuevo comercio/i }).click();
await p.waitForURL('**/comercios/alta', { timeout: 20000 });
prueba('el alta es una pantalla propia', p.url().includes('/comercios/alta'), p.url());
const altaTexto = await textoDe('main');
prueba('y explica que el cupo se valida al asignar', /cupo del plan se valida/i.test(altaTexto));
prueba('ofrece los planes en venta con su cupo', /Básico — 1 servidor/.test(altaTexto) && /Pro — 1 servidor/.test(altaTexto));

await p.fill('input[name=nombre]', 'Cotillón Fantasía');
await p.getByRole('combobox').click();
await p.waitForTimeout(400);
await p.getByRole('option', { name: /Básico/ }).click();
await p.waitForTimeout(400);
await p.getByRole('checkbox').nth(0).check();
await p.getByRole('checkbox').nth(1).check();
await p.getByRole('button', { name: /crear comercio/i }).click();
await p.waitForTimeout(2000);
prueba('asignar más claves que el cupo se rechaza',
  /mejora el plan/i.test(await p.locator('[role=alert]').first().innerText()));
prueba('y el comercio no se crea',
  (await ir('/comercios'), await p.locator('tbody tr', { hasText: 'Cotillón Fantasía' }).count()) === 0);

await ir('/comercios/alta');
await p.fill('input[name=nombre]', 'Rotisería Doña Rosa');
await p.getByRole('combobox').click();
await p.waitForTimeout(400);
await p.getByRole('option', { name: /Pro/ }).click();
await p.waitForTimeout(400);
await p.getByRole('checkbox').nth(0).check();
prueba('elegir claves muestra cuántas van', /1 clave seleccionada/.test(await textoDe('main')));
await p.getByRole('button', { name: /crear comercio/i }).click();
await p.waitForTimeout(2500);
const confirmacion = await textoDe('[role=alert]');
prueba('crear un comercio avisa qué quedó asociado', /quedó creado.*1 clave asignada/.test(confirmacion), confirmacion.slice(0, 160));
await ir('/comercios');
prueba('y el comercio nuevo aparece en la lista con su plan',
  /Rotisería Doña Rosa.*Pro/.test(await estadoDe('Rotisería Doña Rosa')));
await p.screenshot({ path: `${CAPTURAS}/06-comercios.png`, fullPage: true });

// ===================================================================== planes
seccion('Planes');

await ir('/planes');
const tarjeta = (nombre) => p.locator('[data-slot=card]', { hasText: nombre }).first();
const basico = (await tarjeta('Básico').innerText()).replace(/\s+/g, ' ');
prueba('Básico muestra su cupo de 1 servidor', /1 servidor/.test(basico), basico.slice(0, 120));
prueba('con su cupo de chat', /400.*mensajes de Binny/.test(basico));
prueba('sus precios', /\$\s?25\.000.*\/ mes/.test(basico) && /\$\s?250\.000 al año/.test(basico));
prueba('y cuántos comercios lo usan', /3 comercios con este plan/.test(basico));
const pro = (await tarjeta('Pro').innerText()).replace(/\s+/g, ' ');
prueba('Pro trae más chat y la Rotisería recién creada', /1500.*mensajes de Binny/.test(pro) && /4 comercios con este plan/.test(pro));
const viejo = await tarjeta('Plan viejo').innerText();
prueba('marca el plan discontinuado', /Discontinuado/.test(viejo));
prueba('sin comercios encima', /0 comercios con este plan/.test(viejo));
prueba('y los activos en venta', (await p.getByText('En venta', { exact: true }).count()) === 2);
await p.screenshot({ path: `${CAPTURAS}/07-planes.png`, fullPage: true });

await p.getByRole('button', { name: /editar/i }).first().click();
await p.waitForTimeout(600);
prueba('editar un plan avisa que no afecta a los ya contratados',
  /no afecta a las suscripciones ya contratadas/i.test(await textoDe('[role=dialog]')));
await p.keyboard.press('Escape');

// ====================================================================== pagos
seccion('Cuando el backend no responde');

await fetch(`${API}/__caido?v=1`).catch(() => {});
await p.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(2500);
const pantalla = (await p.content());
prueba('el panel no se rompe: muestra un error entendible', /No se pudo cargar la sección|no se pudo conectar/i.test(pantalla));
prueba('y sugiere revisar el backend y la base', /puerto 4000|Docker/i.test(pantalla));
await p.screenshot({ path: `${CAPTURAS}/09-backend-caido.png` });

await fetch(`${API}/__caido?v=0`).catch(() => {});
await ir('/dashboard');
prueba('cuando el backend vuelve, el panel también', (await p.locator('text=Cómo están los comercios').count()) === 1);

// ==================================================================== cierre
seccion('Errores de JavaScript durante toda la corrida');
// Durante el corte del backend los errores son el objetivo de la prueba.
// El corte de backend y la visita a propósito a una ruta inexistente generan
// errores de red que son justamente lo que se estaba probando.
const esperados = (e) =>
  e.etapa === 'Cuando el backend no responde' ||
  /favicon|ERR_CONNECTION|Failed to fetch|net::|status of 404/i.test(e.texto);
const relevantes = erroresDeConsola.filter((e) => !esperados(e));
prueba('ninguno fuera del corte de backend provocado a propósito', relevantes.length === 0, relevantes.slice(0, 5));
if (erroresDeConsola.some(esperados)) {
  console.log(`        (${erroresDeConsola.filter(esperados).length} errores durante el corte provocado, que es lo que se estaba probando)`);
}

console.log(`\n${'-'.repeat(60)}`);
console.log(fallas === 0 ? `Todo en orden: ${total - fallas}/${total}` : `${fallas} FALLAS de ${total} comprobaciones`);
console.log(`${'-'.repeat(60)}\n`);

await navegador.close();
process.exit(fallas === 0 ? 0 : 1);
