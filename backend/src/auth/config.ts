export const AUTH_CONFIG = {
  JWT_SECRET: process.env['JWT_SECRET'] || 'CHANGE_THIS_SECRET_IN_PRODUCTION',
  JWT_EXPIRES_IN: process.env['JWT_EXPIRES_IN'] || '24h',
  ADMIN_CODE_DELETE: process.env['ADMIN_CODE_DELETE'] || 'CHANGE_DELETE_CODE',
  ADMIN_CODE_UPDATE: process.env['ADMIN_CODE_UPDATE'] || 'CHANGE_UPDATE_CODE',
};

export interface UserPayload {
  userId: string;
  role: 'admin' | 'viewer' | 'editor';
  module: 'cea' | 'cfm' | 'clusters_map' | 'all';
}

export interface AuthenticatedUser extends UserPayload {
  iat: number;
  exp: number;
}
