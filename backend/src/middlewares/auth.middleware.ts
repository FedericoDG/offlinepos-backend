import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import prisma from '../config/prisma';
import { Rol } from '@prisma/client';

export interface AuthUserPayload {
  id: string;
  email: string;
  rol: Rol;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUserPayload;
    }
  }
}

export const authenticateJWT = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ message: 'Token de autorización no proporcionado' });
    return;
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  let decoded: AuthUserPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as AuthUserPayload;
  } catch (error) {
    res.status(401).json({ message: 'Token de autenticación inválido o expirado' });
    return;
  }

  try {
    // Re-chequeo por request: un administrador borrado o desactivado no puede
    // seguir usando un token que todavia no venció.
    const admin = await prisma.administrador.findUnique({
      where: { id: decoded.id },
      select: { activo: true },
    });

    if (!admin) {
      res.status(401).json({ message: 'Token de autenticación inválido o expirado' });
      return;
    }

    if (!admin.activo) {
      res.status(403).json({ message: 'Usuario desactivado' });
      return;
    }
  } catch {
    res.status(401).json({ message: 'Token de autenticación inválido o expirado' });
    return;
  }

  req.user = decoded;
  next();
};

export const requireRole = (allowedRoles: Rol | Rol[]) => {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Usuario no autenticado' });
      return;
    }

    if (!roles.includes(req.user.rol)) {
      res.status(403).json({
        message: `Acceso denegado. Se requiere uno de los siguientes roles: ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
};

export const requireAdmin = requireRole(Rol.ADMINISTRADOR);
