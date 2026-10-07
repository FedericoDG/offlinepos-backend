import prisma from '../../config/prisma';
import type { ClienteRaiz } from '../../config/prisma.tipos';
import { env } from '../../config/env';
import {
  ActualizarAdministradorDTO,
  AdministradorDTO,
  CrearAdministradorDTO,
  LoginDTO,
  LoginResponseDTO,
} from './administrador.dtos';
import { httpError } from '../../utils/api-error';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

/** Mismo costo de hash que usa el seed: un solo lugar para el numero. */
const SALT_ROUNDS = 10;

export class AdministradorService {
  /**
   * El cliente de base entra por constructor para poder ejercitar este
   * servicio con datos controlados, sin Postgres. En produccion nadie pasa
   * nada y usa el cliente real.
   */
  constructor(private readonly db: ClienteRaiz = prisma) {}

  async login({ email, password }: LoginDTO): Promise<LoginResponseDTO> {
    const admin = await this.db.administrador.findUnique({
      where: { email },
    });

    if (!admin) {
      throw new Error('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      throw new Error('Credenciales inválidas');
    }

    // Un administrador dado de baja no entra aunque sepa la contrasena.
    if (!admin.activo) {
      throw httpError('Usuario desactivado', 403);
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, rol: admin.rol },
      env.JWT_SECRET,
      { expiresIn: env.JWT_AT_EXPIRY as jwt.SignOptions['expiresIn'] }
    );

    return {
      token,
      administrador: {
        id: admin.id,
        email: admin.email,
        rol: admin.rol,
      },
    };
  }

  /** Listado del panel. `select` explicito: el hash de la contrasena nunca sale. */
  async listar(): Promise<AdministradorDTO[]> {
    const administradores = await this.db.administrador.findMany({
      select: { id: true, email: true, rol: true, activo: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    return administradores;
  }

  async crear(data: CrearAdministradorDTO): Promise<AdministradorDTO> {
    const existente = await this.db.administrador.findUnique({ where: { email: data.email } });
    if (existente) {
      throw httpError(`Ya existe un administrador con el email ${data.email}`, 409);
    }

    const administrador = await this.db.administrador.create({
      data: {
        email: data.email,
        password: await bcrypt.hash(data.password, SALT_ROUNDS),
        rol: data.rol,
      },
      select: { id: true, email: true, rol: true, activo: true, createdAt: true },
    });

    return administrador;
  }

  async actualizar(
    id: string,
    data: ActualizarAdministradorDTO,
    adminActualId: string
  ): Promise<AdministradorDTO> {
    const actual = await this.db.administrador.findUnique({ where: { id } });
    if (!actual) {
      throw httpError('Administrador no encontrado', 404);
    }

    if (data.email && data.email !== actual.email) {
      const ocupado = await this.db.administrador.findUnique({ where: { email: data.email } });
      if (ocupado) {
        throw httpError(`Ya existe un administrador con el email ${data.email}`, 409);
      }
    }

    // Desactivar por el PUT es el mismo caso que el PATCH: pasa por los guardias.
    if (data.activo === false) {
      await this.asegurarPuedeDesactivar(id, adminActualId);
    }

    const administrador = await this.db.administrador.update({
      where: { id },
      data: {
        ...(data.email !== undefined && { email: data.email }),
        ...(data.rol !== undefined && { rol: data.rol }),
        ...(data.activo !== undefined && { activo: data.activo }),
      },
      select: { id: true, email: true, rol: true, activo: true, createdAt: true },
    });

    return administrador;
  }

  async eliminar(id: string, adminActualId: string): Promise<void> {
    const administrador = await this.db.administrador.findUnique({ where: { id } });
    if (!administrador) {
      throw httpError('Administrador no encontrado', 404);
    }

    if (id === adminActualId) {
      throw httpError('No podés eliminar tu propio usuario', 409);
    }

    await this.asegurarNoEsUltimoActivo(id, 'eliminar');

    await this.db.administrador.delete({ where: { id } });
  }

  async resetPassword(id: string, password: string): Promise<{ message: string }> {
    const administrador = await this.db.administrador.findUnique({ where: { id } });
    if (!administrador) {
      throw httpError('Administrador no encontrado', 404);
    }

    await this.db.administrador.update({
      where: { id },
      data: { password: await bcrypt.hash(password, SALT_ROUNDS) },
    });

    return { message: 'Contraseña actualizada correctamente' };
  }

  async cambiarActivo(id: string, activo: boolean, adminActualId: string): Promise<AdministradorDTO> {
    const administrador = await this.db.administrador.findUnique({ where: { id } });
    if (!administrador) {
      throw httpError('Administrador no encontrado', 404);
    }

    if (!activo && administrador.activo) {
      await this.asegurarPuedeDesactivar(id, adminActualId);
    }

    const actualizado = await this.db.administrador.update({
      where: { id },
      data: { activo },
      select: { id: true, email: true, rol: true, activo: true, createdAt: true },
    });

    return actualizado;
  }

  /** No podes dejarte afuera a vos mismo ni apagar el ultimo admin activo. */
  private async asegurarPuedeDesactivar(id: string, adminActualId: string): Promise<void> {
    if (id === adminActualId) {
      throw httpError('No podés desactivar tu propio usuario', 409);
    }
    await this.asegurarNoEsUltimoActivo(id, 'desactivar');
  }

  private async asegurarNoEsUltimoActivo(id: string, verbo: 'desactivar' | 'eliminar'): Promise<void> {
    const activos = await this.db.administrador.count({ where: { activo: true } });
    if (activos > 1) return;

    const objetivo = await this.db.administrador.findUnique({
      where: { id },
      select: { activo: true },
    });
    if (objetivo?.activo) {
      throw httpError(`No se puede ${verbo} el último administrador activo`, 409);
    }
  }
}
