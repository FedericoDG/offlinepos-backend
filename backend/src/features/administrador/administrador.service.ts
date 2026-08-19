import prisma from '../../config/prisma';
import { env } from '../../config/env';
import { LoginDTO, LoginResponseDTO } from './administrador.dtos';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export class AdministradorService {
  async login({ email, password }: LoginDTO): Promise<LoginResponseDTO> {
    const admin = await prisma.administrador.findUnique({
      where: { email },
    });

    if (!admin) {
      throw new Error('Credenciales inválidas');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      throw new Error('Credenciales inválidas');
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
}
