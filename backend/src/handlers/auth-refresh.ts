import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { extractTokenFromHeader, verifyToken, signToken } from '../auth/jwt';
import { findUser, toUserPayload } from '../auth/users';
import { ok, serverError, preflight } from '../utils/response';

interface RefreshResponse {
  token: string;
  expiresIn: string;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (event.requestContext.http.method === 'OPTIONS') return preflight();

  try {
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        body: JSON.stringify({
          success: false,
          message: 'No token provided',
          statusCode: 401,
        }),
      };
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        body: JSON.stringify({
          success: false,
          message: 'Invalid or expired token',
          statusCode: 401,
        }),
      };
    }

    const user = findUser(decoded.userId);
    const payload = user ? toUserPayload(user) : {
      userId: decoded.userId,
      role: decoded.role,
      module: decoded.module,
    };

    const newToken = signToken(payload);

    const response: RefreshResponse = {
      token: newToken,
      expiresIn: process.env['JWT_EXPIRES_IN'] || '24h',
    };

    return ok(response);
  } catch (err) {
    return serverError(err);
  }
}
