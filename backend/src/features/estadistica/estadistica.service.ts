import { EstadoSuscripcion } from '@prisma/client';
import prisma from '../../config/prisma';
import type { ClienteRaiz } from '../../config/prisma.tipos';
import { diasDeCalendarioHasta, DIAS_GRACIA, MS_POR_DIA } from '../suscripcion/suscripcion.reglas';
import { IngresoMensualDTO } from './estadistica.dtos';


const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function clavePeriodo(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
}

function etiquetaPeriodo(fecha: Date): string {
  return `${MESES_CORTOS[fecha.getMonth()]} ${String(fecha.getFullYear()).slice(-2)}`;
}

function inicioDeMes(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1, 0, 0, 0, 0);
}

export class EstadisticaService {
  /**
   * El cliente de base entra por constructor para poder ejercitar este
   * servicio con datos controlados, sin Postgres. En produccion nadie pasa
   * nada y usa el cliente real.
   */
  constructor(private readonly db: ClienteRaiz = prisma) {}

  /**
   * Serie de ingreso mensual de los ultimos N meses.
   *
   * Los meses sin un solo pago se devuelven en cero en vez de omitirse: un
   * hueco en el grafico tiene que verse como un mes malo, no como un mes que
   * no existio.
   */
  async ingresosMensuales(meses: number): Promise<IngresoMensualDTO[]> {
    const hoy = new Date();
    const desde = inicioDeMes(new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1));

    const pagos = await this.db.pago.findMany({
      where: { pagado_en: { gte: desde } },
      select: { monto: true, pagado_en: true },
    });

    const acumulado = new Map<string, { total: number; cantidad: number }>();
    for (const pago of pagos) {
      const clave = clavePeriodo(pago.pagado_en);
      const actual = acumulado.get(clave) ?? { total: 0, cantidad: 0 };
      actual.total += Number(pago.monto);
      actual.cantidad += 1;
      acumulado.set(clave, actual);
    }

    const serie: IngresoMensualDTO[] = [];
    for (let i = 0; i < meses; i++) {
      const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1) + i, 1);
      const clave = clavePeriodo(fecha);
      const datos = acumulado.get(clave) ?? { total: 0, cantidad: 0 };
      serie.push({
        periodo: clave,
        etiqueta: etiquetaPeriodo(fecha),
        total: Math.round(datos.total * 100) / 100,
        cantidad_pagos: datos.cantidad,
      });
    }

    return serie;
  }

  /**
   * Suscripciones ordenadas por cercania al vencimiento. Incluye las que ya
   * vencieron (dias_restantes negativo): el que ya debe es mas urgente que el
   * que vence el mes que viene, y esconderlo seria justo al reves.
   */
  async proximosVencimientos(dias: number) {
    const limite = new Date(Date.now() + dias * MS_POR_DIA);

    const suscripciones = await this.db.suscripcion.findMany({
      where: {
        estado: { not: EstadoSuscripcion.CANCELADA },
        vence_en: { lte: limite },
      },
      include: {
        comercio: { select: { id: true, nombre: true } },
        plan: { select: { id: true, codigo: true, nombre: true } },
        pagos: { orderBy: { pagado_en: 'desc' }, take: 1, select: { pagado_en: true, monto: true } },
      },
      orderBy: { vence_en: 'asc' },
    });

    return suscripciones.map((s) => {
      // Los dias que se muestran son de calendario; si ya vencio y por cuanto
      // se decide con el tiempo real transcurrido, que es como esta definida
      // la gracia.
      const diasRestantes = diasDeCalendarioHasta(s.vence_en);
      const atraso = Date.now() - s.vence_en.getTime();
      const ultimoPago = s.pagos[0];

      return {
        id: s.id,
        comercio: s.comercio,
        plan: s.plan,
        ciclo: s.ciclo,
        precio_pactado: Number(s.precio_pactado),
        moneda: s.moneda,
        vence_en: s.vence_en,
        dias_restantes: diasRestantes,
        vencida: atraso > 0,
        en_gracia: atraso > 0 && atraso <= DIAS_GRACIA * MS_POR_DIA,
        ultimo_pago: ultimoPago ? { pagado_en: ultimoPago.pagado_en, monto: Number(ultimoPago.monto) } : null,
      };
    });
  }

  /**
   * Numeros de cabecera del panel. Todo lo que se mide contra "este mes" usa
   * el mes calendario en curso, que es como se mira la facturacion en la
   * practica, no una ventana movil de 30 dias.
   */
  async resumen() {
    const hoy = new Date();
    const inicioMes = inicioDeMes(hoy);
    const inicioMesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const limite30 = new Date(Date.now() + 30 * MS_POR_DIA);

    const [
      pagosMes,
      pagosMesAnterior,
      suscripciones,
      totalComercios,
      totalLicencias,
      totalActivaciones,
      porVencer,
    ] = await Promise.all([
      this.db.pago.aggregate({
        where: { pagado_en: { gte: inicioMes } },
        _sum: { monto: true },
        _count: true,
      }),
      this.db.pago.aggregate({
        where: { pagado_en: { gte: inicioMesAnterior, lt: inicioMes } },
        _sum: { monto: true },
        _count: true,
      }),
      this.db.suscripcion.findMany({
        select: { estado: true, ciclo: true, precio_pactado: true, vence_en: true },
      }),
      this.db.comercio.count(),
      this.db.licencia.count(),
      this.db.activacion.count(),
      this.db.suscripcion.count({
        where: { estado: { not: EstadoSuscripcion.CANCELADA }, vence_en: { lte: limite30 } },
      }),
    ]);

    const ingresoMes = Number(pagosMes._sum.monto ?? 0);
    const ingresoMesAnterior = Number(pagosMesAnterior._sum.monto ?? 0);
    const variacion =
      ingresoMesAnterior === 0
        ? null
        : Math.round(((ingresoMes - ingresoMesAnterior) / ingresoMesAnterior) * 1000) / 10;

    let activas = 0;
    let enGracia = 0;
    let vencidas = 0;
    let canceladas = 0;
    /** Ingreso recurrente mensual: lo anual se prorratea a doce para poder sumarlo. */
    let mrr = 0;

    for (const s of suscripciones) {
      if (s.estado === EstadoSuscripcion.CANCELADA) {
        canceladas += 1;
        continue;
      }

      const atraso = Date.now() - s.vence_en.getTime();
      if (atraso <= 0) activas += 1;
      else if (atraso <= DIAS_GRACIA * MS_POR_DIA) enGracia += 1;
      else vencidas += 1;

      if (atraso <= DIAS_GRACIA * MS_POR_DIA) {
        mrr += s.ciclo === 'ANUAL' ? Number(s.precio_pactado) / 12 : Number(s.precio_pactado);
      }
    }

    return {
      ingreso_mes: Math.round(ingresoMes * 100) / 100,
      pagos_mes: pagosMes._count,
      ingreso_mes_anterior: Math.round(ingresoMesAnterior * 100) / 100,
      variacion_mensual: variacion,
      mrr: Math.round(mrr * 100) / 100,
      suscripciones: {
        activas,
        en_gracia: enGracia,
        vencidas,
        canceladas,
        total: suscripciones.length,
      },
      por_vencer_30_dias: porVencer,
      comercios: totalComercios,
      licencias: totalLicencias,
      activaciones: totalActivaciones,
      dias_gracia: DIAS_GRACIA,
      generado_en: hoy,
    };
  }

  /** Reparto del ingreso del periodo por plan, para ver que se vende de verdad. */
  async ingresosPorPlan(meses: number) {
    const hoy = new Date();
    const desde = inicioDeMes(new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1));

    const pagos = await this.db.pago.findMany({
      where: { pagado_en: { gte: desde } },
      select: {
        monto: true,
        suscripcion: { select: { plan: { select: { id: true, codigo: true, nombre: true } } } },
      },
    });

    const acumulado = new Map<string, { plan_id: string; codigo: string; nombre: string; total: number; cantidad: number }>();

    for (const pago of pagos) {
      const plan = pago.suscripcion?.plan;
      if (!plan) continue;
      const actual =
        acumulado.get(plan.id) ?? { plan_id: plan.id, codigo: plan.codigo, nombre: plan.nombre, total: 0, cantidad: 0 };
      actual.total += Number(pago.monto);
      actual.cantidad += 1;
      acumulado.set(plan.id, actual);
    }

    return Array.from(acumulado.values())
      .map((fila) => ({ ...fila, total: Math.round(fila.total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);
  }

  async chatConsumo(periodo?: string): Promise<{
    resumen: { total_mensajes: number; total_tokens: number; total_costo_usd: number; comercios_activos: number };
    detalle: Array<{
      comercio_id: string;
      comercio: string;
      plan: string;
      mensajes_usados: number;
      mensajes_limite: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      costo_usd: number;
    }>;
  }> {
    const p = periodo || new Date().toISOString().slice(0, 7); // "2026-09"

    const consumos = await this.db.chatConsumo.findMany({
      where: { periodo: p },
      include: {
        licencia: {
          include: {
            comercio: true,
          },
        },
      },
    });

    const detalle = consumos.map((c) => {
      const comercio = c.licencia?.comercio;
      const plan = 'plan' in (c.licencia as any) ? (c.licencia as any).plan?.nombre ?? '' : '';
      const pt = Number(c.prompt_tokens);
      const ct = Number(c.completion_tokens);
      const costoUsd = Math.round((pt * 0.03 / 1_000_000 + ct * 0.13 / 1_000_000) * 10_000) / 10_000;

      return {
        comercio_id: c.licencia_id,
        comercio: comercio?.nombre ?? 'Desconocido',
        plan,
        mensajes_usados: c.mensajes,
        mensajes_limite: 500,
        prompt_tokens: pt,
        completion_tokens: ct,
        total_tokens: Number(c.total_tokens),
        costo_usd: costoUsd,
      };
    });

    const resumen = {
      total_mensajes: detalle.reduce((s, d) => s + d.mensajes_usados, 0),
      total_tokens: detalle.reduce((s, d) => s + d.total_tokens, 0),
      total_costo_usd: Math.round(detalle.reduce((s, d) => s + d.costo_usd, 0) * 10_000) / 10_000,
      comercios_activos: new Set(detalle.map((d) => d.comercio_id)).size,
    };

    return { resumen, detalle };
  }
}
