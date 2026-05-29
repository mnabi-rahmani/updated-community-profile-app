import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { validatePassword, toUserPayload } from '../auth/users';
import { signToken } from '../auth/jwt';
import { ok, badRequest, serverError, preflight } from '../utils/response';

interface LoginRequest {
  userId: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: {
    userId: string;
    role: string;
    module: string;
    name: string;
  };
  expiresIn: string;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (event.requestContext.http.method === 'OPTIONS') return preflight();

  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    let request: LoginRequest;
    try {
      request = JSON.parse(event.body) as LoginRequest;
    } catch {
      return badRequest('Invalid JSON body');
    }

    if (!request.userId || !request.password) {
      return badRequest('userId and password are required');
    }

    const user = await validatePassword(request.userId, request.password);
    if (!user) {
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
          message: 'Invalid credentials',
          statusCode: 401,
        }),
      };
    }

    const payload = toUserPayload(user);
    const token = signToken(payload);

    const response: LoginResponse = {
      token,
      user: {
        userId: user.userId,
        role: user.role,
        module: user.module,
        name: user.name,
      },
      expiresIn: process.env['JWT_EXPIRES_IN'] || '24h',
    };

    return ok(response);
  } catch (err) {
    return serverError(err);
  }
}
