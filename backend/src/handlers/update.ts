import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { updateSubmission } from '../repository/community-profile.repository';
import type { CommunityProfileBulkRequest } from '../models/community-profile';
import { ok, notFound, badRequest, serverError } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function updateHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const submissionUuid = event.pathParameters?.['submissionUuid'];
    if (!submissionUuid) return badRequest('submissionUuid path parameter is required');

    if (!event.body) return badRequest('Request body is required');

    let request: CommunityProfileBulkRequest;
    try {
      request = JSON.parse(event.body) as CommunityProfileBulkRequest;
    } catch {
      return badRequest('Invalid JSON body');
    }

    const summary = await updateSubmission(submissionUuid, request);
    if (!summary) return notFound(`Submission ${submissionUuid} not found`);

    return ok(summary);
  } catch (err) {
    return serverError(err);
  }
}

export const handler = withAuth(updateHandler, { requiredModule: 'cea', requiredRole: 'editor' });
