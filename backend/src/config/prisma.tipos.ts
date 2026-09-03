import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Tipos del cliente de base, separados en dos porque no son intercambiables.
 *
 * Existen para que los servicios reciban el cliente por constructor en vez de
 * importarlo: asi se los puede ejercitar con datos controlados, sin Postgres.
 */

/** Cliente completo. Es el unico que puede abrir una transaccion. */
export type ClienteRaiz = PrismaClient;

/**
 * Cliente completo o el `tx` de una transaccion en curso. Lo usan los helpers
 * que tienen que servir en los dos contextos.
 */
export type ClientePrisma = PrismaClient | Prisma.TransactionClient;
