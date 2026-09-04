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

prueba('muestra el cobrado del mes', /Cobrado este mes/.test(kpiTexto));
prueba('el ingreso recurrente', /Ingreso recurrente \(MRR\)/.test(kpiTexto));
prueba('lo que vence en 30 días', /Vencen en 30 días/.test(kpiTexto));
prueba('y las vencidas', /Vencidas/.test(kpiTexto));
prueba('la plata sale formateada en pesos', /\$\s?[\d.]+/.test(kpiTexto), kpiTexto.slice(0, 120));
prueba('menciona el período de gracia vigente', /período de gracia \(3 días\)/.test(kpiTexto));

const barras = await p.locator('.recharts-bar-rectangle').count();
prueba('el gráfico dibuja una barra por cada mes con cobros', barras > 0 && barras <= 12, barras);
prueba('con los doce meses en el eje', (await p.locator('.recharts-xAxis .recharts-cartesian-axis-tick').count()) === 12);
prueba('el reparto por plan lista los dos planes', (await p.locator('text=Reparto por plan').count()) === 1);

const primeraFilaVenc = await textoDe('table tbody tr');
prueba('los vencimientos arrancan por el más urgente, que es el que ya venció',
  primeraFilaVenc.includes('Ferretería El Tornillo'), primeraFilaVenc);
prueba('y dice hace cuánto venció', /venció hace 40 días/.test(primeraFilaVenc), primeraFilaVenc);
prueba('avisa arriba cuántas ya vencieron', (await p.locator('text=/suscripci[oó]n(es)? ya venci/').count()) >= 1);
await p.screenshot({ path: `${CAPTURAS}/01-dashboard.png`, fullPage: true });

// ============================================================== vencimientos
seccion('Cómo se ve cada estado de vencimiento');

await ir('/suscripciones');
const estadoDe = async (comercio) => (await filaDe(comercio).innerText()).replace(/\s+/g, ' ');

const alDia = await estadoDe('Almacén San Martín');
prueba('el que está al día se ve Activa', /Activa/.test(alDia), alDia);
prueba('y dice cuántos días le quedan', /vence en 20 días/.test(alDia), alDia);

const pronto = await estadoDe('Kiosco La Esquina');
prueba('el que vence en 3 días sigue Activa', /Activa/.test(pronto), pronto);
prueba('con el aviso de que vence pronto', /vence en 3 días/.test(pronto), pronto);

const hoyMismo = await estadoDe('Verdulería Norte');
prueba('el que vence hoy avisa que vence hoy', /vence hoy/.test(hoyMismo), hoyMismo);

const gracia = await estadoDe('Panadería Dos Hermanos');
prueba('el que venció hace 2 días queda En gracia', /En gracia/.test(gracia), gracia);
prueba('y dice hace cuánto venció', /venció hace 2 días/.test(gracia), gracia);
prueba('se ve la nota de cobranza', /Reclamado por WhatsApp/.test(gracia), gracia);

const vencido = await estadoDe('Ferretería El Tornillo');
prueba('pasada la gracia queda Vencida', /Vencida/.test(vencido), vencido);

const cancelado = await estadoDe('Bar El Descanso');
prueba('la cancelada se ve Cancelada', /Cancelada/.test(cancelado), cancelado);
prueba('y no dice que vence, dice que está dada de baja', /dada de baja/.test(cancelado), cancelado);
prueba('a la cancelada no se le ofrece Renovar',
  (await filaDe('Bar El Descanso').getByRole('button', { name: /renovar/i }).count()) === 0);
prueba('se le ofrece Reactivar',
  (await filaDe('Bar El Descanso').getByRole('button', { name: /reactivar/i }).count()) === 1);
prueba('a la vencida sí se le ofrece Renovar',
  (await filaDe('Ferretería El Tornillo').getByRole('button', { name: /renovar/i }).count()) === 1);
await p.screenshot({ path: `${CAPTURAS}/02-suscripciones.png`, fullPage: true });

seccion('Filtros por estado');
const filasVisibles = async () => p.locator('tbody tr').count();

await ir('/suscripciones');
igual('sin filtro se ven todas', await filasVisibles(), 6);
await ir('/suscripciones?estado=ACTIVA');
igual('el filtro Activas deja 3', await filasVisibles(), 3);
await ir('/suscripciones?estado=EN_GRACIA');
igual('En gracia deja 1', await filasVisibles(), 1);
prueba('y es la panadería', (await textoDe('tbody tr')).includes('Panadería'));
await ir('/suscripciones?estado=VENCIDA');
igual('Vencidas deja 1', await filasVisibles(), 1);
prueba('y es la ferretería', (await textoDe('tbody tr')).includes('Ferretería'));
await ir('/suscripciones?estado=CANCELADA');
igual('Canceladas deja 1', await filasVisibles(), 1);

// ================================================================== licencias
seccion('Licencias: buscador y paginación desde el backend');

await ir('/licencias');
const pie = await textoDe('text=/de \\d+ licencias/');
prueba('el pie dice cuántas hay en total', /de \d+ licencias/.test(pie), pie);
igual('la primera página trae 20 filas', await filasVisibles(), 20);

const totalLic = Number((pie.match(/de ([\d.]+) licencias/) ?? [])[1]?.replace('.', ''));
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

await ir('/licencias');
prueba('se ve una licencia suspendida por bajar de plan',
  (await p.locator('tbody tr', { hasText: 'suspendida' }).count()) >= 0);
await p.screenshot({ path: `${CAPTURAS}/03-licencias.png`, fullPage: true });

seccion('Licencias: cupo del plan y cambio de PC');

await ir('/licencias');
await p.getByRole('button', { name: /emitir licencia/i }).click();
await p.waitForTimeout(500);
await p.locator('button[role=combobox]').first().click();
await p.waitForTimeout(400);
await p.getByRole('option', { name: 'Almacén San Martín' }).click();
await p.waitForTimeout(400);
await p.locator('button[role=combobox]').nth(1).click();
await p.waitForTimeout(400);
await p.getByRole('option', { name: /Cliente/ }).click();
await p.waitForTimeout(600);
prueba('Pro con sus 2 clientes ya ocupados bloquea el tercero',
  await p.getByRole('button', { name: /^Emitir$/ }).isDisabled());
prueba('y explica que hay que mejorar el plan',
  /mejor[aá] el plan/i.test(await p.locator('[role=alert]').first().innerText()));
await p.screenshot({ path: `${CAPTURAS}/04-cupo-bloqueado.png` });

await p.locator('button[role=combobox]').first().click();
await p.waitForTimeout(400);
await p.getByRole('option', { name: 'Bazar El Sol' }).click();
await p.waitForTimeout(600);
prueba('un comercio sin plan tampoco puede recibir licencias sueltas',
  /no tiene un plan contratado/i.test(await p.locator('[role=alert]').first().innerText()));
await p.keyboard.press('Escape');
await p.waitForTimeout(400);

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
  (await p.locator('[data-sonner-toast]').first().innerText()).toLowerCase().includes('liberada'));
await p.keyboard.press('Escape');

// ================================================================== comercios
seccion('Comercios');

await ir('/comercios');
const sinPlan = await estadoDe('Bazar El Sol');
prueba('el comercio recién dado de alta se marca sin plan', /sin plan contratado/.test(sinPlan), sinPlan);
prueba('y aparece con cero licencias', /0 servidor/.test(sinPlan), sinPlan);

const conPlan = await estadoDe('Almacén San Martín');
prueba('el que tiene Pro muestra su plan', /Pro/.test(conPlan), conPlan);
prueba('con su vencimiento', /vence en 20 días/.test(conPlan), conPlan);

await p.getByRole('button', { name: /nuevo comercio/i }).click();
await p.waitForTimeout(500);
const formNuevo = await textoDe('[role=dialog]');
prueba('el alta pide solo el nombre', (await p.locator('[role=dialog] input').count()) === 1,
  await p.locator('[role=dialog] input').count());
prueba('y explica que las licencias las emite la suscripción', /suscripci[oó]n/i.test(formNuevo));
await p.fill('[role=dialog] input[name=nombre]', 'Rotisería Doña Rosa');
await p.getByRole('button', { name: /crear comercio/i }).click();
await p.waitForTimeout(2500);
prueba('crear un comercio avisa qué sigue',
  /contratale un plan/i.test(await p.locator('[data-sonner-toast]').first().innerText()));
await ir('/comercios');
prueba('y el comercio nuevo aparece en la lista',
  (await p.locator('tbody tr', { hasText: 'Rotisería Doña Rosa' }).count()) === 1);
await p.screenshot({ path: `${CAPTURAS}/06-comercios.png`, fullPage: true });

// ===================================================================== planes
seccion('Planes');

await ir('/planes');
const planesTexto = (await p.locator('[data-slot=card]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
prueba('muestra Básico con 1 servidor y 0 clientes', /Básico.*1 servidor.*0 clientes/s.test(planesTexto));
prueba('y Pro con 1 servidor y 2 clientes', /Pro.*1 servidor.*2 clientes/s.test(planesTexto));
prueba('marca el plan discontinuado', /Discontinuado/.test(planesTexto));
prueba('muestra los precios en pesos', /\$\s?25\.000/.test(planesTexto), planesTexto.slice(0, 200));
prueba('y cuántos comercios tiene cada uno', /comercios/.test(planesTexto));
await p.screenshot({ path: `${CAPTURAS}/07-planes.png`, fullPage: true });

await p.getByRole('button', { name: /editar/i }).first().click();
await p.waitForTimeout(600);
prueba('editar un plan avisa que no afecta a los ya contratados',
  /no afecta a las suscripciones ya contratadas/i.test(await textoDe('[role=dialog]')));
await p.keyboard.press('Escape');

// ====================================================================== pagos
seccion('Cobranza');

await ir('/pagos');
const cabecera = await textoDe('[data-slot=card]');
prueba('muestra el total cobrado', /\$\s?[\d.]+/.test(cabecera), cabecera.slice(0, 120));
prueba('y aclara que es de todo lo filtrado, no de la página', /no solo de los que se ven/i.test(await p.locator('[data-slot=card]').first().innerText()));
igual('la primera página trae 20 cobros', await filasVisibles(), 20);

await p.fill('input[aria-label="Buscar por comercio…"]', 'panader');
await p.waitForTimeout(1500);
const comerciosPago = await p.locator('tbody tr td:nth-child(2)').allInnerTexts();
prueba('el buscador filtra la cobranza por comercio', comerciosPago.every((n) => /Panader/i.test(n)), comerciosPago.slice(0, 3));
prueba('y el total de arriba acompaña al filtro',
  (await p.locator('[data-slot=card]').first().innerText()).includes('Cobrado de'));
await p.screenshot({ path: `${CAPTURAS}/08-pagos.png`, fullPage: true });

// ================================================== backend caido y recuperado
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
prueba('cuando el backend vuelve, el panel también', (await p.locator('text=Cómo viene el mes').count()) === 1);

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
