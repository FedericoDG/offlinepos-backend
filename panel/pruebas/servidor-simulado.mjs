/**
 * Backend simulado para las pruebas del panel.
 *
 * Responde los mismos contratos que el backend real y mantiene estado, para
 * poder ejercitar los flujos completos. La logica de negocio de verdad ya se
 * prueba aparte contra los servicios reales; esto existe para poner al panel
 * frente a escenarios concretos, sobre todo de vencimiento.
 */
import http from 'node:http';

const DIA = 86400000;
const DIAS_GRACIA = 3;
const hoy = Date.now();
const iso = (ms) => new Date(ms).toISOString();
/** Igual que el backend: los dias que se muestran son de calendario. */
const soloDia = (d) => { const f = new Date(d); return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime(); };
const diasDeCalendario = (fecha) => Math.round((soloDia(fecha) - soloDia(hoy)) / DIA);
const finDelDia = (() => { const f = new Date(hoy); f.setHours(23, 30, 0, 0); return f.getTime(); })();
/** 'HOY' cae siempre en la fecha de hoy, no importa a que hora se corra. */
const enDias = (d) => (d === 'HOY' ? iso(finDelDia) : iso(hoy + d * DIA));
/** Para las cuentas que necesitan el numero (periodos, historial de cobros). */
const nro = (d) => (d === 'HOY' ? 0 : d);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
  id: 'a1', email: 'joaquin@binario.com', rol: 'ADMINISTRADOR',
  exp: Math.floor(hoy / 1000) + 28800,
})}.firma-de-prueba`;

// ------------------------------------------------------------------- estado

const planes = [
  { id: 'p-basico', codigo: 'BASICO', nombre: 'Básico', descripcion: 'Un solo servidor. La caja del comercio y nada más.', precio_mensual: 25000, precio_anual: 250000, moneda: 'ARS', max_servidores: 1, max_clientes: 0, chat_mensajes_mes: 400, activo: true, suscripciones_activas: 3, createdAt: enDias(-300), updatedAt: enDias(-300) },
  { id: 'p-pro', codigo: 'PRO', nombre: 'Pro', descripcion: 'Un servidor y hasta dos clientes conectados a él.', precio_mensual: 45000, precio_anual: 450000, moneda: 'ARS', max_servidores: 1, max_clientes: 2, chat_mensajes_mes: 1500, activo: true, suscripciones_activas: 2, createdAt: enDias(-300), updatedAt: enDias(-300) },
  { id: 'p-viejo', codigo: 'LEGACY', nombre: 'Plan viejo', descripcion: 'Discontinuado.', precio_mensual: 12000, precio_anual: null, moneda: 'ARS', max_servidores: 1, max_clientes: 1, chat_mensajes_mes: 200, activo: false, suscripciones_activas: 0, createdAt: enDias(-500), updatedAt: enDias(-500) },
];

/** Un comercio por cada situacion que el panel tiene que saber mostrar. */
const CASOS = [
  { id: 'c-aldia',    nombre: 'Almacén San Martín',    plan: 'p-pro',    vence: 20,  estado: 'ACTIVA' },
  { id: 'c-pronto',   nombre: 'Kiosco La Esquina',     plan: 'p-basico', vence: 3,   estado: 'ACTIVA' },
  { id: 'c-hoy',      nombre: 'Verdulería Norte',      plan: 'p-basico', vence: 'HOY', estado: 'ACTIVA' },
  { id: 'c-gracia',   nombre: 'Panadería Dos Hermanos',plan: 'p-basico', vence: -2,  estado: 'ACTIVA' },
  { id: 'c-vencido',  nombre: 'Ferretería El Tornillo',plan: 'p-pro',    vence: -40, estado: 'ACTIVA' },
  { id: 'c-cancel',   nombre: 'Bar El Descanso',       plan: 'p-pro',    vence: 15,  estado: 'CANCELADA' },
];
const COMERCIO_SIN_PLAN = { id: 'c-sinplan', nombre: 'Bazar El Sol' };

function estadoEfectivo(estado, venceEn) {
  if (estado === 'CANCELADA') return 'CANCELADA';
  const atraso = hoy - new Date(venceEn).getTime();
  if (atraso <= 0) return 'ACTIVA';
  if (atraso <= DIAS_GRACIA * DIA) return 'EN_GRACIA';
  return 'VENCIDA';
}

let secuencia = 0;
const comercios = [];
const licencias = [];
const activaciones = [];
const suscripciones = [];
const pagos = [];

/**
 * Deja los datos como al arranque. La suite la llama antes de empezar, asi se
 * puede correr las veces que haga falta sin reiniciar el proceso a mano.
 */
function sembrar() {
  secuencia = 0;
  for (const a of [comercios, licencias, activaciones, suscripciones, pagos]) a.length = 0;

for (const caso of CASOS) {
  const plan = planes.find((p) => p.id === caso.plan);
  // El plan es el asignado DIRECTO al comercio (asi se da de alta hoy): el
  // listado lo muestra y de ahi sale el cupo de claves. La suscripcion queda
  // como camino viejo, que el backend tambien mira para la deuda.
  comercios.push({ id: caso.id, nombre: caso.nombre, plan_id: plan.id, createdAt: enDias(-200), updatedAt: enDias(-200) });

  const venceEn = enDias(caso.vence);
  suscripciones.push({
    id: `s-${caso.id}`, comercio_id: caso.id, plan_id: plan.id, estado: caso.estado,
    ciclo: 'MENSUAL', precio_pactado: plan.precio_mensual, moneda: 'ARS',
    inicia_en: enDias(nro(caso.vence) - 30), vence_en: venceEn,
    cancelada_en: caso.estado === 'CANCELADA' ? enDias(-5) : null,
    nota: caso.id === 'c-gracia' ? 'Reclamado por WhatsApp el lunes.' : null,
    createdAt: enDias(-200), updatedAt: enDias(-1),
  });

  // Licencias segun el cupo del plan.
  const emitir = (rol, cuantas, estado = 'activa') => {
    for (let i = 0; i < cuantas; i++) {
      const id = `l-${++secuencia}`;
      licencias.push({
        id, comercio_id: caso.id, rol, estado, clave_hash: 'cifrada',
        clave_original: `LIC-2026-${String(secuencia).padStart(4, '0')}-${rol === 'SERVIDOR' ? 'SRV0' : 'CLI0'}`,
        max_activaciones: 1, activado_en: null, createdAt: enDias(-200 + secuencia), updatedAt: enDias(-1),
      });
    }
  };
  emitir('SERVIDOR', plan.max_servidores);
  emitir('CLIENTE', plan.max_clientes);

  // Historia de cobranza.
  for (let m = 1; m <= 6; m++) {
    pagos.push({
      id: `pg-${caso.id}-${m}`, suscripcion_id: `s-${caso.id}`, monto: plan.precio_mensual, moneda: 'ARS',
      metodo: ['TRANSFERENCIA', 'EFECTIVO', 'MERCADO_PAGO'][m % 3],
      pagado_en: enDias(nro(caso.vence) - 30 * m), periodo_desde: enDias(nro(caso.vence) - 30 * m), periodo_hasta: enDias(nro(caso.vence) - 30 * (m - 1)),
      referencia: `TRF-${caso.id.slice(2, 6).toUpperCase()}-${m}`, nota: null,
      createdAt: enDias(-200), updatedAt: enDias(-200),
    });
  }
}

// El comercio recien dado de alta: sin plan y sin licencias.
comercios.push({ ...COMERCIO_SIN_PLAN, createdAt: enDias(-1), updatedAt: enDias(-1) });

// Una licencia suspendida por haber bajado de plan, y otra con su cupo gastado
// (la maquina vieja): son los dos casos que el panel tiene que saber mostrar.
licencias.push({
  id: 'l-suspendida', comercio_id: 'c-pronto', rol: 'CLIENTE', estado: 'suspendida',
  clave_hash: 'cifrada', clave_original: 'LIC-2026-SUSP-0001', max_activaciones: 1,
  activado_en: null, createdAt: enDias(-90), updatedAt: enDias(-30),
});
const licenciaConPc = licencias.find((l) => l.comercio_id === 'c-aldia' && l.rol === 'SERVIDOR');
licenciaConPc.max_activaciones = 0;
licenciaConPc.activado_en = enDias(-120);
activaciones.push({
  id: 'act-pc-vieja', licencia_id: licenciaConPc.id,
  instalacion_id: 'a3f1c9e07b2d4856a1f0c3e9d7b48512a3f1c9e07b2d4856a1f0c3e9d7b48512',
  ultima_validacion: enDias(-4), createdAt: enDias(-120), updatedAt: enDias(-4),
});

// Relleno para que la paginacion tenga varias paginas de verdad.
for (let i = 0; i < 40; i++) {
  const c = comercios[i % CASOS.length];
  licencias.push({
    id: `l-relleno-${i}`, comercio_id: c.id, rol: i % 3 === 0 ? 'SERVIDOR' : 'CLIENTE',
    estado: 'activa', clave_hash: 'cifrada',
    clave_original: `LIC-2026-R${String(i).padStart(3, '0')}-${String((i * 37) % 10000).padStart(4, '0')}`,
    max_activaciones: 1, activado_en: null, createdAt: enDias(-i - 2), updatedAt: enDias(-1),
  });
  pagos.push({
    id: `pg-relleno-${i}`, suscripcion_id: `s-${c.id}`, monto: 25000, moneda: 'ARS',
    metodo: 'TRANSFERENCIA', pagado_en: enDias(-i - 2), periodo_desde: enDias(-i - 62), periodo_hasta: enDias(-i - 32),
    referencia: `TRF-R${i}`, nota: null, createdAt: enDias(-i - 2), updatedAt: enDias(-i - 2),
  });
}

// Claves sueltas ("libres"): sin comercio, para asignar en el alta. El alta las
// pide con `?libres=1` y el cupo del plan se valida al asignarlas, no al
// generarlas — igual que el backend.
for (let i = 0; i < 5; i++) {
  licencias.push({
    id: `l-libre-${i}`, comercio_id: null, rol: 'SERVIDOR', estado: 'activa',
    clave_hash: 'cifrada', clave_original: `LIC-2026-L${String(i).padStart(3, '0')}-LIBR`,
    max_activaciones: 1, activado_en: null, createdAt: iso(hoy - (5 - i) * 60000), updatedAt: iso(hoy),
  });
}
}

sembrar();

// ------------------------------------------------------------ armado de datos

const comercioDe = (id) => comercios.find((c) => c.id === id) ?? null;
const planDe = (id) => planes.find((p) => p.id === id) ?? null;

function suscripcionCompleta(s) {
  const plan = planDe(s.plan_id);
  const propios = pagos.filter((p) => p.suscripcion_id === s.id)
    .sort((a, b) => new Date(b.pagado_en) - new Date(a.pagado_en));
  return {
    ...s,
    estado_efectivo: estadoEfectivo(s.estado, s.vence_en),
    dias_restantes: diasDeCalendario(s.vence_en),
    dias_gracia: DIAS_GRACIA,
    comercio: comercioDe(s.comercio_id),
    plan: plan && { id: plan.id, codigo: plan.codigo, nombre: plan.nombre, precio_mensual: plan.precio_mensual, precio_anual: plan.precio_anual, max_servidores: plan.max_servidores, max_clientes: plan.max_clientes },
    pagos: propios.slice(0, 12),
    ajuste_licencias: { emitidas: [], reactivadas: [], suspendidas: [] },
  };
}

function comercioCompleto(c) {
  // El plan del comercio es el asignado DIRECTO (c.plan_id), como en el
  // backend: una suscripción no asigna plan. Sin plan directo, el panel dice
  // "Sin plan" y la deuda no se estima (igual que `calcularDeuda`: sin plan no
  // hay ciclo contra el que contar).
  const plan = c.plan_id ? planDe(c.plan_id) : null;
  // La deuda estima los meses desde el último período cubierto por un pago
  // (camino viejo: pagos de suscripciones del comercio) o desde el alta si
  // nunca pagó. Meses de calendario, como `mesesEntre` del backend.
  const cubiertos = suscripciones
    .filter((s) => s.comercio_id === c.id)
    .flatMap((s) => pagos.filter((p) => p.suscripcion_id === s.id).map((p) => p.periodo_hasta));
  const ultimo = cubiertos.length ? new Date(Math.max(...cubiertos.map((f) => new Date(f).getTime()))) : null;
  const desde = ultimo ?? new Date(c.createdAt);
  const ahora = new Date();
  const meses = Math.max(0, (ahora.getFullYear() - desde.getFullYear()) * 12 + (ahora.getMonth() - desde.getMonth()));
  return {
    ...c,
    plan: plan
      ? { id: plan.id, nombre: plan.nombre, precio_mensual: plan.precio_mensual, chat_mensajes_mes: plan.chat_mensajes_mes }
      : null,
    licencias: licencias.filter((l) => l.comercio_id === c.id).map((l) => ({ ...l, activaciones: activaciones.filter((a) => a.licencia_id === l.id) })),
    claves_activas: licencias.filter((l) => l.comercio_id === c.id && l.estado === 'activa').length,
    deuda_periodos: plan ? meses : 0,
  };
}

function licenciaCompleta(l) {
  return { ...l, comercio: comercioDe(l.comercio_id), activaciones: activaciones.filter((a) => a.licencia_id === l.id) };
}

function pagoCompleto(p) {
  const s = suscripciones.find((x) => x.id === p.suscripcion_id);
  const plan = s && planDe(s.plan_id);
  return { ...p, suscripcion: s && { id: s.id, ciclo: s.ciclo, vence_en: s.vence_en, comercio: comercioDe(s.comercio_id), plan: plan && { id: plan.id, codigo: plan.codigo, nombre: plan.nombre } } };
}

function paginar(filas, url, nombreComercio) {
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const pagina = Math.max(1, Number(url.searchParams.get('pagina')) || 1);
  const limite = Math.max(1, Number(url.searchParams.get('limite')) || 20);
  const filtradas = q ? filas.filter((f) => nombreComercio(f).toLowerCase().includes(q)) : filas;
  return {
    datos: filtradas.slice((pagina - 1) * limite, pagina * limite),
    total: filtradas.length, pagina, limite,
    paginas: Math.max(1, Math.ceil(filtradas.length / limite)),
    _filtradas: filtradas,
  };
}

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

function serieMensual() {
  const h = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const f = new Date(h.getFullYear(), h.getMonth() - 11 + i, 1);
    const desde = f.getTime();
    const hasta = new Date(h.getFullYear(), h.getMonth() - 10 + i, 1).getTime();
    const delMes = pagos.filter((p) => { const t = new Date(p.pagado_en).getTime(); return t >= desde && t < hasta; });
    return {
      periodo: `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`,
      etiqueta: `${MESES[f.getMonth()]} ${String(f.getFullYear()).slice(-2)}`,
      total: delMes.reduce((s, p) => s + p.monto, 0),
      cantidad_pagos: delMes.length,
    };
  });
}

function resumen() {
  const vivas = suscripciones.filter((s) => s.estado !== 'CANCELADA');
  const efectivos = vivas.map((s) => estadoEfectivo(s.estado, s.vence_en));
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const inicioAnterior = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).getTime();
  const delMes = pagos.filter((p) => new Date(p.pagado_en).getTime() >= inicioMes);
  const delAnterior = pagos.filter((p) => { const t = new Date(p.pagado_en).getTime(); return t >= inicioAnterior && t < inicioMes; });
  const ingresoMes = delMes.reduce((s, p) => s + p.monto, 0);
  const ingresoAnterior = delAnterior.reduce((s, p) => s + p.monto, 0);

  return {
    ingreso_mes: ingresoMes, pagos_mes: delMes.length, ingreso_mes_anterior: ingresoAnterior,
    variacion_mensual: ingresoAnterior === 0 ? null : Math.round(((ingresoMes - ingresoAnterior) / ingresoAnterior) * 1000) / 10,
    mrr: vivas.filter((s, i) => efectivos[i] !== 'VENCIDA').reduce((t, s) => t + s.precio_pactado, 0),
    suscripciones: {
      activas: efectivos.filter((e) => e === 'ACTIVA').length,
      en_gracia: efectivos.filter((e) => e === 'EN_GRACIA').length,
      vencidas: efectivos.filter((e) => e === 'VENCIDA').length,
      canceladas: suscripciones.filter((s) => s.estado === 'CANCELADA').length,
      total: suscripciones.length,
    },
    por_vencer_30_dias: vivas.filter((s) => new Date(s.vence_en).getTime() <= hoy + 30 * DIA).length,
    comercios: comercios.length, licencias: licencias.length, activaciones: activaciones.length,
    dias_gracia: DIAS_GRACIA, generado_en: iso(hoy),
  };
}

function proximosVencimientos(dias) {
  return suscripciones
    .filter((s) => s.estado !== 'CANCELADA' && new Date(s.vence_en).getTime() <= hoy + dias * DIA)
    .map((s) => {
      const restantes = diasDeCalendario(s.vence_en);
      const atraso = hoy - new Date(s.vence_en).getTime();
      const plan = planDe(s.plan_id);
      const ultimo = pagos.filter((p) => p.suscripcion_id === s.id).sort((a, b) => new Date(b.pagado_en) - new Date(a.pagado_en))[0];
      return {
        id: s.id, comercio: comercioDe(s.comercio_id),
        plan: plan && { id: plan.id, codigo: plan.codigo, nombre: plan.nombre },
        ciclo: s.ciclo, precio_pactado: s.precio_pactado, moneda: 'ARS', vence_en: s.vence_en,
        dias_restantes: restantes, vencida: atraso > 0, en_gracia: atraso > 0 && atraso <= DIAS_GRACIA * DIA,
        ultimo_pago: ultimo ? { pagado_en: ultimo.pagado_en, monto: ultimo.monto } : null,
      };
    })
    .sort((a, b) => a.dias_restantes - b.dias_restantes);
}

// -------------------------------------------------------------------- rutas

let caido = false;   // para probar como reacciona el panel si el backend no esta

async function cuerpo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return trozos.length ? JSON.parse(Buffer.concat(trozos).toString()) : {};
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ruta = url.pathname;
  res.setHeader('Content-Type', 'application/json');

  const responder = (codigo, dato) => { res.statusCode = codigo; res.end(JSON.stringify(dato)); };

  // Palanca de control de la propia prueba.
  if (ruta === '/__caido') { caido = url.searchParams.get('v') === '1'; return responder(200, { caido }); }
  if (ruta === '/__reiniciar') { sembrar(); caido = false; return responder(200, { ok: true }); }
  if (caido) { res.destroy(); return; }

  if (req.method === 'POST' && ruta === '/api/administradores/login') {
    const { email, password } = await cuerpo(req);
    const validos = ['federico@binario.com', 'joaquin@binario.com'];
    if (!validos.includes(email) || password !== '123456') {
      return responder(401, { message: 'Credenciales inválidas' });
    }
    return responder(200, { token, administrador: { id: 'a1', email, rol: 'ADMINISTRADOR' } });
  }

  if (!req.headers.authorization) return responder(401, { message: 'Token de autorización no proporcionado' });

  // --- lecturas
  if (req.method === 'GET') {
    if (ruta === '/api/estadisticas/resumen') return responder(200, resumen());
    if (ruta === '/api/estadisticas/ingresos-mensuales') return responder(200, serieMensual());
    if (ruta === '/api/estadisticas/proximos-vencimientos') return responder(200, proximosVencimientos(Number(url.searchParams.get('dias')) || 30));
    if (ruta === '/api/estadisticas/ingresos-por-plan') {
      const porPlan = new Map();
      for (const p of pagos) {
        const s = suscripciones.find((x) => x.id === p.suscripcion_id);
        const plan = s && planDe(s.plan_id);
        if (!plan) continue;
        const a = porPlan.get(plan.id) ?? { plan_id: plan.id, codigo: plan.codigo, nombre: plan.nombre, total: 0, cantidad: 0 };
        a.total += p.monto; a.cantidad += 1; porPlan.set(plan.id, a);
      }
      return responder(200, [...porPlan.values()].sort((a, b) => b.total - a.total));
    }
    if (ruta === '/api/planes') {
      const lista = planes.map((p) => ({ ...p, comercios_con_plan: comercios.filter((c) => c.plan_id === p.id).length }));
      return responder(200, url.searchParams.get('activos') === 'true' ? lista.filter((p) => p.activo) : lista);
    }
    if (ruta === '/api/comercios') return responder(200, comercios.map(comercioCompleto));
    if (ruta === '/api/suscripciones') return responder(200, suscripciones.map(suscripcionCompleta));
    if (ruta === '/api/licencias') {
      const ordenadas = [...licencias].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(licenciaCompleta);
      // `?libres=1` trae solo las claves sin comercio, para asignarlas en el
      // alta — igual que el backend.
      const base = ['1', 'true'].includes(url.searchParams.get('libres') ?? '')
        ? ordenadas.filter((l) => !l.comercio)
        : ordenadas;
      const { _filtradas, ...pagina } = paginar(base, url, (l) => l.comercio?.nombre ?? '');
      return responder(200, pagina);
    }
    if (ruta === '/api/pagos') {
      const ordenados = [...pagos].sort((a, b) => new Date(b.pagado_en) - new Date(a.pagado_en)).map(pagoCompleto);
      const { _filtradas, ...pagina } = paginar(ordenados, url, (p) => p.suscripcion?.comercio?.nombre ?? '');
      return responder(200, { ...pagina, total_monto: _filtradas.reduce((s, p) => s + p.monto, 0) });
    }
  }

  // --- escrituras
  const datos = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await cuerpo(req) : {};

  if (req.method === 'POST' && ruta === '/api/comercios') {
    // Alta en un paso, como el backend: crea el comercio, le asigna el plan y
    // le asigna las claves libres elegidas, validando el cupo del plan sobre
    // lo que se asigna. Sin plan_id nace vacío (camino viejo, sigue válido).
    const plan = datos.plan_id ? planDe(datos.plan_id) : null;
    if (datos.plan_id && !plan) return responder(404, { message: 'Plan no encontrado' });
    if (plan && !plan.activo) return responder(409, { message: 'El plan está inactivo. Elegí un plan activo para el alta.' });
    const elegidas = Array.from(new Set(datos.licencia_ids ?? []));
    if (elegidas.length > 0) {
      const claves = licencias.filter((l) => elegidas.includes(l.id));
      if (claves.length !== elegidas.length) return responder(404, { message: 'Alguna de las claves elegidas no existe' });
      if (claves.some((l) => l.comercio_id !== null)) return responder(409, { message: 'Alguna de las claves elegidas ya está asignada a un comercio' });
      // El cupo se controla al asignar, no al generar — mensajes iguales a
      // `validarCupoAsignacion` del backend.
      if (plan) {
        const cupo = plan.max_servidores;
        if (cupo === 0) return responder(409, { message: `El plan ${plan.nombre} no incluye licencias de servidor. Mejora el plan del comercio para habilitarlas.` });
        if (claves.length > cupo) return responder(409, { message: `El plan ${plan.nombre} cubre ${cupo} ${cupo === 1 ? 'servidor' : 'servidores'} y el comercio ya tiene 0 asignadas. Estas queriendo sumar ${claves.length} mas. Mejora el plan para sumarlas.` });
      }
    }
    const c = {
      id: `c-${++secuencia}`, nombre: datos.nombre, plan_id: plan ? plan.id : null,
      telefono: datos.telefono ?? null, email: datos.email ?? null,
      createdAt: iso(hoy), updatedAt: iso(hoy),
    };
    comercios.push(c);
    for (const l of licencias.filter((l) => elegidas.includes(l.id))) l.comercio_id = c.id;
    return responder(201, { ...comercioCompleto(c), licencias_asignadas: elegidas.map((id) => ({ id })) });
  }

  if (req.method === 'PUT' && /^\/api\/comercios\/[^/]+$/.test(ruta)) {
    const c = comercioDe(ruta.split('/').pop());
    if (!c) return responder(404, { message: 'Comercio no encontrado' });
    if (datos.nombre !== undefined) c.nombre = datos.nombre;
    if ('telefono' in datos) c.telefono = datos.telefono;
    if ('email' in datos) c.email = datos.email;
    if ('chat_mensajes_override' in datos) c.chat_mensajes_override = datos.chat_mensajes_override;
    return responder(200, comercioCompleto(c));
  }

  if (req.method === 'DELETE' && /^\/api\/comercios\/[^/]+$/.test(ruta)) {
    const i = comercios.findIndex((c) => c.id === ruta.split('/').pop());
    if (i < 0) return responder(404, { message: 'Comercio no encontrado' });
    comercios.splice(i, 1);
    return responder(200, { message: 'Comercio y sus licencias eliminados correctamente' });
  }

  if (req.method === 'POST' && ruta === '/api/licencias') {
    // Genera claves sueltas ("libres"): sin comercio, para asignarlas en el
    // alta. No valida cupo — eso pasa al asignar, porque una clave libre
    // todavía no pertenece a nadie. Igual que el backend.
    const cantidad = Math.min(50, Math.max(1, Number(datos.cantidad) || 1));
    const nuevas = [];
    for (let i = 0; i < cantidad; i++) {
      const l = { id: `l-${++secuencia}`, comercio_id: null, rol: 'SERVIDOR', estado: 'activa', clave_hash: 'x', clave_original: `LIC-2026-NEW${secuencia}-0000`, max_activaciones: 1, activado_en: null, createdAt: iso(hoy), updatedAt: iso(hoy) };
      licencias.push(l);
      nuevas.push({ id: l.id, clave: l.clave_original, rol: l.rol, estado: l.estado, max_activaciones: l.max_activaciones });
    }
    return responder(201, { message: cantidad === 1 ? 'Clave generada correctamente' : `${cantidad} claves generadas correctamente`, licencias: nuevas });
  }

  if (req.method === 'PATCH' && /^\/api\/licencias\/[^/]+\/estado$/.test(ruta)) {
    const l = licencias.find((x) => x.id === ruta.split('/')[3]);
    if (!l) return responder(404, { message: 'Licencia no encontrada' });
    if (!['activa', 'suspendida'].includes(datos.estado)) {
      return responder(400, { message: 'El estado debe ser "activa" o "suspendida"' });
    }
    l.estado = datos.estado;
    l.updatedAt = iso(hoy);
    return responder(200, { message: l.estado === 'activa' ? 'Clave activada' : 'Clave desactivada', licencia: licenciaCompleta(l) });
  }

  if (req.method === 'DELETE' && /^\/api\/licencias\/[^/]+$/.test(ruta)) {
    // Borra una clave sin referencias. Con activaciones se rechaza con el
    // motivo, igual que el backend (los consumos de chat no existen acá).
    const i = licencias.findIndex((x) => x.id === ruta.split('/').pop());
    if (i < 0) return responder(404, { message: 'Licencia no encontrada' });
    if (activaciones.some((a) => a.licencia_id === licencias[i].id)) {
      return responder(409, { message: 'La clave tiene activaciones registradas. Liberá las activaciones o desactivala en lugar de borrarla.' });
    }
    licencias.splice(i, 1);
    return responder(200, { message: 'Clave eliminada correctamente' });
  }

  if (req.method === 'DELETE' && /^\/api\/licencias\/[^/]+\/activaciones\/[^/]+$/.test(ruta)) {
    const [, , , licenciaId, , activacionId] = ruta.split('/');
    const i = activaciones.findIndex((a) => a.id === activacionId && a.licencia_id === licenciaId);
    if (i < 0) return responder(404, { message: 'La activacion no existe o no pertenece a esta licencia' });
    activaciones.splice(i, 1);
    const l = licencias.find((x) => x.id === licenciaId);
    l.max_activaciones += 1;
    return responder(200, { message: 'Instalacion liberada. El comercio ya puede activar la misma clave en la maquina nueva.', licencia: { id: l.id, comercio: comercioDe(l.comercio_id), max_activaciones: l.max_activaciones, activaciones_restantes: 0 } });
  }

  if (req.method === 'POST' && ruta === '/api/suscripciones') {
    if (suscripciones.some((s) => s.comercio_id === datos.comercio_id && s.estado !== 'CANCELADA')) {
      return responder(409, { message: 'El comercio ya tiene una suscripción vigente. Editala o cancelala antes de crear otra.' });
    }
    const plan = planDe(datos.plan_id);
    const s = {
      id: `s-${++secuencia}`, comercio_id: datos.comercio_id, plan_id: plan.id, estado: 'ACTIVA',
      ciclo: datos.ciclo ?? 'MENSUAL', precio_pactado: datos.precio_pactado ?? plan.precio_mensual, moneda: 'ARS',
      inicia_en: iso(hoy), vence_en: enDias(30), cancelada_en: null, nota: datos.nota ?? null,
      createdAt: iso(hoy), updatedAt: iso(hoy),
    };
    suscripciones.push(s);
    const emitidas = [];
    for (const [rol, cuantas] of [['SERVIDOR', plan.max_servidores], ['CLIENTE', plan.max_clientes]]) {
      for (let i = 0; i < cuantas; i++) {
        const l = { id: `l-${++secuencia}`, comercio_id: s.comercio_id, rol, estado: 'activa', clave_hash: 'x', clave_original: `LIC-2026-N${secuencia}-0000`, max_activaciones: 1, activado_en: null, createdAt: iso(hoy), updatedAt: iso(hoy) };
        licencias.push(l);
        emitidas.push({ id: l.id, clave: l.clave_original, rol });
      }
    }
    pagos.push({ id: `pg-${++secuencia}`, suscripcion_id: s.id, monto: s.precio_pactado, moneda: 'ARS', metodo: datos.metodo_pago ?? 'TRANSFERENCIA', pagado_en: iso(hoy), periodo_desde: s.inicia_en, periodo_hasta: s.vence_en, referencia: datos.referencia_pago ?? null, nota: 'Primer pago, registrado al contratar el plan.', createdAt: iso(hoy), updatedAt: iso(hoy) });
    return responder(201, { ...suscripcionCompleta(s), ajuste_licencias: { emitidas, reactivadas: [], suspendidas: [] } });
  }

  if (req.method === 'POST' && /^\/api\/suscripciones\/[^/]+\/cancelar$/.test(ruta)) {
    const s = suscripciones.find((x) => x.id === ruta.split('/')[3]);
    if (!s) return responder(404, { message: 'Suscripción no encontrada' });
    s.estado = 'CANCELADA'; s.cancelada_en = iso(hoy);
    return responder(200, suscripcionCompleta(s));
  }

  if (req.method === 'POST' && /^\/api\/suscripciones\/[^/]+\/renovar$/.test(ruta)) {
    const s = suscripciones.find((x) => x.id === ruta.split('/')[3]);
    if (!s) return responder(404, { message: 'Suscripción no encontrada' });
    if (s.estado === 'CANCELADA') return responder(409, { message: 'La suscripción está cancelada. Reactivala antes de renovar.' });
    const desde = Math.max(new Date(s.vence_en).getTime(), hoy);
    s.vence_en = iso(desde + 30 * DIA * (datos.periodos ?? 1));
    s.estado = 'ACTIVA';
    if (datos.registrar_pago) {
      pagos.push({ id: `pg-${++secuencia}`, suscripcion_id: s.id, monto: datos.monto ?? s.precio_pactado, moneda: 'ARS', metodo: datos.metodo ?? 'TRANSFERENCIA', pagado_en: iso(hoy), periodo_desde: iso(desde), periodo_hasta: s.vence_en, referencia: datos.referencia ?? null, nota: null, createdAt: iso(hoy), updatedAt: iso(hoy) });
    }
    return responder(200, suscripcionCompleta(s));
  }

  if (req.method === 'PUT' && /^\/api\/suscripciones\/[^/]+$/.test(ruta)) {
    const s = suscripciones.find((x) => x.id === ruta.split('/').pop());
    if (!s) return responder(404, { message: 'Suscripción no encontrada' });
    const cambioDePlan = datos.plan_id && datos.plan_id !== s.plan_id;
    Object.assign(s, {
      plan_id: datos.plan_id ?? s.plan_id, ciclo: datos.ciclo ?? s.ciclo,
      precio_pactado: datos.precio_pactado ?? s.precio_pactado,
      estado: datos.estado ?? s.estado,
      cancelada_en: datos.estado === 'CANCELADA' ? (s.cancelada_en ?? iso(hoy)) : null,
      nota: datos.nota !== undefined ? datos.nota : s.nota,
    });
    const ajuste = { emitidas: [], reactivadas: [], suspendidas: [] };
    if (cambioDePlan) {
      const plan = planDe(s.plan_id);
      for (const [rol, cupo] of [['SERVIDOR', plan.max_servidores], ['CLIENTE', plan.max_clientes]]) {
        const propias = licencias.filter((l) => l.comercio_id === s.comercio_id && l.rol === rol);
        const activas = propias.filter((l) => l.estado === 'activa');
        if (activas.length > cupo) {
          for (const l of activas.slice(cupo)) { l.estado = 'suspendida'; ajuste.suspendidas.push({ id: l.id, clave: l.clave_original, rol }); }
        } else if (activas.length < cupo) {
          let faltan = cupo - activas.length;
          for (const l of propias.filter((l) => l.estado !== 'activa').slice(0, faltan)) { l.estado = 'activa'; ajuste.reactivadas.push({ id: l.id, clave: l.clave_original, rol }); faltan--; }
          for (let i = 0; i < faltan; i++) {
            const l = { id: `l-${++secuencia}`, comercio_id: s.comercio_id, rol, estado: 'activa', clave_hash: 'x', clave_original: `LIC-2026-U${secuencia}-0000`, max_activaciones: 1, activado_en: null, createdAt: iso(hoy), updatedAt: iso(hoy) };
            licencias.push(l); ajuste.emitidas.push({ id: l.id, clave: l.clave_original, rol });
          }
        }
      }
    }
    return responder(200, { ...suscripcionCompleta(s), ajuste_licencias: ajuste });
  }

  if (req.method === 'POST' && ruta === '/api/planes') {
    const p = { id: `p-${++secuencia}`, ...datos, moneda: 'ARS', suscripciones_activas: 0, createdAt: iso(hoy), updatedAt: iso(hoy) };
    planes.push(p);
    return responder(201, p);
  }

  if (req.method === 'PUT' && /^\/api\/planes\/[^/]+$/.test(ruta)) {
    const p = planDe(ruta.split('/').pop());
    if (!p) return responder(404, { message: 'Plan no encontrado' });
    Object.assign(p, datos);
    return responder(200, p);
  }

  if (req.method === 'POST' && ruta === '/api/pagos') {
    const p = { id: `pg-${++secuencia}`, ...datos, moneda: 'ARS', createdAt: iso(hoy), updatedAt: iso(hoy) };
    pagos.push(p);
    return responder(201, pagoCompleto(p));
  }

  if (req.method === 'DELETE' && /^\/api\/pagos\/[^/]+$/.test(ruta)) {
    const i = pagos.findIndex((p) => p.id === ruta.split('/').pop());
    if (i < 0) return responder(404, { message: 'Pago no encontrado' });
    pagos.splice(i, 1);
    return responder(200, { message: 'Pago eliminado correctamente' });
  }

  responder(404, { message: `Sin ruta simulada para ${req.method} ${ruta}` });
});

// Puerto configurable: el 4000 suele estar tomado por el backend de desarrollo
// (el POS local apunta ahi), y el simulado no puede levantarse encima.
const PUERTO = Number(process.env.SIM_PORT ?? 4000);
servidor.listen(PUERTO, () => console.log(`backend simulado en ${PUERTO}`));
