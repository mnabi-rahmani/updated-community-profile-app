import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { listCases } from '../repository/awaaz-case.repository';
import { ok, serverError } from '../utils/response';
import type { AwaazCaseFilters } from '../models/awaaz-case';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function awaazListHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const qs = event.queryStringParameters ?? {};
    
    const filters: AwaazCaseFilters = {};
    if (qs['provinceCode']) filters.provinceCode = qs['provinceCode'];
    if (qs['districtCode']) filters.districtCode = qs['districtCode'];
    if (qs['channelType']) filters.channelType = qs['channelType'];
    if (qs['referralStatus']) filters.referralStatus = qs['referralStatus'];
    if (qs['region']) filters.region = qs['region'];
    if (qs['callerType']) filters.callerType = qs['callerType'];
    if (qs['gender']) filters.gender = qs['gender'];
    if (qs['issue']) filters.issue = qs['issue'];

    const limit = qs['limit'] ? Math.min(parseInt(qs['limit'], 10), 1000) : 50;
    const nextToken = qs['nextToken'];

    const result = await listCases({ filters, limit, nextToken });
    return ok(result);
  } catch (err) {
    console.error('Error listing awaaz cases:', err);
    return serverError(err);
  }
}

export const handler = withAuth(awaazListHandler, { requiredModule: 'cfm' });
