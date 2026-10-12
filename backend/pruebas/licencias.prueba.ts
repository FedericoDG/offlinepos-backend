/**
 * Licencias: cupo del plan, emision manual, listado paginado y el caso de
 * soporte mas comun, que es el cambio de PC.
 */
import {
  sincronizarLicenciasConPlan,
  verificarCupoDisponible,
} from '../src/features/licencia/licencia.provision';
import { LicenciaPanelService } from '../src/features/licencia/licencia.panel';
import { crearBaseFalsa, enDias, falla, igual, prueba, seccion, vacia, type Datos } from './ayuda';

const BASICO = { id: 'plan-basico', codigo: 'BASICO', nombre: 'Básico', precio_mensual: 25000, precio_anual: 250000, moneda: 'ARS', max_servidores: 1, activo: true };
// PRO es un fixture de tres puestos para ejercitar emision y suspension en bloque.
const PRO = { id: 'plan-pro', codigo: 'PRO', nombre: 'Pro', precio_mensual: 45000, precio_anual: 450000, moneda: 'ARS', max_servidores: 3, activo: true };
// Plan sin cupo de servidores: sirve para comprobar que no se emite nada.
const SIN_SERVIDOR = { id: 'plan-sin-servidor', codigo: 'SIN_SERVIDOR', nombre: 'Sin servidor', precio_mensual: 0, precio_anual: 0, moneda: 'ARS', max_servidores: 0, activo: true };

function escenario(): Datos {
  const d = vacia();
  d.comercios.push(
    { id: 'com-1', nombre: 'Almacén San Martín', createdAt: enDias(-200), updatedAt: enDias(-200) },
    { id: 'com-2', nombre: 'Kiosco La Esquina', createdAt: enDias(-100), updatedAt: enDias(-100) }
  );
  d.planes.push({ ...BASICO }, { ...PRO }, { ...SIN_SERVIDOR });
  return d;
}

function conPlan(datos: Datos, comercioId: string, planId: string, estado = 'ACTIVA') {
  datos.suscripciones.push({
    id: `sus-${comercioId}`, comercio_id: comercioId, plan_id: planId, estado,
    ciclo: 'MENSUAL', precio_pactado: 25000, moneda: 'ARS',
    inicia_en: enDias(-10), vence_en: enDias(20), cancelada_en: null, nota: null,
    createdAt: enDias(-10), updatedAt: enDias(-10),
  });
}

export async function correr(): Promise<void> {
  // ------------------------------------------------------------- cupo
  seccion('El cupo del plan manda al emitir a mano');

  {
    const datos = escenario();
    conPlan(datos, 'com-1', 'plan-sin-servidor');
    const { db } = crearBaseFalsa(datos);
    await falla('un plan sin servidores no emite y pide mejorar el plan',
      /no incluye licencias de servidor.*mejora el plan/i,
      () => verificarCupoDisponible(db, 'com-1'));
  }

  {
    const datos = escenario();
    conPlan(datos, 'com-1', 'plan-basico');
    datos.licencias.push({ id: 'l1', comercio_id: 'com-1', rol: 'SERVIDOR', estado: 'activa', clave_hash: 'x', max_activaciones: 1, activado_en: null, createdAt: enDias(-5), updatedAt: enDias(-5) });
    const { db } = crearBaseFalsa(datos);
    await falla('tampoco un segundo servidor', /cubre 1 servidor.*mejora el plan/i,
      () => verificarCupoDisponible(db, 'com-1'));
  }

  {
    const datos = escenario();
    conPlan(datos, 'com-1', 'plan-pro');
    for (let i = 0; i < 3; i++) {
      datos.licencias.push({ id: `s${i}`, comercio_id: 'com-1', rol: 'SERVIDOR', estado: 'activa', clave_hash: 'x', max_activaciones: 1, activado_en: null, createdAt: enDias(-5), updatedAt: enDias(-5) });
    }
    const { db } = crearBaseFalsa(datos);
    await falla('Pro no habilita un cuarto servidor', /cubre 3 servidores.*mejora el plan/i,
      () => verificarCupoDisponible(db, 'com-1'));

    // Con una sola libre, si.
    datos.licencias.pop();
    const { db: db2 } = crearBaseFalsa(datos);
    let hubo = false;
    try { await verificarCupoDisponible(db2, 'com-1'); } catch { hubo = true; }
    prueba('pero el tercero pasa sin problema', !hubo);
  }

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    await falla('sin plan contratado no se emite nada', /no tiene un plan contratado/i,
      () => verificarCupoDisponible(db, 'com-1'));
  }

  {
    const datos = escenario();
    conPlan(datos, 'com-1', 'plan-pro', 'CANCELADA');
    const { db } = crearBaseFalsa(datos);
    await falla('una suscripcion cancelada no habilita cupo', /no tiene un plan contratado/i,
      () => verificarCupoDisponible(db, 'com-1'));
  }

  {
    const datos = escenario();
    conPlan(datos, 'com-1', 'plan-basico');
    datos.licencias.push({ id: 'sus1', comercio_id: 'com-1', rol: 'SERVIDOR', estado: 'suspendida', clave_hash: 'x', max_activaciones: 1, activado_en: null, createdAt: enDias(-5), updatedAt: enDias(-5) });
    const { db } = crearBaseFalsa(datos);
    let hubo = false;
    try { await verificarCupoDisponible(db, 'com-1'); } catch { hubo = true; }
    prueba('una licencia suspendida no ocupa cupo', !hubo);
  }

  // -------------------------------------------------- sincronizacion de cupo
  seccion('Sincronizar licencias con el plan');

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    const a = await sincronizarLicenciasConPlan(db, 'com-1', PRO);
    igual('Pro emite 3 licencias', a.emitidas.length, 3);
    igual('las tres son de servidor', a.emitidas.filter((l) => l.rol === 'SERVIDOR').length, 3);
    prueba('con el formato de clave de siempre',
      a.emitidas.every((l) => /^LIC-\d{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(l.clave)));
    prueba('todas distintas', new Set(a.emitidas.map((l) => l.clave)).size === 3);
    igual('cada una habilita un puesto', datos.licencias[0].max_activaciones, 1);

    const b = await sincronizarLicenciasConPlan(db, 'com-1', PRO);
    igual('correrlo de nuevo con el mismo plan no hace nada',
      b.emitidas.length + b.reactivadas.length + b.suspendidas.length, 0);
  }

  {
    // Al bajar de plan hay que apagar la terminal que nadie usa, no la que si.
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    await sincronizarLicenciasConPlan(db, 'com-1', PRO);
    const licencias = datos.licencias.filter((l) => l.rol === 'SERVIDOR');
    datos.activaciones.push({ id: 'act-1', licencia_id: licencias[0].id, instalacion_id: 'pc-en-uso', ultima_validacion: new Date() });

    const a = await sincronizarLicenciasConPlan(db, 'com-1', { max_servidores: 1 });
    igual('bajar a un solo servidor suspende dos', a.suspendidas.length, 2);
    prueba('y apaga las que nadie estaba usando', a.suspendidas.every((l) => l.id !== licencias[0].id));
    igual('la terminal en uso sigue viva',
      datos.licencias.find((l) => l.id === licencias[0].id)?.estado, 'activa');
  }

  // ------------------------------------------------------- listado paginado
  seccion('Listado paginado y buscador');

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    await sincronizarLicenciasConPlan(db, 'com-1', PRO);
    await sincronizarLicenciasConPlan(db, 'com-2', BASICO);
    const servicio = new LicenciaPanelService(db);

    const p1 = await servicio.listar({ pagina: 1, limite: 2 } as any);
    igual('la pagina trae solo su tamano', p1.datos.length, 2);
    igual('pero el total cuenta todas', p1.total, 4);
    igual('y calcula bien cuantas paginas hay', p1.paginas, 2);

    const p2 = await servicio.listar({ pagina: 2, limite: 2 } as any);
    igual('la segunda pagina trae el resto', p2.datos.length, 2);
    prueba('sin repetir filas de la primera',
      p2.datos.every((l) => !p1.datos.some((x) => x.id === l.id)));

    const vacia2 = await servicio.listar({ pagina: 9, limite: 2 } as any);
    igual('una pagina que no existe viene vacia', vacia2.datos.length, 0);
    igual('pero el total sigue siendo el real', vacia2.total, 4);

    const buscado = await servicio.listar({ q: 'kiosco', pagina: 1, limite: 20 } as any);
    igual('el buscador filtra por comercio', buscado.total, 1);
    igual('sin importar mayusculas', buscado.datos[0].comercio.nombre, 'Kiosco La Esquina');

    const sinNada = await servicio.listar({ q: 'zzz', pagina: 1, limite: 20 } as any);
    igual('una busqueda sin resultados da cero, no error', sinNada.total, 0);

    // Suspende una para poder filtrar por estado.
    datos.licencias[0].estado = 'suspendida';
    const porEstado = await servicio.listar({ estado: 'suspendida', pagina: 1, limite: 20 } as any);
    igual('tambien se puede filtrar por estado', porEstado.total, 1);

    prueba('las claves vuelven descifradas y legibles',
      p1.datos.every((l) => /^LIC-/.test(l.clave_original ?? '')));
  }

  // ------------------------------------------------------------ cambio de PC
  seccion('Cambio de PC: liberar la instalacion vieja');

  {
    const datos = escenario();
    const { db } = crearBaseFalsa(datos);
    await sincronizarLicenciasConPlan(db, 'com-1', BASICO);
    const licencia = datos.licencias[0];

    // El comercio activo su unica maquina: el cupo quedo consumido.
    licencia.max_activaciones = 0;
    datos.activaciones.push({ id: 'act-vieja', licencia_id: licencia.id, instalacion_id: 'pc-vieja', ultima_validacion: enDias(-3) });
    datos.activaciones.push({ id: 'act-ajena', licencia_id: 'otra-licencia', instalacion_id: 'pc-x', ultima_validacion: enDias(-1) });

    const servicio = new LicenciaPanelService(db);

    await falla('no se libera una instalacion de otra licencia',
      /no existe o no pertenece/i, () => servicio.liberarActivacion(licencia.id, 'act-ajena'));
    igual('y el cupo no se toca al rechazar', licencia.max_activaciones, 0);

    const r = await servicio.liberarActivacion(licencia.id, 'act-vieja');
    igual('liberar devuelve el cupo', licencia.max_activaciones, 1);
    igual('la instalacion vieja desaparece', datos.activaciones.some((a) => a.id === 'act-vieja'), false);
    igual('la licencia queda sin instalaciones', r.licencia.activaciones_restantes, 0);
    prueba('y el mensaje explica que hacer', /activar la misma clave/i.test(r.message));

    await falla('liberar dos veces la misma no duplica el cupo',
      /no existe o no pertenece/i, () => servicio.liberarActivacion(licencia.id, 'act-vieja'));
    igual('el cupo sigue en uno', licencia.max_activaciones, 1);
  }
}
