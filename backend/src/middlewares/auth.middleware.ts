import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
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

export const authenticateJWT = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ message: 'Token de autorización no proporcionado' });
    return;
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AuthUserPayload;
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token de autenticación inválido o expirado' });
  }
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
