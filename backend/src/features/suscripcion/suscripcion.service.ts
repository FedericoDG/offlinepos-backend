import { EstadoSuscripcion } from '@prisma/client';
import prisma from '../../config/prisma';
import type { ClienteRaiz } from '../../config/prisma.tipos';
import { httpError } from '../../utils/api-error';
import { diasDeCalendarioHasta, DIAS_GRACIA, MS_POR_DIA } from './suscripcion.reglas';
import {
  AJUSTE_VACIO,
  sincronizarLicenciasConPlan,
  type AjusteLicencias,
} from '../licencia/licencia.provision';
import {
  ActualizarSuscripcionDTO,
  CrearSuscripcionDTO,
  FiltroSuscripcionDTO,
  RenovarSuscripcionDTO,
} from './suscripcion.dtos';


/** Suma meses conservando el dia; si el mes destino es mas corto, cae al ultimo dia. */
export function sumarMeses(fecha: Date, meses: number): Date {
  const resultado = new Date(fecha.getTime());
  const dia = resultado.getDate();
  resultado.setMonth(resultado.getMonth() + meses);
  if (resultado.getDate() < dia) {
    resultado.setDate(0);
  }
  return resultado;
}

const INCLUDE_COMPLETO = {
  comercio: { select: { id: true, nombre: true } },
  plan: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      precio_mensual: true,
      precio_anual: true,
      max_servidores: true,
      max_clientes: true,
    },
  },
  pagos: {
    orderBy: { pagado_en: 'desc' as const },
    take: 12,
    select: {
      id: true,
      monto: true,
      moneda: true,
      metodo: true,
      pagado_en: true,
      periodo_desde: true,
      periodo_hasta: true,
      referencia: true,
    },
  },
} as const;

export class SuscripcionService {
  /**
   * El cliente de base entra por constructor para poder ejercitar este
   * servicio con datos controlados, sin Postgres. En produccion nadie pasa
   * nada y usa el cliente real.
   */
  constructor(private readonly db: ClienteRaiz = prisma) {}

  async crear(data: CrearSuscripcionDTO) {
    const [comercio, plan] = await Promise.all([
      this.db.comercio.findUnique({ where: { id: data.comercio_id } }),
      this.db.plan.findUnique({ where: { id: data.plan_id } }),
    ]);

    if (!comercio) throw httpError('Comercio no encontrado', 404);
    if (!plan) throw httpError('Plan no encontrado', 404);

    const activa = await this.db.suscripcion.findFirst({
      where: { comercio_id: data.comercio_id, estado: { not: EstadoSuscripcion.CANCELADA } },
    });
    if (activa) {
      throw httpError('El comercio ya tiene una suscripción vigente. Editala o cancelala antes de crear otra.', 409);
    }

    const inicia = data.inicia_en ?? new Date();
    const vence = data.vence_en ?? sumarMeses(inicia, data.ciclo === 'ANUAL' ? 12 : 1);

    if (vence <= inicia) {
      throw httpError('La fecha de vencimiento debe ser posterior a la de inicio', 400);
    }

    const precioLista =
      data.ciclo === 'ANUAL'
        ? Number(plan.precio_anual ?? Number(plan.precio_mensual) * 12)
        : Number(plan.precio_mensual);

    // Contratar el plan es lo que materializa las licencias: el cupo que
    // declara el plan (1 servidor para Basico, 1 servidor + 2 clientes para
    // Pro) se emite aca. Va en la misma transaccion que la suscripcion porque
    // un comercio con contrato y sin claves no puede abrir la caja.
    const { suscripcion, ajuste } = await this.db.$transaction(async (tx) => {
      const creada = await tx.suscripcion.create({
        data: {
          comercio_id: comercio.id,
          plan_id: plan.id,
          ciclo: data.ciclo,
          precio_pactado: data.precio_pactado ?? precioLista,
          moneda: plan.moneda,
          inicia_en: inicia,
          vence_en: vence,
          estado: EstadoSuscripcion.ACTIVA,
          nota: data.nota ?? null,
        },
      });

      // El pago del primer periodo. Va aca y no en una llamada aparte porque
      // si falla, tampoco tiene que quedar la suscripcion: un contrato sin su
      // primer cobro es justo el estado que no queremos poder representar.
      await tx.pago.create({
        data: {
          suscripcion_id: creada.id,
          monto: creada.precio_pactado,
          moneda: creada.moneda,
          metodo: data.metodo_pago,
          pagado_en: data.pagado_en ?? inicia,
          periodo_desde: inicia,
          periodo_hasta: vence,
          referencia: data.referencia_pago ?? null,
          nota: 'Primer pago, registrado al contratar el plan.',
        },
      });

      const ajusteLicencias = await sincronizarLicenciasConPlan(tx, comercio.id, plan);

      const completa = await tx.suscripcion.findUniqueOrThrow({
        where: { id: creada.id },
        include: INCLUDE_COMPLETO,
      });

      return { suscripcion: completa, ajuste: ajusteLicencias };
    });

    return this.serializar(suscripcion, ajuste);
  }

  async getAll(filtro: FiltroSuscripcionDTO = {}) {
    const where: any = {};
    if (filtro.comercio_id) where.comercio_id = filtro.comercio_id;
    if (filtro.plan_id) where.plan_id = filtro.plan_id;
    if (filtro.estado) where.estado = filtro.estado;
    if (filtro.vence_en_dias !== undefined) {
      where.vence_en = { lte: new Date(Date.now() + filtro.vence_en_dias * MS_POR_DIA) };
      where.estado = where.estado ?? { not: EstadoSuscripcion.CANCELADA };
    }

    const suscripciones = await this.db.suscripcion.findMany({
      where,
      include: INCLUDE_COMPLETO,
      orderBy: { vence_en: 'asc' },
    });

    return suscripciones.map((s) => this.serializar(s));
  }

  async getById(id: string) {
    const suscripcion = await this.db.suscripcion.findUnique({ where: { id }, include: INCLUDE_COMPLETO });
    if (!suscripcion) throw httpError('Suscripción no encontrada', 404);
    return this.serializar(suscripcion);
  }

  async actualizar(id: string, data: ActualizarSuscripcionDTO) {
    const actual = await this.db.suscripcion.findUnique({ where: { id } });
    if (!actual) throw httpError('Suscripción no encontrada', 404);

    // Solo se reajustan licencias si el plan realmente cambia. Editar el
    // precio o la nota no tiene por que tocarle las claves a nadie.
    const planNuevo =
      data.plan_id && data.plan_id !== actual.plan_id
        ? await this.db.plan.findUnique({ where: { id: data.plan_id } })
        : null;

    if (data.plan_id && data.plan_id !== actual.plan_id && !planNuevo) {
      throw httpError('Plan no encontrado', 404);
    }

    const { suscripcion, ajuste } = await this.db.$transaction(async (tx) => {
      await tx.suscripcion.update({
        where: { id },
        data: {
          ...(data.plan_id !== undefined && { plan_id: data.plan_id }),
          ...(data.ciclo !== undefined && { ciclo: data.ciclo }),
          ...(data.precio_pactado !== undefined && { precio_pactado: data.precio_pactado }),
          ...(data.vence_en !== undefined && { vence_en: data.vence_en }),
          ...(data.estado !== undefined && {
            estado: data.estado,
            cancelada_en: data.estado === 'CANCELADA' ? (actual.cancelada_en ?? new Date()) : null,
          }),
          ...(data.nota !== undefined && { nota: data.nota }),
        },
      });

      const ajusteLicencias = planNuevo
        ? await sincronizarLicenciasConPlan(tx, actual.comercio_id, planNuevo)
        : AJUSTE_VACIO;

      const completa = await tx.suscripcion.findUniqueOrThrow({
        where: { id },
        include: INCLUDE_COMPLETO,
      });

      return { suscripcion: completa, ajuste: ajusteLicencias };
    });

    return this.serializar(suscripcion, ajuste);
  }

  /**
   * Corre el vencimiento N periodos. El punto de partida es el vencimiento
   * anterior cuando la suscripcion sigue viva (asi no se regalan dias al que
   * paga temprano) y la fecha de hoy cuando ya vencio hace rato (asi no se
   * cobra un periodo que el comercio no uso).
   */
  async renovar(id: string, data: RenovarSuscripcionDTO) {
    const actual = await this.db.suscripcion.findUnique({ where: { id } });
    if (!actual) throw httpError('Suscripción no encontrada', 404);
    if (actual.estado === EstadoSuscripcion.CANCELADA) {
      throw httpError('La suscripción está cancelada. Reactivala antes de renovar.', 409);
    }

    const mesesPorPeriodo = actual.ciclo === 'ANUAL' ? 12 : 1;
    const hoy = new Date();
    const desde = actual.vence_en > hoy ? actual.vence_en : hoy;
    const nuevoVencimiento = sumarMeses(desde, mesesPorPeriodo * data.periodos);

    const resultado = await this.db.$transaction(async (tx) => {
      const suscripcion = await tx.suscripcion.update({
        where: { id },
        data: { vence_en: nuevoVencimiento, estado: EstadoSuscripcion.ACTIVA },
        include: INCLUDE_COMPLETO,
      });

      if (data.registrar_pago) {
        await tx.pago.create({
          data: {
            suscripcion_id: id,
            monto: data.monto ?? Number(actual.precio_pactado) * data.periodos,
            moneda: actual.moneda,
            metodo: data.metodo,
            pagado_en: data.pagado_en ?? hoy,
            periodo_desde: desde,
            periodo_hasta: nuevoVencimiento,
            referencia: data.referencia ?? null,
            nota: data.nota ?? null,
          },
        });
      }

      return suscripcion;
    });

    return this.serializar(resultado);
  }

  async cancelar(id: string) {
    const actual = await this.db.suscripcion.findUnique({ where: { id } });
    if (!actual) throw httpError('Suscripción no encontrada', 404);

    const suscripcion = await this.db.suscripcion.update({
      where: { id },
      data: { estado: EstadoSuscripcion.CANCELADA, cancelada_en: new Date() },
      include: INCLUDE_COMPLETO,
    });

    return this.serializar(suscripcion);
  }

  async eliminar(id: string) {
    const actual = await this.db.suscripcion.findUnique({ where: { id } });
    if (!actual) throw httpError('Suscripción no encontrada', 404);
    await this.db.suscripcion.delete({ where: { id } });
  }

  /**
   * El estado guardado es lo que se decidio a mano; el efectivo es lo que
   * corresponde hoy segun el calendario. Se calcula al leer en vez de con una
   * tarea programada: una suscripcion no puede quedar "activa" en el panel
   * solo porque el cron no corrio.
   */
  private estadoEfectivo(estado: EstadoSuscripcion, vence: Date): EstadoSuscripcion {
    if (estado === EstadoSuscripcion.CANCELADA) return EstadoSuscripcion.CANCELADA;

    const ahora = Date.now();
    const vencimiento = vence.getTime();
    if (ahora <= vencimiento) return EstadoSuscripcion.ACTIVA;
    if (ahora <= vencimiento + DIAS_GRACIA * MS_POR_DIA) return EstadoSuscripcion.EN_GRACIA;
    return EstadoSuscripcion.VENCIDA;
  }

  private serializar(s: any, ajuste: AjusteLicencias = AJUSTE_VACIO) {
    const diasRestantes = diasDeCalendarioHasta(s.vence_en);

    return {
      id: s.id,
      estado: s.estado,
      estado_efectivo: this.estadoEfectivo(s.estado, s.vence_en),
      dias_restantes: diasRestantes,
      dias_gracia: DIAS_GRACIA,
      ciclo: s.ciclo,
      precio_pactado: Number(s.precio_pactado),
      moneda: s.moneda,
      inicia_en: s.inicia_en,
      vence_en: s.vence_en,
      cancelada_en: s.cancelada_en,
      nota: s.nota,
      comercio: s.comercio,
      plan: s.plan
        ? {
            ...s.plan,
            precio_mensual: Number(s.plan.precio_mensual),
            precio_anual: s.plan.precio_anual === null ? null : Number(s.plan.precio_anual),
          }
        : null,
      pagos: (s.pagos ?? []).map((p: any) => ({ ...p, monto: Number(p.monto) })),
      /** Que licencias toco esta operacion. Vacio en las lecturas. */
      ajuste_licencias: ajuste,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}
