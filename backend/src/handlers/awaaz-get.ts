import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { getCase } from '../repository/awaaz-case.repository';
import { ok, badRequest, notFound, serverError } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function awaazGetHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const caseId = event.pathParameters?.['caseId'];
    
    if (!caseId) {
      return badRequest('Case ID is required');
    }

    const result = await getCase(caseId);
    
    if (!result) {
      return notFound('Case not found');
    }

    return ok(result);
  } catch (err) {
    console.error('Error getting awaaz case:', err);
    return serverError(err);
  }
}

export const handler = withAuth(awaazGetHandler, { requiredModule: 'cfm' });
