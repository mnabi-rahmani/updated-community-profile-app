import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { extractTokenFromHeader, verifyToken } from './jwt';
import type { AuthenticatedUser } from './config';

export interface AuthenticatedEvent extends APIGatewayProxyEventV2 {
  user: AuthenticatedUser;
}

export type AuthenticatedHandler = (
  event: AuthenticatedEvent
) => Promise<APIGatewayProxyResultV2>;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

function unauthorized(message = 'Unauthorized'): APIGatewayProxyResultV2 {
  return {
    statusCode: 401,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, message, statusCode: 401 }),
  };
}

function forbidden(message = 'Forbidden'): APIGatewayProxyResultV2 {
  return {
    statusCode: 403,
    headers: CORS_HEADERS,
    body: JSON.stringify({ success: false, message, statusCode: 403 }),
  };
}

export function preflight(): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: '',
  };
}

type ModuleAccess = 'cea' | 'cfm' | 'clusters_map' | 'all';
type RoleAccess = 'admin' | 'editor' | 'viewer';

interface AuthOptions {
  requiredModule?: ModuleAccess;
  requiredRole?: RoleAccess;
  allowRoles?: RoleAccess[];
}

const ROLE_HIERARCHY: Record<RoleAccess, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

function hasModuleAccess(userModule: ModuleAccess, requiredModule: ModuleAccess): boolean {
  if (userModule === 'all') return true;
  return userModule === requiredModule;
}

function hasRoleAccess(userRole: RoleAccess, requiredRole: RoleAccess): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

export function withAuth(
  handler: AuthenticatedHandler,
  options: AuthOptions = {}
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2> {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    if (event.requestContext.http.method === 'OPTIONS') {
      return preflight();
    }

    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    const token = extractTokenFromHeader(authHeader);

    if (!token) {
      return unauthorized('No authentication token provided');
    }

    const user = verifyToken(token);
    if (!user) {
      return unauthorized('Invalid or expired token');
    }

    if (options.requiredModule && !hasModuleAccess(user.module, options.requiredModule)) {
      return forbidden(`Access denied. This resource requires ${options.requiredModule} module access.`);
    }

    if (options.requiredRole && !hasRoleAccess(user.role, options.requiredRole)) {
      return forbidden(`Access denied. This action requires ${options.requiredRole} role or higher.`);
    }

    if (options.allowRoles && !options.allowRoles.includes(user.role)) {
      return forbidden(`Access denied. Allowed roles: ${options.allowRoles.join(', ')}`);
    }

    const authenticatedEvent: AuthenticatedEvent = {
      ...event,
      user,
    };

    return handler(authenticatedEvent);
  };
}

export function withPublicAccess(
  handler: (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2> {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    if (event.requestContext.http.method === 'OPTIONS') {
      return preflight();
    }
    return handler(event);
  };
}
