import prisma from '../../config/prisma';
import type { ClienteRaiz } from '../../config/prisma.tipos';
import { httpError } from '../../utils/api-error';
import { FiltroPagoDTO, RegistrarPagoDTO } from './pago.dtos';

const INCLUDE_COMPLETO = {
  suscripcion: {
    select: {
      id: true,
      ciclo: true,
      vence_en: true,
      comercio: { select: { id: true, nombre: true } },
      plan: { select: { id: true, codigo: true, nombre: true } },
    },
  },
} as const;

export class PagoService {
  /**
   * El cliente de base entra por constructor para poder ejercitar este
   * servicio con datos controlados, sin Postgres. En produccion nadie pasa
   * nada y usa el cliente real.
   */
  constructor(private readonly db: ClienteRaiz = prisma) {}

  async registrar(data: RegistrarPagoDTO) {
    const suscripcion = await this.db.suscripcion.findUnique({ where: { id: data.suscripcion_id } });
    if (!suscripcion) throw httpError('Suscripción no encontrada', 404);

    if (data.periodo_hasta <= data.periodo_desde) {
      throw httpError('El fin del período debe ser posterior a su inicio', 400);
    }

    const pago = await this.db.pago.create({
      data: {
        suscripcion_id: suscripcion.id,
        monto: data.monto,
        moneda: data.moneda ?? suscripcion.moneda,
        metodo: data.metodo,
        pagado_en: data.pagado_en ?? new Date(),
        periodo_desde: data.periodo_desde,
        periodo_hasta: data.periodo_hasta,
        referencia: data.referencia ?? null,
        nota: data.nota ?? null,
      },
      include: INCLUDE_COMPLETO,
    });

    return this.serializar(pago);
  }

  async getAll(filtro: FiltroPagoDTO) {
    const where: any = {};
    if (filtro.suscripcion_id) where.suscripcion_id = filtro.suscripcion_id;
    if (filtro.metodo) where.metodo = filtro.metodo;
    if (filtro.desde || filtro.hasta) {
      where.pagado_en = {
        ...(filtro.desde && { gte: filtro.desde }),
        ...(filtro.hasta && { lte: filtro.hasta }),
      };
    }

    // Los dos filtros de comercio conviven en el mismo `suscripcion`, asi que
    // se arma una sola vez: pisarlo con dos asignaciones perderia el primero.
    const porComercio: any = {};
    if (filtro.comercio_id) porComercio.comercio_id = filtro.comercio_id;
    if (filtro.q) porComercio.comercio = { nombre: { contains: filtro.q, mode: 'insensitive' } };
    if (Object.keys(porComercio).length > 0) where.suscripcion = porComercio;

    // El total sale del mismo `where` que la pagina, para que el paginador no
    // mienta apenas alguien escribe en el buscador.
    const [total, pagos] = await Promise.all([
      this.db.pago.count({ where }),
      this.db.pago.findMany({
        where,
        include: INCLUDE_COMPLETO,
        orderBy: { pagado_en: 'desc' },
        skip: (filtro.pagina - 1) * filtro.limite,
        take: filtro.limite,
      }),
    ]);

    return {
      datos: pagos.map((p) => this.serializar(p)),
      total,
      pagina: filtro.pagina,
      limite: filtro.limite,
      paginas: Math.max(1, Math.ceil(total / filtro.limite)),
    };
  }

  /** Suma de todo lo que matchea el filtro, no solo de la pagina que se ve. */
  async totalFiltrado(filtro: FiltroPagoDTO): Promise<number> {
    const where: any = {};
    if (filtro.suscripcion_id) where.suscripcion_id = filtro.suscripcion_id;
    if (filtro.metodo) where.metodo = filtro.metodo;
    if (filtro.desde || filtro.hasta) {
      where.pagado_en = {
        ...(filtro.desde && { gte: filtro.desde }),
        ...(filtro.hasta && { lte: filtro.hasta }),
      };
    }

    const porComercio: any = {};
    if (filtro.comercio_id) porComercio.comercio_id = filtro.comercio_id;
    if (filtro.q) porComercio.comercio = { nombre: { contains: filtro.q, mode: 'insensitive' } };
    if (Object.keys(porComercio).length > 0) where.suscripcion = porComercio;

    const suma = await this.db.pago.aggregate({ where, _sum: { monto: true } });
    return Number(suma._sum.monto ?? 0);
  }

  async getById(id: string) {
    const pago = await this.db.pago.findUnique({ where: { id }, include: INCLUDE_COMPLETO });
    if (!pago) throw httpError('Pago no encontrado', 404);
    return this.serializar(pago);
  }

  async eliminar(id: string) {
    const pago = await this.db.pago.findUnique({ where: { id } });
    if (!pago) throw httpError('Pago no encontrado', 404);
    await this.db.pago.delete({ where: { id } });
  }

  private serializar(pago: any) {
    return {
      id: pago.id,
      monto: Number(pago.monto),
      moneda: pago.moneda,
      metodo: pago.metodo,
      pagado_en: pago.pagado_en,
      periodo_desde: pago.periodo_desde,
      periodo_hasta: pago.periodo_hasta,
      referencia: pago.referencia,
      nota: pago.nota,
      suscripcion: pago.suscripcion ?? null,
      createdAt: pago.createdAt,
      updatedAt: pago.updatedAt,
    };
  }
}
