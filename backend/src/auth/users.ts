import bcrypt from 'bcryptjs';
import type { UserPayload } from './config';
// Auth module v2 - using cfm module naming

export interface StoredUser {
  userId: string;
  passwordHash: string;
  role: 'admin' | 'viewer' | 'editor';
  module: 'cea' | 'cfm' | 'clusters_map' | 'all';
  name: string;
}

const USERS_JSON = process.env['USERS_CONFIG'];

let usersCache: StoredUser[] | null = null;

function getDefaultUsers(): StoredUser[] {
  return [
    {
      userId: 'cea_admin',
      passwordHash: bcrypt.hashSync(process.env['CEA_ADMIN_PASSWORD'] || 'Xk9#mP2$vL7@nQ4!', 10),
      role: 'admin',
      module: 'cea',
      name: 'CEA Administrator',
    },
    {
      userId: 'cfm_admin',
      passwordHash: bcrypt.hashSync(process.env['CFM_ADMIN_PASSWORD'] || 'Rw3&jF8*hT1%cB6^', 10),
      role: 'admin',
      module: 'cfm',
      name: 'CFM Administrator',
    },
    {
      userId: 'clusters_admin',
      passwordHash: bcrypt.hashSync(process.env['CLUSTERS_ADMIN_PASSWORD'] || 'Gy5!zN9#pK2$wM8@', 10),
      role: 'admin',
      module: 'clusters_map',
      name: 'Clusters Map Administrator',
    },
    {
      userId: 'super_admin',
      passwordHash: bcrypt.hashSync(process.env['SUPER_ADMIN_PASSWORD'] || 'Qd7^sH4&xV0*bJ3%', 10),
      role: 'admin',
      module: 'all',
      name: 'Super Administrator',
    },
    {
      userId: 'cea_viewer',
      passwordHash: bcrypt.hashSync(process.env['CEA_VIEWER_PASSWORD'] || 'Uc6@tE1!yA5#oW9$', 10),
      role: 'viewer',
      module: 'cea',
      name: 'CEA Viewer',
    },
    {
      userId: 'cfm_viewer',
      passwordHash: bcrypt.hashSync(process.env['CFM_VIEWER_PASSWORD'] || 'Lf2%iZ8^mC4&kP7*', 10),
      role: 'viewer',
      module: 'cfm',
      name: 'CFM Viewer',
    },
  ];
}

export function getUsers(): StoredUser[] {
  if (usersCache) return usersCache;

  if (USERS_JSON) {
    try {
      usersCache = JSON.parse(USERS_JSON) as StoredUser[];
      return usersCache;
    } catch {
      console.warn('Failed to parse USERS_CONFIG, using default users');
    }
  }

  usersCache = getDefaultUsers();
  return usersCache;
}

export function findUser(userId: string): StoredUser | undefined {
  return getUsers().find((u) => u.userId === userId);
}

export async function validatePassword(userId: string, password: string): Promise<StoredUser | null> {
  const user = findUser(userId);
  if (!user) return null;

  const isValid = await bcrypt.compare(password, user.passwordHash);
  return isValid ? user : null;
}

export function toUserPayload(user: StoredUser): UserPayload {
  return {
    userId: user.userId,
    role: user.role,
    module: user.module,
  };
}
