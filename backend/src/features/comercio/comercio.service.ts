import prisma from '../../config/prisma';
import { encrypt, decrypt } from '../../utils/encryption';
import { CreateComercioConLicenciaDTO, UpdateComercioDTO } from './comercio.dtos';

export class ComercioService {
  async createConLicencia(data: CreateComercioConLicenciaDTO) {
    // Sin bloque `licencia` el comercio nace vacio: es el primer paso del alta
    // en dos etapas, y las licencias las emite despues la suscripcion segun el
    // cupo del plan contratado.
    const licenciaInicial = data.licencia
      ? {
          create: {
            clave_hash: encrypt(data.licencia.clave),
            rol: data.licencia.rol,
            max_activaciones: data.licencia.max_activaciones,
            estado: data.licencia.estado,
          },
        }
      : undefined;

    return prisma.$transaction(async (tx) => {
      const comercio = await tx.comercio.create({
        data: {
          nombre: data.nombre,
          ...(licenciaInicial && { licencias: licenciaInicial }),
        },
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

      const licenciasConClaveOriginal = comercio.licencias.map((lic) => ({
        ...lic,
        clave_original: this.desencriptarSeguro(lic.clave_hash),
      }));

      return {
        ...comercio,
        licencias: licenciasConClaveOriginal,
      };
    });
  }

  async getAll() {
    const comercios = await prisma.comercio.findMany({
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
      orderBy: { createdAt: 'desc' },
    });

    return comercios.map((comercio) => ({
      ...comercio,
      licencias: comercio.licencias.map((lic) => ({
        ...lic,
        clave_original: this.desencriptarSeguro(lic.clave_hash),
      })),
    }));
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

  private desencriptarSeguro(encrypted: string): string | null {
    try {
      return decrypt(encrypted);
    } catch {
      return null;
    }
  }
}
