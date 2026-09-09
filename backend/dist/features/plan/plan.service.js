import prisma from '../../config/prisma';
export class PlanService {
    db;
    /**
     * El cliente de base entra por constructor para poder ejercitar este
     * servicio con datos controlados, sin Postgres. En produccion nadie pasa
     * nada y usa el cliente real.
     */
    constructor(db = prisma) {
        this.db = db;
    }
    async crear(data) {
        const existente = await this.db.plan.findUnique({ where: { codigo: data.codigo } });
        if (existente) {
            const error = new Error(`Ya existe un plan con el código ${data.codigo}`);
            error.statusCode = 409;
            throw error;
        }
        const plan = await this.db.plan.create({
            data: {
                codigo: data.codigo,
                nombre: data.nombre,
                descripcion: data.descripcion ?? null,
                precio_mensual: data.precio_mensual,
                precio_anual: data.precio_anual ?? null,
                moneda: data.moneda,
                max_servidores: data.max_servidores,
                max_clientes: data.max_clientes,
                chat_mensajes_mes: data.chat_mensajes_mes,
                activo: data.activo,
            },
            include: { _count: { select: { suscripciones: true } } },
        });
        return this.serializar(plan);
    }
    async getAll(soloActivos = false) {
        const planes = await this.db.plan.findMany({
            where: soloActivos ? { activo: true } : undefined,
            include: { _count: { select: { suscripciones: true } } },
            orderBy: { precio_mensual: 'asc' },
        });
        return planes.map((plan) => this.serializar(plan));
    }
    async getById(id) {
        const plan = await this.db.plan.findUnique({
            where: { id },
            include: { _count: { select: { suscripciones: true } } },
        });
        if (!plan) {
            const error = new Error('Plan no encontrado');
            error.statusCode = 404;
            throw error;
        }
        return this.serializar(plan);
    }
    async actualizar(id, data) {
        await this.getById(id);
        const plan = await this.db.plan.update({
            where: { id },
            data: {
                ...(data.nombre !== undefined && { nombre: data.nombre }),
                ...(data.descripcion !== undefined && { descripcion: data.descripcion ?? null }),
                ...(data.precio_mensual !== undefined && { precio_mensual: data.precio_mensual }),
                ...(data.precio_anual !== undefined && { precio_anual: data.precio_anual ?? null }),
                ...(data.moneda !== undefined && { moneda: data.moneda }),
                ...(data.max_servidores !== undefined && { max_servidores: data.max_servidores }),
                ...(data.max_clientes !== undefined && { max_clientes: data.max_clientes }),
                ...(data.chat_mensajes_mes !== undefined && { chat_mensajes_mes: data.chat_mensajes_mes }),
                ...(data.activo !== undefined && { activo: data.activo }),
            },
            include: { _count: { select: { suscripciones: true } } },
        });
        return this.serializar(plan);
    }
    /**
     * Baja logica. Un plan con suscripciones contratadas no se borra nunca: se
     * desactiva, deja de ofrecerse, y los comercios que lo tienen siguen
     * facturando al precio que pactaron.
     */
    async desactivar(id) {
        await this.getById(id);
        const plan = await this.db.plan.update({
            where: { id },
            data: { activo: false },
            include: { _count: { select: { suscripciones: true } } },
        });
        return this.serializar(plan);
    }
    async eliminar(id) {
        const plan = await this.getById(id);
        if (plan.suscripciones_activas > 0) {
            const error = new Error('El plan tiene suscripciones asociadas y no se puede eliminar. Desactivalo en su lugar.');
            error.statusCode = 409;
            throw error;
        }
        await this.db.plan.delete({ where: { id } });
    }
    serializar(plan) {
        return {
            id: plan.id,
            codigo: plan.codigo,
            nombre: plan.nombre,
            descripcion: plan.descripcion,
            precio_mensual: Number(plan.precio_mensual),
            precio_anual: plan.precio_anual === null ? null : Number(plan.precio_anual),
            moneda: plan.moneda,
            max_servidores: plan.max_servidores,
            max_clientes: plan.max_clientes,
            chat_mensajes_mes: plan.chat_mensajes_mes,
            activo: plan.activo,
            suscripciones_activas: plan._count?.suscripciones ?? 0,
            createdAt: plan.createdAt,
            updatedAt: plan.updatedAt,
        };
    }
}
