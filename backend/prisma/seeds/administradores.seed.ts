import { PrismaClient, Rol } from '@prisma/client';
import bcrypt from 'bcrypt';

/** Mismo costo que usa el login (`bcrypt.compare` contra este hash). */
const SALT_ROUNDS = 10;

export async function seedAdministradores(prisma: PrismaClient) {
  console.log('Sembrando administradores...');

  // Hash bcrypt: el login valida con `bcrypt.compare`, nunca con texto plano.
  const password = await bcrypt.hash('123456', SALT_ROUNDS);

  const definiciones = [
    { id: '94957cba-2d67-488e-9da1-059463dc3c66', email: 'federico@mail.com' },
  ];

  for (const admin of definiciones) {
    await prisma.administrador.upsert({
      where: { email: admin.email },
      create: {
        id: admin.id,
        email: admin.email,
        password,
        rol: Rol.ADMINISTRADOR,
        activo: true,
      },
      // No se pisa la contrasena existente: un re-seed no debe resetear un
      // cambio hecho desde el panel.
      update: {},
    });
  }

  console.log(`  ${definiciones.length} administradores listos (password demo: 123456).`);
}
