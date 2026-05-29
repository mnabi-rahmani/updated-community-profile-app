import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { deleteCasesBySource } from '../repository/awaaz-case.repository';
import { ok, badRequest, serverError } from '../utils/response';
import type { AwaazCaseSource } from '../models/awaaz-case';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

export interface DeleteBySourceResult {
  deletedCount: number;
  errors: string[];
}

async function awaazDeleteBySourceHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const body = JSON.parse(event.body);
    const source: AwaazCaseSource = body.source;

    if (!source || (source !== 'Excel Import' && source !== 'Kobo')) {
      return badRequest('Valid source is required (Excel Import or Kobo)');
    }

    console.log(`[AwaazDeleteBySource] User ${event.user.userId} deleting cases with source: ${source}`);
    const result = await deleteCasesBySource(source);
    console.log(`[AwaazDeleteBySource] Deleted ${result.deletedCount} cases`);

    return ok(result);
  } catch (err) {
    console.error('Error deleting awaaz cases by source:', err);
    return serverError(err);
  }
}

export const handler = withAuth(awaazDeleteBySourceHandler, { requiredModule: 'cfm', requiredRole: 'admin' });
