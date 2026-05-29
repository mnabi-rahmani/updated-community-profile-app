import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { batchUpsertCases } from '../repository/awaaz-case.repository';
import { ok, badRequest, serverError } from '../utils/response';
import type { AwaazUpsertResult } from '../models/awaaz-case';
import { getProvinceByCode, getDistrictByCode, getRegionNameByCode } from '../data';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

interface ImportRow {
  caseId: string;
  units: string;
  feedbackChannel: string;
  channelType: string;
  dateReported: string;
  forwardedDate: string;
  callerType: string;
  gender: string;
  ageGroup: string;
  region: string;
  provinceCode: string;
  districtCode: string;
  provinceName: string;
  districtName: string;
  neighbourhood: string;
  issue: string;
  referralStatus: string;
  dateClosed: string;
}

async function awaazUpsertHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    if (!event.body) {
      return badRequest('Request body is required');
    }

    const body = JSON.parse(event.body);
    const rows: ImportRow[] = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return badRequest('No rows provided for import');
    }

    console.log(`[AwaazUpsert] User ${event.user.userId} upserting ${rows.length} cases`);

    const casesData = rows.map((row) => {
      const provinceCode = String(row.provinceCode || '');
      const districtCode = String(row.districtCode || '');
      
      const province = provinceCode ? getProvinceByCode(provinceCode) : undefined;
      const district = districtCode ? getDistrictByCode(districtCode) : undefined;
      
      return {
        caseId: String(row.caseId || ''),
        units: String(row.units || ''),
        feedbackChannel: String(row.feedbackChannel || ''),
        channelType: String(row.channelType || ''),
        dateReported: String(row.dateReported || ''),
        forwardedDate: String(row.forwardedDate || ''),
        callerType: String(row.callerType || ''),
        gender: String(row.gender || ''),
        ageGroup: String(row.ageGroup || ''),
        region: (province?.regionCode ? getRegionNameByCode(province.regionCode) : undefined) || String(row.region || ''),
        provinceCode,
        districtCode,
        provinceName: province?.name || String(row.provinceName || ''),
        districtName: district?.name || String(row.districtName || ''),
        neighbourhood: String(row.neighbourhood || ''),
        issue: String(row.issue || ''),
        referralStatus: String(row.referralStatus || ''),
        dateClosed: String(row.dateClosed || ''),
      };
    });

    const result = await batchUpsertCases(casesData);

    const response: AwaazUpsertResult = {
      totalRows: rows.length,
      importedCount: result.importedCount,
      updatedCount: result.updatedCount,
      errors: result.errors,
    };

    return ok(response);
  } catch (err) {
    console.error('Error upserting awaaz cases:', err);
    return serverError(err);
  }
}

export const handler = withAuth(awaazUpsertHandler, { requiredModule: 'cfm', requiredRole: 'admin' });
