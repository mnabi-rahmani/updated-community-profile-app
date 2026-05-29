import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { getDistinctClusters } from '../repository/community-profile.repository';
import { ok, badRequest, serverError } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function clustersHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const qs = event.queryStringParameters ?? {};
    const provinceCode = qs['provinceCode'];
    if (!provinceCode) return badRequest('provinceCode query parameter is required');

    const clusters = await getDistinctClusters(provinceCode, qs['districtCode']);
    return ok(clusters);
  } catch (err) {
    return serverError(err);
  }
}

export const handler = withAuth(clustersHandler, { requiredModule: 'cea' });
