/**
 * Ciclo de vida de una suscripcion: como se ve segun la fecha, que pasa al
 * renovar, y como se comporta el cambio de plan.
 */
import { SuscripcionService, sumarMeses } from '../src/features/suscripcion/suscripcion.service';
import { diasDeCalendarioHasta, DIAS_GRACIA } from '../src/features/suscripcion/suscripcion.reglas';
import { crearBaseFalsa, enDias, falla, igual, prueba, seccion, vacia, type Datos } from './ayuda';

const BASICO = { id: 'plan-basico', codigo: 'BASICO', nombre: 'Básico', precio_mensual: 25000, precio_anual: 250000, moneda: 'ARS', max_servidores: 1, max_clientes: 0, activo: true };
const PRO = { id: 'plan-pro', codigo: 'PRO', nombre: 'Pro', precio_mensual: 45000, precio_anual: 450000, moneda: 'ARS', max_servidores: 1, max_clientes: 2, activo: true };

function escenario(): Datos {
  const d = vacia();
  d.comercios.push({ id: 'com-1', nombre: 'Almacén San Martín', createdAt: enDias(-200), updatedAt: enDias(-200) });
  d.planes.push({ ...BASICO }, { ...PRO });
  return d;
}

function suscripcion(extra: Partial<any> = {}) {
  return {
    id: 'sus-1', comercio_id: 'com-1', plan_id: 'plan-basico',
    estado: 'ACTIVA', ciclo: 'MENSUAL', precio_pactado: 25000, moneda: 'ARS',
    inicia_en: enDias(-30), vence_en: enDias(10), cancelada_en: null, nota: null,
    createdAt: enDias(-30), updatedAt: enDias(-30), ...extra,
  };
}

export async function correr(): Promise<void> {
  // ------------------------------------------------------ estado segun fecha
  seccion(`Como se ve una suscripcion segun la fecha (gracia = ${DIAS_GRACIA} dias)`);

  const casos: [string, number, string][] = [
    ['vence dentro de 10 dias', 10, 'ACTIVA'],
    ['vence manana', 1, 'ACTIVA'],
    ['vence en unas horas', 0.4, 'ACTIVA'],
    ['vencio hace unas horas', -0.4, 'EN_GRACIA'],
    ['vencio ayer', -1, 'EN_GRACIA'],
    ['vencio hace 3 dias (ultimo de gracia)', -DIAS_GRACIA + 0.1, 'EN_GRACIA'],
    ['vencio hace mas de 3 dias', -DIAS_GRACIA - 0.1, 'VENCIDA'],
    ['vencio hace 40 dias', -40, 'VENCIDA'],
  ];

  for (const [etiqueta, dias, esperado] of casos) {
    const datos = escenario();
    datos.suscripciones.push(suscripcion({ vence_en: enDias(dias) }));
    const { db } = crearBaseFalsa(datos);
    const [s] = await new SuscripcionService(db).getAll();
    igual(etiqueta, s.estado_efectivo, esperado);
  }

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion({ estado: 'CANCELADA', vence_en: enDias(20), cancelada_en: enDias(-1) }));
    const { db } = crearBaseFalsa(datos);
    const [s] = await new SuscripcionService(db).getAll();
    igual('cancelada gana aunque no haya vencido', s.estado_efectivo, 'CANCELADA');
  }

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion({ vence_en: enDias(-5) }));
    const { db } = crearBaseFalsa(datos);
    const [s] = await new SuscripcionService(db).getAll();
    prueba('el estado guardado no se toca al leer', s.estado === 'ACTIVA', s.estado);
    prueba('dias_restantes es negativo cuando ya vencio', s.dias_restantes < 0, s.dias_restantes);
  }

  // ------------------------------------------------- dias que faltan, en dias
  seccion('Los dias que faltan se cuentan por calendario, no por horas');

  {
    // Todo esto es el mismo dia de hoy: lo que cambia es la hora.
    const hoy = new Date();
    const aLaNoche = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 30);
    const temprano = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 30);

    igual('algo que vence hoy a la noche da 0, no 1', diasDeCalendarioHasta(aLaNoche, hoy), 0);
    igual('y algo que vencio hoy temprano tambien da 0', diasDeCalendarioHasta(temprano, hoy), 0);

    const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1, 0, 30);
    igual('manana a las 00:30 es 1 aunque falten dos horas', diasDeCalendarioHasta(manana, new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 22, 30)), 1);

    const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1, 12);
    igual('ayer es -1', diasDeCalendarioHasta(ayer, hoy), -1);
  }

  {
    // El mismo caso, pero visto desde el panel.
    const datos = escenario();
    const hoy = new Date();
    datos.suscripciones.push(suscripcion({
      vence_en: new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 30),
    }));
    const { db } = crearBaseFalsa(datos);
    const [s] = await new SuscripcionService(db).getAll();
    igual('una que vence hoy mas tarde se informa como "vence hoy"', s.dias_restantes, 0);
    igual('y todavia esta activa', s.estado_efectivo, 'ACTIVA');
  }

  // ------------------------------------------------------------- aritmetica
  seccion('Aritmetica de fechas al correr un periodo');

  igual('31 de enero + 1 mes caza el ultimo dia de febrero',
    sumarMeses(new Date(2026, 0, 31), 1).toISOString().slice(0, 10), '2026-02-28');
  igual('31 de marzo + 1 mes cae el 30 de abril',
    sumarMeses(new Date(2026, 2, 31), 1).toISOString().slice(0, 10), '2026-04-30');
  igual('15 de enero + 12 meses cae el mismo dia del ano siguiente',
    sumarMeses(new Date(2026, 0, 15), 12).toISOString().slice(0, 10), '2027-01-15');
  igual('29 de febrero bisiesto + 12 meses cae el 28',
    sumarMeses(new Date(2024, 1, 29), 12).toISOString().slice(0, 10), '2025-02-28');

  // ----------------------------------------------------------------- renovar
  seccion('Renovacion');

  {
    const datos = escenario();
    const vence = enDias(8);
    datos.suscripciones.push(suscripcion({ vence_en: vence }));
    const { db } = crearBaseFalsa(datos);
    const s = await new SuscripcionService(db).renovar('sus-1', {
      periodos: 1, registrar_pago: false, metodo: 'TRANSFERENCIA',
    } as any);
    const esperado = sumarMeses(vence, 1);
    igual('al que esta al dia se le suma desde su vencimiento, no desde hoy',
      new Date(s.vence_en).toDateString(), esperado.toDateString());
    igual('no se registra pago si no se pidio', datos.pagos.length, 0);
  }

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion({ vence_en: enDias(-40) }));
    const { db } = crearBaseFalsa(datos);
    const s = await new SuscripcionService(db).renovar('sus-1', {
      periodos: 1, registrar_pago: false, metodo: 'TRANSFERENCIA',
    } as any);
    const esperado = sumarMeses(new Date(), 1);
    igual('al que vencio hace rato se le cuenta desde hoy, no se le cobra lo que no uso',
      new Date(s.vence_en).toDateString(), esperado.toDateString());
    igual('vuelve a quedar ACTIVA', s.estado, 'ACTIVA');
  }

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion({ vence_en: enDias(5) }));
    const { db } = crearBaseFalsa(datos);
    await new SuscripcionService(db).renovar('sus-1', {
      periodos: 3, registrar_pago: true, metodo: 'EFECTIVO',
    } as any);
    igual('renovar cobrando deja el pago asentado', datos.pagos.length, 1);
    igual('por el precio pactado multiplicado por los periodos', datos.pagos[0].monto, 75000);
    igual('con el metodo elegido', datos.pagos[0].metodo, 'EFECTIVO');
  }

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion({ estado: 'CANCELADA', cancelada_en: enDias(-2) }));
    const { db } = crearBaseFalsa(datos);
    await falla('no se renueva una cancelada sin reactivarla', /cancelada/i, () =>
      new SuscripcionService(db).renovar('sus-1', { periodos: 1, registrar_pago: false, metodo: 'TRANSFERENCIA' } as any)
    );
  }

  // ------------------------------------------------------------- contratacion
  seccion('Contratar');

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    const s = await new SuscripcionService(db).crear({
      comercio_id: 'com-1', plan_id: 'plan-pro', ciclo: 'MENSUAL',
      metodo_pago: 'TRANSFERENCIA',
    } as any);

    igual('toma el precio de lista del plan', s.precio_pactado, 45000);
    igual('emite el cupo del plan: 1 servidor + 2 clientes', datos.licencias.length, 3);
    igual('asienta el primer pago', datos.pagos.length, 1);
    igual('el pago es por el precio pactado', datos.pagos[0].monto, 45000);
    prueba('el pago cubre el primer periodo',
      new Date(datos.pagos[0].periodo_hasta).toDateString() === new Date(s.vence_en).toDateString());
    igual('informa que licencias salieron', s.ajuste_licencias?.emitidas.length, 3);
  }

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    const s = await new SuscripcionService(db).crear({
      comercio_id: 'com-1', plan_id: 'plan-basico', ciclo: 'ANUAL', metodo_pago: 'TRANSFERENCIA',
    } as any);
    igual('el ciclo anual toma el precio anual', s.precio_pactado, 250000);
    prueba('y vence dentro de un ano', new Date(s.vence_en).getTime() > enDias(360).getTime());
  }

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion());
    const { db } = crearBaseFalsa(datos);
    await falla('un comercio no puede tener dos suscripciones vivas', /ya tiene una suscripci[oó]n/i, () =>
      new SuscripcionService(db).crear({ comercio_id: 'com-1', plan_id: 'plan-pro', ciclo: 'MENSUAL', metodo_pago: 'TRANSFERENCIA' } as any)
    );
  }

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion({ estado: 'CANCELADA', cancelada_en: enDias(-10) }));
    const { db } = crearBaseFalsa(datos);
    const s = await new SuscripcionService(db).crear({
      comercio_id: 'com-1', plan_id: 'plan-basico', ciclo: 'MENSUAL', metodo_pago: 'TRANSFERENCIA',
    } as any);
    prueba('pero si la anterior estaba cancelada, si', Boolean(s.id));
  }

  await falla('no se contrata un plan que no existe', /plan no encontrado/i, () => {
    const { db } = crearBaseFalsa(escenario());
    return new SuscripcionService(db).crear({ comercio_id: 'com-1', plan_id: 'no-existe', ciclo: 'MENSUAL', metodo_pago: 'TRANSFERENCIA' } as any);
  });

  await falla('ni para un comercio que no existe', /comercio no encontrado/i, () => {
    const { db } = crearBaseFalsa(escenario());
    return new SuscripcionService(db).crear({ comercio_id: 'no-existe', plan_id: 'plan-basico', ciclo: 'MENSUAL', metodo_pago: 'TRANSFERENCIA' } as any);
  });

  // -------------------------------------------------------- cambio de plan
  seccion('Cambio de plan y su efecto sobre las licencias');

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    const servicio = new SuscripcionService(db);
    const creada = await servicio.crear({ comercio_id: 'com-1', plan_id: 'plan-basico', ciclo: 'MENSUAL', metodo_pago: 'TRANSFERENCIA' } as any);
    igual('arranca en Basico con 1 licencia', datos.licencias.length, 1);

    const aPro = await servicio.actualizar(creada.id, { plan_id: 'plan-pro' } as any);
    igual('pasar a Pro emite las 2 de cliente', aPro.ajuste_licencias?.emitidas.length, 2);
    igual('y no suspende nada', aPro.ajuste_licencias?.suspendidas.length, 0);

    const aBasico = await servicio.actualizar(creada.id, { plan_id: 'plan-basico' } as any);
    igual('volver a Basico suspende las 2 de cliente', aBasico.ajuste_licencias?.suspendidas.length, 2);
    igual('el servidor sigue activo',
      datos.licencias.filter((l) => l.rol === 'SERVIDOR' && l.estado === 'activa').length, 1);

    const otraVezPro = await servicio.actualizar(creada.id, { plan_id: 'plan-pro' } as any);
    igual('volver a subir reactiva las mismas, no emite nuevas', otraVezPro.ajuste_licencias?.reactivadas.length, 2);
    igual('sin emitir ninguna clave nueva', otraVezPro.ajuste_licencias?.emitidas.length, 0);
    igual('el comercio nunca acumulo licencias de mas', datos.licencias.length, 3);
  }

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    const servicio = new SuscripcionService(db);
    const creada = await servicio.crear({ comercio_id: 'com-1', plan_id: 'plan-basico', ciclo: 'MENSUAL', metodo_pago: 'TRANSFERENCIA' } as any);
    const soloPrecio = await servicio.actualizar(creada.id, { precio_pactado: 30000 } as any);
    igual('editar solo el precio no toca ninguna licencia',
      (soloPrecio.ajuste_licencias?.emitidas.length ?? 0) + (soloPrecio.ajuste_licencias?.suspendidas.length ?? 0), 0);
    igual('y el precio queda actualizado', soloPrecio.precio_pactado, 30000);
  }

  // -------------------------------------------------------------- cancelar
  seccion('Cancelar y reactivar');

  {
    const datos = escenario();
    datos.suscripciones.push(suscripcion());
    const { db } = crearBaseFalsa(datos);
    const servicio = new SuscripcionService(db);
    const cancelada = await servicio.cancelar('sus-1');
    igual('cancelar deja el estado en CANCELADA', cancelada.estado, 'CANCELADA');
    prueba('y anota cuando', Boolean(cancelada.cancelada_en));

    const reactivada = await servicio.actualizar('sus-1', { estado: 'ACTIVA' } as any);
    igual('reactivar la vuelve a ACTIVA', reactivada.estado, 'ACTIVA');
    igual('y limpia la fecha de baja', reactivada.cancelada_en, null);
  }
}
