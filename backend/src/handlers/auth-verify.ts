import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { extractTokenFromHeader, verifyToken } from '../auth/jwt';
import { findUser } from '../auth/users';
import { ok, serverError, preflight } from '../utils/response';

interface VerifyResponse {
  valid: boolean;
  user?: {
    userId: string;
    role: string;
    module: string;
    name: string;
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (event.requestContext.http.method === 'OPTIONS') return preflight();

  try {
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      const response: VerifyResponse = { valid: false };
      return ok(response);
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      const response: VerifyResponse = { valid: false };
      return ok(response);
    }

    const user = findUser(decoded.userId);
    const response: VerifyResponse = {
      valid: true,
      user: user
        ? {
            userId: user.userId,
            role: user.role,
            module: user.module,
            name: user.name,
          }
        : {
            userId: decoded.userId,
            role: decoded.role,
            module: decoded.module,
            name: decoded.userId,
          },
    };

    return ok(response);
  } catch (err) {
    return serverError(err);
  }
}
