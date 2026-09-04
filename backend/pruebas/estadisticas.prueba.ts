/**
 * Los numeros del dashboard: ingreso del mes, ingreso recurrente, serie de
 * doce meses, reparto por plan y proximos vencimientos.
 */
import { EstadisticaService } from '../src/features/estadistica/estadistica.service';
import { PagoService } from '../src/features/pago/pago.service';
import { PlanService } from '../src/features/plan/plan.service';
import { DIAS_GRACIA } from '../src/features/suscripcion/suscripcion.reglas';
import { crearBaseFalsa, enDias, falla, igual, prueba, seccion, vacia, type Datos } from './ayuda';

const BASICO = { id: 'plan-basico', codigo: 'BASICO', nombre: 'Básico', precio_mensual: 25000, precio_anual: 250000, moneda: 'ARS', max_servidores: 1, max_clientes: 0, activo: true, createdAt: enDias(-300), updatedAt: enDias(-300) };
const PRO = { id: 'plan-pro', codigo: 'PRO', nombre: 'Pro', precio_mensual: 45000, precio_anual: 450000, moneda: 'ARS', max_servidores: 1, max_clientes: 2, activo: true, createdAt: enDias(-300), updatedAt: enDias(-300) };

/** Primer dia del mes actual y del anterior, para ubicar pagos sin ambiguedad. */
function esteMes(dia: number): Date {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth(), dia, 12, 0, 0);
}
function mesAnterior(dia: number): Date {
  const h = new Date();
  return new Date(h.getFullYear(), h.getMonth() - 1, dia, 12, 0, 0);
}

function base(): Datos {
  const d = vacia();
  d.planes.push({ ...BASICO }, { ...PRO });
  return d;
}

function agregarComercio(d: Datos, id: string, nombre: string) {
  d.comercios.push({ id, nombre, createdAt: enDias(-200), updatedAt: enDias(-200) });
}

function agregarSuscripcion(d: Datos, id: string, comercioId: string, planId: string, venceEnDias: number, extra: any = {}) {
  d.suscripciones.push({
    id, comercio_id: comercioId, plan_id: planId, estado: 'ACTIVA', ciclo: 'MENSUAL',
    precio_pactado: planId === 'plan-pro' ? 45000 : 25000, moneda: 'ARS',
    inicia_en: enDias(-30), vence_en: enDias(venceEnDias), cancelada_en: null, nota: null,
    createdAt: enDias(-30), updatedAt: enDias(-30), ...extra,
  });
}

function agregarPago(d: Datos, suscripcionId: string, monto: number, cuando: Date) {
  d.pagos.push({
    id: `pago-${d.pagos.length + 1}`, suscripcion_id: suscripcionId, monto, moneda: 'ARS',
    metodo: 'TRANSFERENCIA', pagado_en: cuando, periodo_desde: cuando, periodo_hasta: cuando,
    referencia: null, nota: null, createdAt: cuando, updatedAt: cuando,
  });
}

export async function correr(): Promise<void> {
  // -------------------------------------------------------------- resumen
  seccion('Numeros de cabecera del dashboard');

  {
    const d = base();
    agregarComercio(d, 'c1', 'Al día');
    agregarComercio(d, 'c2', 'En gracia');
    agregarComercio(d, 'c3', 'Vencido');
    agregarComercio(d, 'c4', 'Cancelado');
    agregarSuscripcion(d, 's1', 'c1', 'plan-pro', 12);
    agregarSuscripcion(d, 's2', 'c2', 'plan-basico', -1);
    agregarSuscripcion(d, 's3', 'c3', 'plan-basico', -40);
    agregarSuscripcion(d, 's4', 'c4', 'plan-pro', 20, { estado: 'CANCELADA', cancelada_en: enDias(-3) });

    agregarPago(d, 's1', 45000, esteMes(2));
    agregarPago(d, 's2', 25000, esteMes(3));
    agregarPago(d, 's1', 45000, mesAnterior(5));
    agregarPago(d, 's3', 25000, mesAnterior(6));
    agregarPago(d, 's1', 45000, mesAnterior(20));

    const { db } = crearBaseFalsa(d);
    const r = await new EstadisticaService(db).resumen();

    igual('cobrado del mes en curso', r.ingreso_mes, 70000);
    igual('cantidad de cobros del mes', r.pagos_mes, 2);
    igual('cobrado del mes anterior', r.ingreso_mes_anterior, 115000);
    igual('la variacion compara los dos meses', r.variacion_mensual, -39.1);

    igual('activas', r.suscripciones.activas, 1);
    igual('en gracia', r.suscripciones.en_gracia, 1);
    igual('vencidas', r.suscripciones.vencidas, 1);
    igual('canceladas', r.suscripciones.canceladas, 1);
    igual('total', r.suscripciones.total, 4);

    igual('el MRR suma la que esta al dia y la que esta en gracia, nada mas', r.mrr, 70000);
    igual('expone la gracia vigente para que el panel la explique', r.dias_gracia, DIAS_GRACIA);
    igual('cuenta los comercios', r.comercios, 4);
  }

  {
    const d = base();
    agregarComercio(d, 'c1', 'Anual');
    agregarSuscripcion(d, 's1', 'c1', 'plan-pro', 200, { ciclo: 'ANUAL', precio_pactado: 450000 });
    const { db } = crearBaseFalsa(d);
    const r = await new EstadisticaService(db).resumen();
    igual('una suscripcion anual entra al MRR prorrateada a doce', r.mrr, 37500);
  }

  {
    const d = base();
    agregarComercio(d, 'c1', 'Nuevo');
    agregarSuscripcion(d, 's1', 'c1', 'plan-basico', 20);
    agregarPago(d, 's1', 25000, esteMes(1));
    const { db } = crearBaseFalsa(d);
    const r = await new EstadisticaService(db).resumen();
    igual('sin mes anterior la variacion es nula, no infinita', r.variacion_mensual, null);
  }

  {
    const { db } = crearBaseFalsa(base());
    const r = await new EstadisticaService(db).resumen();
    igual('una base vacia no rompe: ingreso en cero', r.ingreso_mes, 0);
    igual('MRR en cero', r.mrr, 0);
    igual('y variacion nula', r.variacion_mensual, null);
  }

  // -------------------------------------------------------- serie mensual
  seccion('Serie de ingreso mensual');

  {
    const d = base();
    agregarComercio(d, 'c1', 'Uno');
    agregarSuscripcion(d, 's1', 'c1', 'plan-basico', 10);
    agregarPago(d, 's1', 25000, esteMes(2));
    agregarPago(d, 's1', 30000, mesAnterior(2));

    const { db } = crearBaseFalsa(d);
    const serie = await new EstadisticaService(db).ingresosMensuales(12);

    igual('devuelve exactamente doce meses', serie.length, 12);
    igual('el ultimo es el mes en curso', serie[11].total, 25000);
    igual('el anterior es el mes pasado', serie[10].total, 30000);
    prueba('los meses sin cobros vienen en cero, no faltan',
      serie.slice(0, 10).every((m) => m.total === 0));
    prueba('vienen ordenados del mas viejo al mas nuevo',
      serie.every((m, i) => i === 0 || m.periodo > serie[i - 1].periodo));
    prueba('cada uno trae su etiqueta corta para el eje',
      serie.every((m) => /^[a-z]{3} \d{2}$/.test(m.etiqueta)));
    igual('y cuenta los cobros de cada mes', serie[11].cantidad_pagos, 1);
  }

  // ------------------------------------------------------- reparto por plan
  seccion('Reparto por plan');

  {
    const d = base();
    agregarComercio(d, 'c1', 'Uno');
    agregarComercio(d, 'c2', 'Dos');
    agregarSuscripcion(d, 's1', 'c1', 'plan-pro', 10);
    agregarSuscripcion(d, 's2', 'c2', 'plan-basico', 10);
    agregarPago(d, 's1', 45000, esteMes(1));
    agregarPago(d, 's1', 45000, mesAnterior(1));
    agregarPago(d, 's2', 25000, esteMes(1));

    const { db } = crearBaseFalsa(d);
    const reparto = await new EstadisticaService(db).ingresosPorPlan(12);
    igual('agrupa por plan', reparto.length, 2);
    igual('ordenado por lo que mas entro', reparto[0].codigo, 'PRO');
    igual('con el total del plan', reparto[0].total, 90000);
    igual('y la cantidad de pagos', reparto[0].cantidad, 2);
  }

  // ---------------------------------------------------- proximos vencimientos
  seccion('Proximos vencimientos');

  {
    const d = base();
    agregarComercio(d, 'c1', 'Vence en 8');
    agregarComercio(d, 'c2', 'Vencio hace 2');
    agregarComercio(d, 'c3', 'Vence en 41');
    agregarComercio(d, 'c4', 'Vence en 100');
    agregarComercio(d, 'c5', 'Cancelado');
    agregarSuscripcion(d, 's1', 'c1', 'plan-basico', 8);
    agregarSuscripcion(d, 's2', 'c2', 'plan-basico', -2);
    agregarSuscripcion(d, 's3', 'c3', 'plan-pro', 41);
    agregarSuscripcion(d, 's4', 'c4', 'plan-pro', 100);
    agregarSuscripcion(d, 's5', 'c5', 'plan-pro', 5, { estado: 'CANCELADA', cancelada_en: enDias(-1) });

    const { db } = crearBaseFalsa(d);
    const lista = await new EstadisticaService(db).proximosVencimientos(45);

    igual('trae las que vencen dentro de la ventana', lista.length, 3);
    prueba('deja afuera la que vence dentro de 100 dias', !lista.some((v) => v.comercio.id === 'c4'));
    prueba('y las canceladas', !lista.some((v) => v.comercio.id === 'c5'));
    igual('la mas urgente primero: la que ya vencio', lista[0].comercio.id, 'c2');
    prueba('marcada como vencida', lista[0].vencida);
    prueba('y como en gracia si entra en la ventana', lista[0].en_gracia);
    prueba('las que todavia no vencieron no estan marcadas', !lista[1].vencida);
    prueba('trae el ultimo pago cuando existe', lista.every((v) => 'ultimo_pago' in v));
  }

  // ------------------------------------------------------------------ pagos
  seccion('Cobranza: paginado, buscador y total');

  {
    const d = base();
    agregarComercio(d, 'c1', 'Almacén San Martín');
    agregarComercio(d, 'c2', 'Kiosco La Esquina');
    agregarSuscripcion(d, 's1', 'c1', 'plan-basico', 10);
    agregarSuscripcion(d, 's2', 'c2', 'plan-pro', 10);
    for (let i = 0; i < 5; i++) agregarPago(d, 's1', 25000, enDias(-i * 31));
    for (let i = 0; i < 3; i++) agregarPago(d, 's2', 45000, enDias(-i * 31));

    const { db } = crearBaseFalsa(d);
    const servicio = new PagoService(db);

    const p1 = await servicio.getAll({ pagina: 1, limite: 3 } as any);
    igual('la pagina respeta el tamano', p1.datos.length, 3);
    igual('el total cuenta todos', p1.total, 8);
    igual('y las paginas', p1.paginas, 3);
    prueba('ordenados del cobro mas reciente al mas viejo',
      p1.datos.every((p, i) => i === 0 || new Date(p.pagado_en) <= new Date(p1.datos[i - 1].pagado_en)));

    const filtrado = await servicio.getAll({ q: 'kiosco', pagina: 1, limite: 20 } as any);
    igual('el buscador filtra por comercio', filtrado.total, 3);

    const totalTodo = await servicio.totalFiltrado({ pagina: 1, limite: 20 } as any);
    igual('el total en plata suma todo', totalTodo, 5 * 25000 + 3 * 45000);

    const totalFiltrado = await servicio.totalFiltrado({ q: 'kiosco', pagina: 1, limite: 20 } as any);
    igual('y respeta el filtro, no solo la pagina visible', totalFiltrado, 3 * 45000);
  }

  // ------------------------------------------------------------------ planes
  seccion('Planes');

  {
    const d = base();
    agregarComercio(d, 'c1', 'Uno');
    agregarSuscripcion(d, 's1', 'c1', 'plan-basico', 10);
    const { db } = crearBaseFalsa(d);
    const servicio = new PlanService(db);

    const planes = await servicio.getAll();
    igual('lista los dos planes', planes.length, 2);
    prueba('ordenados por precio', planes[0].precio_mensual <= planes[1].precio_mensual);
    igual('informa cuantos comercios tiene contratado cada uno',
      planes.find((p) => p.codigo === 'BASICO')?.suscripciones_activas, 1);

    await falla('no deja borrar un plan que alguien tiene contratado',
      /no se puede eliminar/i, () => servicio.eliminar('plan-basico'));

    const desactivado = await servicio.desactivar('plan-basico');
    igual('pero si desactivarlo', desactivado.activo, false);

    await falla('no crea dos planes con el mismo codigo', /ya existe un plan/i, () =>
      servicio.crear({ codigo: 'PRO', nombre: 'Otro Pro', precio_mensual: 1, moneda: 'ARS', max_servidores: 1, max_clientes: 0, activo: true } as any));
  }
}
