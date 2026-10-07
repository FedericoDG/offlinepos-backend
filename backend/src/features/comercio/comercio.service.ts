import prisma from '../../config/prisma';
import type { ClientePrisma } from '../../config/prisma.tipos';
import { env } from '../../config/env';
import { encrypt, decrypt } from '../../utils/encryption';
import { httpError } from '../../utils/api-error';
import { validarCupoAsignacion } from '../licencia/licencia.provision';
import { CreateComercioConLicenciaDTO, RegistrarPagoDirectoDTO, UpdateComercioDTO } from './comercio.dtos';
import {
  calcularDeuda,
  finDeMes,
  inicioDeMes,
  mascaraClave,
  periodoActual,
} from './comercio.resumen';

export class ComercioService {
  /**
   * Alta de comercio en un paso: crea el comercio, le asigna el plan y le
   * asigna las claves libres elegidas, validando el cupo del plan sobre lo que
   * se asigna. Acepta tambien el camino viejo: `{ nombre }` solo crea un
   * comercio vacio, y `licencia` permite crear comercio + una clave propia.
   */
  async createConLicencia(data: CreateComercioConLicenciaDTO) {
    return prisma.$transaction(async (tx) => {
      if (data.plan_id) {
        const plan = await tx.plan.findUnique({ where: { id: data.plan_id } });
        if (!plan) throw httpError('Plan no encontrado', 404);
        if (!plan.activo) throw httpError('El plan está inactivo. Elegí un plan activo para el alta.', 409);
      }

      const licenciaInicial = data.licencia
        ? {
            create: {
              clave_hash: encrypt(data.licencia.clave),
              rol: 'SERVIDOR' as const,
              max_activaciones: data.licencia.max_activaciones,
              estado: data.licencia.estado,
            },
          }
        : undefined;

      const comercio = await tx.comercio.create({
        data: {
          nombre: data.nombre,
          telefono: data.telefono ?? null,
          email: data.email ?? null,
          ...(data.plan_id && { plan_id: data.plan_id }),
          ...(licenciaInicial && { licencias: licenciaInicial }),
        },
      });

      const licencias_asignadas = await this.asignarClaves(tx, comercio.id, data.licencia_ids);

      const creado = await tx.comercio.findUniqueOrThrow({
        where: { id: comercio.id },
        include: {
          licencias: {
            select: {
              id: true,
              clave_hash: true,
              rol: true,
              estado: true,
              max_activaciones: true,
              activado_en: true,
              activaciones: {
                select: {
                  id: true,
                  instalacion_id: true,
                  ultima_validacion: true,
                  createdAt: true,
                  updatedAt: true,
                },
              },
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

      return {
        ...creado,
        licencias: creado.licencias.map((lic) => ({
          ...lic,
          clave_original: this.desencriptarSeguro(lic.clave_hash),
        })),
        licencias_asignadas,
      };
    });
  }

  /**
   * Asigna claves libres a un comercio dentro de la transaccion del alta.
   * Valida que existan, que sigan libres y que el cupo del plan las cubra;
   * recien despues las marca como del comercio.
   */
  private async asignarClaves(
    tx: ClientePrisma,
    comercioId: string,
    licenciaIds: string[]
  ): Promise<{ id: string }[]> {
    const unicas = Array.from(new Set(licenciaIds));
    if (unicas.length === 0) return [];

    const licencias = await tx.licencia.findMany({ where: { id: { in: unicas } } });

    if (licencias.length !== unicas.length) {
      throw httpError('Alguna de las claves elegidas no existe', 404);
    }

    if (licencias.some((licencia) => licencia.comercio_id !== null)) {
      throw httpError('Alguna de las claves elegidas ya está asignada a un comercio', 409);
    }

    // El cupo se controla al asignar: se cuentan las claves que ya son del
    // comercio mas las que vienen en esta operacion.
    await validarCupoAsignacion(tx, comercioId, { servidores: licencias.length });

    await tx.licencia.updateMany({
      where: { id: { in: unicas } },
      data: { comercio_id: comercioId },
    });

    return licencias.map((licencia) => ({ id: licencia.id }));
  }

  async getAll() {
    const comercios = await prisma.comercio.findMany({
      include: {
        // Plan anidado liviano: el listado lo necesita para mostrar nombre y
        // precio sin cruzar el catalogo entero en el cliente.
        plan: { select: { id: true, nombre: true, precio_mensual: true, chat_mensajes_mes: true } },
        licencias: {
          select: {
            id: true,
            clave_hash: true,
            rol: true,
            estado: true,
            max_activaciones: true,
            activado_en: true,
            activaciones: {
              select: {
                id: true,
                instalacion_id: true,
                ultima_validacion: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        },
        // Solo el fin de periodo de cada pago: alcanza para estimar la deuda sin
        // traer los pagos enteros al listado.
        pagos: { select: { periodo_hasta: true } },
        suscripciones: { select: { pagos: { select: { periodo_hasta: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return comercios.map((comercio) => {
      // El camino viejo de pagos (via Suscripcion) tambien cuenta para la deuda:
      // un comercio legacy no debe aparecer debiendo por no usar el modelo nuevo.
      const { pagos, suscripciones, ...resto } = comercio;
      const periodosCubiertos = [
        ...pagos.map((pago) => pago.periodo_hasta),
        ...suscripciones.flatMap((suscripcion) => suscripcion.pagos.map((pago) => pago.periodo_hasta)),
      ];
      const ultimoPeriodo = periodosCubiertos.length
        ? new Date(Math.max(...periodosCubiertos.map((fecha) => fecha.getTime())))
        : null;
      const deuda = calcularDeuda(comercio.plan, comercio.createdAt, ultimoPeriodo);

      return {
        ...resto,
        plan: comercio.plan
          ? { ...comercio.plan, precio_mensual: Number(comercio.plan.precio_mensual) }
          : null,
        licencias: comercio.licencias.map((lic) => ({
          ...lic,
          clave_original: this.desencriptarSeguro(lic.clave_hash),
        })),
        claves_activas: comercio.licencias.filter((lic) => lic.estado === 'activa').length,
        deuda_periodos: deuda.periodos_impagos,
      };
    });
  }

  async getById(id: string) {
    const comercio = await prisma.comercio.findUnique({
      where: { id },
      include: {
        licencias: {
          select: {
            id: true,
            clave_hash: true,
            rol: true,
            estado: true,
            max_activaciones: true,
            activado_en: true,
            activaciones: {
              select: {
                id: true,
                instalacion_id: true,
                ultima_validacion: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!comercio) {
      throw new Error('Comercio no encontrado');
    }

    return {
      ...comercio,
      licencias: comercio.licencias.map((lic) => ({
        ...lic,
        clave_original: this.desencriptarSeguro(lic.clave_hash),
      })),
    };
  }

  async update(id: string, data: UpdateComercioDTO) {
    await this.getById(id);

    const comercio = await prisma.comercio.update({
      where: { id },
      data,
      include: {
        licencias: {
          select: {
            id: true,
            clave_hash: true,
            rol: true,
            estado: true,
            max_activaciones: true,
            activado_en: true,
            activaciones: {
              select: {
                id: true,
                instalacion_id: true,
                ultima_validacion: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    return {
      ...comercio,
      licencias: comercio.licencias.map((lic) => ({
        ...lic,
        clave_original: this.desencriptarSeguro(lic.clave_hash),
      })),
    };
  }

  async delete(id: string) {
    await this.getById(id);

    return prisma.comercio.delete({
      where: { id },
    });
  }

  /**
   * Registra un pago directo del comercio (sin Suscripcion). El monto lo manda
   * el panel; el periodo, si no viene, cubre el mes en curso para que un pago
   * "de ahora" deje la deuda estimada en cero.
   */
  async registrarPago(comercioId: string, data: RegistrarPagoDirectoDTO) {
    const comercio = await prisma.comercio.findUnique({
      where: { id: comercioId },
      include: {
        plan: { select: { moneda: true } },
        suscripciones: {
          where: { estado: { not: 'CANCELADA' } },
          orderBy: { inicia_en: 'desc' },
          take: 1,
          include: { plan: { select: { moneda: true } } },
        },
      },
    });

    if (!comercio) throw httpError('Comercio no encontrado', 404);

    const pagadoEn = data.pagado_en ?? new Date();
    const periodoDesde = data.periodo_desde ?? inicioDeMes(pagadoEn);
    const periodoHasta = data.periodo_hasta ?? finDeMes(pagadoEn);

    if (periodoHasta <= periodoDesde) {
      throw httpError('El fin del período debe ser posterior a su inicio', 400);
    }

    const moneda = comercio.plan?.moneda ?? comercio.suscripciones[0]?.plan.moneda ?? 'ARS';

    const pago = await prisma.pago.create({
      data: {
        comercio_id: comercioId,
        suscripcion_id: null,
        monto: data.monto,
        moneda,
        metodo: data.metodo,
        pagado_en: pagadoEn,
        periodo_desde: periodoDesde,
        periodo_hasta: periodoHasta,
        nota: data.nota ?? null,
      },
    });

    return this.serializarPago(pago);
  }

  /**
   * Todo lo que necesita la futura pantalla de detalle en una sola vuelta:
   * datos del comercio, plan, claves (con mascara), consumo de chat del mes,
   * pagos y deuda estimada.
   */
  async getDetalle(id: string) {
    const comercio = await prisma.comercio.findUnique({
      where: { id },
      include: {
        plan: true,
        // Contador a nivel comercio: el cupo de Binny es del comercio y se
        // comparte entre sus claves.
        chatConsumosComercio: { where: { periodo: periodoActual() } },
        licencias: {
          include: {
            activaciones: {
              select: { ultima_validacion: true },
              orderBy: { ultima_validacion: 'desc' },
            },
            chatConsumos: { where: { periodo: periodoActual() } },
          },
          orderBy: { createdAt: 'asc' },
        },
        pagos: { orderBy: { pagado_en: 'desc' } },
        // Se incluyen tambien los pagos del camino viejo: un comercio legacy
        // tiene que mostrar su historial igual.
        suscripciones: {
          include: {
            plan: { select: { chat_mensajes_mes: true } },
            pagos: { orderBy: { pagado_en: 'desc' } },
          },
        },
      },
    });

    if (!comercio) throw httpError('Comercio no encontrado', 404);

    // Dedupe por id: un pago no deberia tener las dos referencias, pero si
    // pasara no queremos mostrarlo dos veces.
    const pagosPorId = new Map<string, (typeof comercio.pagos)[number]>();
    for (const pago of comercio.pagos) pagosPorId.set(pago.id, pago);
    for (const suscripcion of comercio.suscripciones) {
      for (const pago of suscripcion.pagos) pagosPorId.set(pago.id, pago);
    }
    const pagos = [...pagosPorId.values()].sort(
      (a, b) => b.pagado_en.getTime() - a.pagado_en.getTime()
    );

    const ultimoPeriodo = pagos.length
      ? new Date(Math.max(...pagos.map((pago) => pago.periodo_hasta.getTime())))
      : null;
    const deuda = calcularDeuda(comercio.plan, comercio.createdAt, ultimoPeriodo);

    const periodo = periodoActual();
    const porClave = comercio.licencias.map((licencia) => {
      const consumo = licencia.chatConsumos[0];
      return {
        clave_mascara: mascaraClave(this.desencriptarSeguro(licencia.clave_hash)),
        rol: licencia.rol,
        mensajes: consumo?.mensajes ?? 0,
        tokens: Number(consumo?.total_tokens ?? 0),
      };
    });

    // Total del periodo: manda el contador del comercio (cupo compartido). Si
    // todavia no existe la fila, se cae a la suma del desglose por clave.
    const totalPorClave = porClave.reduce((acc, clave) => acc + clave.mensajes, 0);
    const totalMensajes = comercio.chatConsumosComercio[0]?.mensajes ?? totalPorClave;

    return {
      comercio: {
        id: comercio.id,
        nombre: comercio.nombre,
        telefono: comercio.telefono,
        email: comercio.email,
        createdAt: comercio.createdAt,
      },
      plan: comercio.plan
        ? {
            id: comercio.plan.id,
            nombre: comercio.plan.nombre,
            precio_mensual: Number(comercio.plan.precio_mensual),
            precio_anual: comercio.plan.precio_anual != null ? Number(comercio.plan.precio_anual) : null,
            max_servidores: comercio.plan.max_servidores,
            chat_mensajes_mes: comercio.plan.chat_mensajes_mes,
          }
        : null,
      claves: comercio.licencias.map((licencia) => ({
        id: licencia.id,
        rol: licencia.rol,
        estado: licencia.estado,
        activaciones: licencia.activaciones.length,
        ultima_activacion: licencia.activaciones[0]?.ultima_validacion ?? null,
        clave_mascara: mascaraClave(this.desencriptarSeguro(licencia.clave_hash)),
      })),
      consumo_chat: {
        periodo_actual: periodo,
        total_mensajes: totalMensajes,
        total_tokens: porClave.reduce((acc, clave) => acc + clave.tokens, 0),
        cupo: this.resolverCupoChat(comercio),
        por_clave: porClave,
      },
      pagos: pagos.map((pago) => this.serializarPago(pago)),
      deuda,
    };
  }

  /**
   * Cupo de chat del comercio, con el mismo orden que `chat.service`: override
   * del comercio (0 = ilimitado) > plan directo > plan de la suscripcion > env.
   */
  private resolverCupoChat(comercio: {
    chat_mensajes_override: number | null;
    plan: { chat_mensajes_mes: number } | null;
    suscripciones: { estado: string; plan: { chat_mensajes_mes: number } | null }[];
  }): number {
    if (comercio.chat_mensajes_override != null) return comercio.chat_mensajes_override;

    const planSuscripcion =
      comercio.suscripciones.find((suscripcion) => suscripcion.estado !== 'CANCELADA')?.plan ?? null;
    const plan = comercio.plan ?? planSuscripcion;

    return plan?.chat_mensajes_mes ?? env.CHAT_MENSAJES_MES;
  }

  private serializarPago(pago: {
    id: string;
    monto: unknown;
    moneda: string;
    metodo: string;
    pagado_en: Date;
    periodo_desde: Date;
    periodo_hasta: Date;
    nota: string | null;
  }) {
    return {
      id: pago.id,
      monto: Number(pago.monto),
      moneda: pago.moneda,
      metodo: pago.metodo,
      pagado_en: pago.pagado_en,
      periodo_desde: pago.periodo_desde,
      periodo_hasta: pago.periodo_hasta,
      nota: pago.nota ?? null,
    };
  }

  private desencriptarSeguro(encrypted: string): string | null {
    try {
      return decrypt(encrypted);
    } catch {
      return null;
    }
  }
}
