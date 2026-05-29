import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { createSubmission } from '../repository/community-profile.repository';
import type { CommunityProfileBulkRequest } from '../models/community-profile';
import { created, badRequest, serverError } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function createHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    if (!event.body) return badRequest('Request body is required');

    let request: CommunityProfileBulkRequest;
    try {
      request = JSON.parse(event.body) as CommunityProfileBulkRequest;
    } catch {
      return badRequest('Invalid JSON body');
    }

    if (!request.cluster) {
      return badRequest('cluster is required in the request body');
    }

    const summary = await createSubmission(request);
    return created(summary);
  } catch (err) {
    return serverError(err);
  }
}

export const handler = withAuth(createHandler, { requiredModule: 'cea', requiredRole: 'editor' });
