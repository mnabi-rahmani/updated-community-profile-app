import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { listSubmissions } from '../repository/community-profile.repository';
import { ok, serverError } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function listHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const qs = event.queryStringParameters ?? {};
    const result = await listSubmissions({
      provinceCode: qs['provinceCode'],
      districtCode: qs['districtCode'],
      clusterName: qs['clusterName'],
      limit: qs['limit'] ? Number(qs['limit']) : 50,
      nextToken: qs['nextToken'],
    });
    return ok(result);
  } catch (err) {
    return serverError(err);
  }
}

export const handler = withAuth(listHandler, { requiredModule: 'cea' });
