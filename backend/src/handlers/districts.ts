import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { getDistrictsByProvince, getAllDistricts } from '../data';
import { ok } from '../utils/response';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

async function districtsHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  const provinceCode = event.queryStringParameters?.['provinceCode'];

  const districts = provinceCode
    ? getDistrictsByProvince(provinceCode)
    : getAllDistricts();

  return ok(districts);
}

export const handler = withAuth(districtsHandler);
