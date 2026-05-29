import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { getAllProvinces } from '../data';
import { ok } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function provincesHandler(_event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  return ok(getAllProvinces());
}

export const handler = withAuth(provincesHandler);
