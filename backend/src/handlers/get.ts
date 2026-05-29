import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { getSubmission } from '../repository/community-profile.repository';
import { ok, notFound, badRequest, serverError } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function getHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const submissionUuid = event.pathParameters?.['submissionUuid'];
    if (!submissionUuid) return badRequest('submissionUuid path parameter is required');

    const submission = await getSubmission(submissionUuid);
    if (!submission) return notFound(`Submission ${submissionUuid} not found`);

    return ok(submission);
  } catch (err) {
    return serverError(err);
  }
}

export const handler = withAuth(getHandler, { requiredModule: 'cea' });
