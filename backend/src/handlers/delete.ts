import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { deleteSubmission } from '../repository/community-profile.repository';
import { ok, notFound, badRequest, serverError } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function deleteHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const submissionUuid = event.pathParameters?.['submissionUuid'];
    if (!submissionUuid) return badRequest('submissionUuid path parameter is required');

    const deleted = await deleteSubmission(submissionUuid);
    if (!deleted) return notFound(`Submission ${submissionUuid} not found`);

    return ok({ message: 'Submission deleted successfully', submissionUuid });
  } catch (err) {
    return serverError(err);
  }
}

export const handler = withAuth(deleteHandler, { requiredModule: 'cea', requiredRole: 'admin' });
