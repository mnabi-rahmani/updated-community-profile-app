import jwt from 'jsonwebtoken';
import { AUTH_CONFIG, type UserPayload, type AuthenticatedUser } from './config';

export function signToken(payload: UserPayload): string {
  return jwt.sign(
    payload as object,
    AUTH_CONFIG.JWT_SECRET,
    { expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN } as jwt.SignOptions
  );
}

export function verifyToken(token: string): AuthenticatedUser | null {
  try {
    const decoded = jwt.verify(token, AUTH_CONFIG.JWT_SECRET) as AuthenticatedUser;
    return decoded;
  } catch {
    return null;
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  return null;
}
