import { PrismaClient, Rol } from '@prisma/client';
import bcrypt from 'bcrypt';

export async function seedAdministradores(prisma: PrismaClient) {
  console.log('Creando administradores...');

  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash('123456', saltRounds);

  const administradores = await prisma.administrador.createMany({
    data: [
      {
        id: '94957cba-2d67-488e-9da1-059463dc3c66',
        email: 'federico@mail.com',
        password: hashedPassword,
        rol: Rol.ADMINISTRADOR,
      },
    ],
  });

  return administradores;
}
