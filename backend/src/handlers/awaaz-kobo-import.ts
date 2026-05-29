import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { batchUpsertCases, batchCreateCases } from '../repository/awaaz-case.repository';
import { ok, serverError, badRequest } from '../utils/response';
import type { AwaazCaseSource } from '../models/awaaz-case';
import { getProvinceByCode, getDistrictByCode, getRegionNameByCode } from '../data';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

type ImportMode = 'new' | 'upsert' | 'replace';

const KOBO_BASE_URL = process.env['KOBO_BASE_URL'] ?? '';
const AWAAZ_KOBO_ASSET_ID = process.env['AWAAZ_KOBO_ASSET_ID'] ?? '';
const KOBO_USERNAME = process.env['KOBO_USERNAME'] ?? '';
const KOBO_PASSWORD = process.env['KOBO_PASSWORD'] ?? '';

type KoboSubmission = Record<string, unknown>;

interface KoboDataResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: KoboSubmission[];
}

export interface AwaazKoboImportResult {
  totalSubmissions: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
}

async function awaazKoboImportHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    if (!KOBO_BASE_URL || !AWAAZ_KOBO_ASSET_ID || !KOBO_USERNAME || !KOBO_PASSWORD) {
      return badRequest('Kobo configuration is missing. Please set environment variables.');
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const mode: ImportMode = body.mode || 'new';
    
    console.log(`[AwaazKoboImport] Starting import from asset: ${AWAAZ_KOBO_ASSET_ID}, mode: ${mode}, user: ${event.user.userId}`);
    const submissions = await fetchAllSubmissions();
    console.log(`[AwaazKoboImport] Fetched ${submissions.length} submissions from Kobo`);

    const result = await importSubmissions(submissions, mode);
    console.log(
      `[AwaazKoboImport] Done — imported: ${result.importedCount}, updated: ${result.updatedCount}, skipped: ${result.skippedCount}, errors: ${result.errors.length}`,
    );
    return ok(result);
  } catch (err) {
    console.error('[AwaazKoboImport] Fatal error:', err);
    return serverError(err);
  }
}

export const handler = withAuth(awaazKoboImportHandler, { requiredModule: 'cfm', requiredRole: 'admin' });

async function fetchAllSubmissions(): Promise<KoboSubmission[]> {
  const all: KoboSubmission[] = [];
  const credentials = Buffer.from(`${KOBO_USERNAME}:${KOBO_PASSWORD}`).toString('base64');
  let url: string | null = `${KOBO_BASE_URL}/assets/${AWAAZ_KOBO_ASSET_ID}/data.json?limit=100`;

  while (url) {
    console.log(`[AwaazKoboImport] Fetching page: ${url}`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Kobo API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as KoboDataResponse;
    if (data.results?.length) all.push(...data.results);
    url = data.next ?? null;
  }

  return all;
}

async function importSubmissions(submissions: KoboSubmission[], mode: ImportMode): Promise<AwaazKoboImportResult> {
  const result: AwaazKoboImportResult = {
    totalSubmissions: submissions.length,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errors: [],
  };

  const casesData: {
    caseId: string;
    units: string;
    feedbackChannel: string;
    channelType: string;
    dateReported: string;
    submissionDate: string;
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
    validationStatus: string;
    dateClosed: string;
    source: AwaazCaseSource;
  }[] = [];

  for (const submission of submissions) {
    try {
      // Use _uuid as Case ID (primary identifier from Kobo)
      const caseId = getString(submission, '_uuid');
      
      if (!caseId) {
        result.errors.push('Submission missing _uuid, skipped');
        result.skippedCount++;
        continue;
      }

      // Map Kobo field names to our model fields
      // Kobo uses nested paths like "general_info/channel", "biodata/gender" etc.
      
      // Extract province and district codes first for lookups
      const provinceCode = getString(submission, 'general_info/siteprovince') || getString(submission, 'specific_info_desc/province') || '';
      const districtCode = getString(submission, 'general_info/sitedistrict') || getString(submission, 'specific_info_desc/district') || '';
      
      // Lookup province and district data
      const province = provinceCode ? getProvinceByCode(provinceCode) : undefined;
      const district = districtCode ? getDistrictByCode(districtCode) : undefined;
      
      casesData.push({
        caseId,
        // Sector/Units: prefer Kobo "Sectors" / "Sector" / "sector", then fall back to feedback/query category
        units:
          getString(submission, 'Sectors') ||
          getString(submission, 'Sector') ||
          getString(submission, 'sector') ||
          getString(submission, 'feedback/feedback_category') ||
          getString(submission, 'query/query_category') ||
          '',
        // Channel is how feedback was collected
        feedbackChannel: mapFeedbackChannel(getString(submission, 'general_info/channel')),
        // Channel type: ONLY from Kobo "sub_channel" field (no fallback)
        channelType: mapChannelType(getString(submission, 'sub_channel')),
        // Date reported
        dateReported: getString(submission, 'open_date') || formatDate(submission['_submission_time']),
        // Submission date from Kobo _submission_time
        submissionDate: formatDate(submission['_submission_time']),
        // Forwarded date - use open_end if case was referred
        forwardedDate: getString(submission, 'feedback/refer_option') === 'yes' ? formatDate(submission['open_end']) : '',
        // Caller type from displacement status
        callerType: mapCallerType(getString(submission, 'biodata/displacement')),
        // Gender
        gender: mapGender(getString(submission, 'biodata/gender')),
        // Age group
        ageGroup: mapAgeGroup(getString(submission, 'biodata/age')),
        // Region - lookup full name from province data
        region: (province?.regionCode ? getRegionNameByCode(province.regionCode) : undefined) || '',
        // Province and district codes
        provinceCode,
        districtCode,
        // Province and district names - looked up from static data
        provinceName: province?.name || '',
        districtName: district?.name || '',
        // Neighbourhood/village
        neighbourhood: getString(submission, 'specific_info_desc/admin_4') || getString(submission, 'specific_info_desc/village') || '',
        // Issue type from feedback/query type
        issue: mapIssueType(getString(submission, 'type'), getString(submission, 'iasc_type')),
        // Status - only use finalstatus, default to "Unchecked" if empty
        referralStatus: mapStatus(getString(submission, 'finalstatus')),
        // Validation status from Kobo _validation_status
        validationStatus: mapValidationStatus(submission['_validation_status']),
        // Date closed - use open_end if status is Closed
        dateClosed: getString(submission, 'finalstatus') === 'Closed' ? formatDate(submission['open_end']) : '',
        source: 'Kobo',
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Error processing submission: ${msg}`);
    }
  }

  if (casesData.length > 0) {
    try {
      if (mode === 'new') {
        // Import new only - use batchCreateCases which skips existing
        const createResult = await batchCreateCases(casesData);
        result.importedCount = createResult.importedCount;
        result.skippedCount += createResult.skippedCount;
        result.errors.push(...createResult.errors);
      } else {
        // 'upsert' or 'replace' - use batchUpsertCases (for replace, deletion handled by frontend before calling)
        const upsertResult = await batchUpsertCases(casesData);
        result.importedCount = upsertResult.importedCount;
        result.updatedCount = upsertResult.updatedCount;
        result.errors.push(...upsertResult.errors);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Batch import failed: ${msg}`);
    }
  }

  return result;
}

function getString(obj: KoboSubmission, key: string): string {
  const val = obj[key];
  return val !== undefined && val !== null ? String(val) : '';
}

function formatDate(val: unknown): string {
  if (!val) return '';
  const str = String(val);
  if (str.includes('T')) {
    return str.split('T')[0];
  }
  return str;
}

// Map Kobo displacement values to our caller type options
function mapCallerType(displacement: string): string {
  const mapping: Record<string, string> = {
    'Host_Community': 'Host Community',
    'host_community': 'Host Community',
    'Host Community': 'Host Community',
    'Returnee_from_abroad': 'Returnee - International',
    'returnee_from_abroad': 'Returnee - International',
    'Returnee from abroad': 'Returnee - International',
    'Returnee_internal': 'Returnee - Internal',
    'returnee_internal': 'Returnee - Internal',
    'Returnee internal': 'Returnee - Internal',
    'IDP': 'IDP',
    'idp': 'IDP',
    'IDP_Returnee': 'IDP',
    'idp_returnee': 'IDP',
    'Prefer not to say': 'Other',
    'prefer_not_to_say': 'Other',
    'Other': 'Other',
    'other': 'Other',
  };
  return mapping[displacement] || displacement || '';
}

// Map Kobo gender values to our gender options
function mapGender(gender: string): string {
  const mapping: Record<string, string> = {
    'male': 'Male',
    'Male': 'Male',
    'female': 'Female',
    'Female': 'Female',
    'other': 'Other',
    'Other': 'Other',
    'Prefer not to say': 'Other',
    'prefer_not_to_say': 'Other',
  };
  return mapping[gender] || gender || '';
}

// Map Kobo age values to our age group options
function mapAgeGroup(age: string): string {
  // Kobo uses en-dash (–) while our options use hyphen (-)
  const normalized = age.replace(/–/g, '-').trim();
  const mapping: Record<string, string> = {
    '0 - 17': '0 - 17',
    '18 - 25': '18 - 25',
    '26 - 35': '26 - 35',
    '36 - 45': '36 - 45',
    '46 - 55': '46 - 59',
    '46 - 59': '46 - 59',
    '56 - 65': '60+',
    '60+': '60+',
    '66+': '60+',
    'Prefer not to say': '',
    'prefer_not_to_say': '',
  };
  return mapping[normalized] || normalized || '';
}

// Map Kobo type/iasc_type to our issue options
function mapIssueType(type: string, iascType: string): string {
  // iasc_type is more specific: "Feedback", "Complaint", "Information Request"
  const iascMapping: Record<string, string> = {
    'Feedback': 'Feedback & Requests',
    'feedback': 'Feedback & Requests',
    'Complaint': 'Complaint',
    'complaint': 'Complaint',
    'Information Request': 'Information Request',
    'information_request': 'Information Request',
    'Request': 'Feedback & Requests',
    'request': 'Feedback & Requests',
    'Referral': 'Referral',
    'referral': 'Referral',
    'Emergency': 'Emergency',
    'emergency': 'Emergency',
  };
  
  if (iascType && iascMapping[iascType]) {
    return iascMapping[iascType];
  }
  
  // Fallback to type field (feedback/query)
  const typeMapping: Record<string, string> = {
    'feedback': 'Feedback & Requests',
    'query': 'Information Request',
  };
  
  return typeMapping[type] || type || '';
}

// Map Kobo status values to our status options
function mapStatus(status: string): string {
  if (!status) return 'Unchecked';
  
  const mapping: Record<string, string> = {
    'Open': 'Open',
    'open': 'Open',
    'Closed': 'Closed',
    'closed': 'Closed',
    'In Progress': 'In Progress',
    'in_progress': 'In Progress',
    'Pending': 'Pending',
    'pending': 'Pending',
    'Resolved': 'Closed',
    'resolved': 'Closed',
  };
  return mapping[status] || status || 'Unchecked';
}

// Map Kobo _validation_status to our validation status options
function mapValidationStatus(validationStatus: unknown): string {
  if (!validationStatus || typeof validationStatus !== 'object') return '';
  
  const status = validationStatus as { uid?: string; label?: string };
  const uid = status.uid || '';
  const label = status.label || '';
  
  const mapping: Record<string, string> = {
    'validation_status_approved': 'Approved',
    'validation_status_not_approved': 'Not Approved',
    'validation_status_on_hold': 'On Hold',
  };
  
  return mapping[uid] || label || '';
}

// Normalize Kobo channel values for "How was the ticket collected?"
function mapFeedbackChannel(channel: string): string {
  if (!channel) return '';
  const original = channel.trim();
  const normalized = original.toLowerCase().replace(/[_\s]+/g, ' ');

  if (normalized === 'help desk') return 'Help Desk';
  if (normalized === 'complaint box') return 'Complaint Box';

  return original;
}

// Map Kobo "Through which channel specifically?" to our channelType field
function mapChannelType(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Basic normalization for consistency
  const normalized = trimmed.toLowerCase().replace(/[_\s]+/g, ' ');

  // Extend this mapping as needed once we see more Kobo values
  const mapping: Record<string, string> = {
    'help desk': 'Help Desk',
    'complaint box': 'Complaint Box',
  };

  return mapping[normalized] || trimmed;
}

// Cache for sector lookup to avoid repeated API calls for the same reference
const sectorCache = new Map<string, string>();

// Resolve human-readable sector name from Kobo JSON API link stored in Sector_calculate
async function resolveSectorName(ref: string): Promise<string> {
  const trimmed = ref?.trim();
  if (!trimmed) return '';

  // If it's not a URL, just return as-is
  if (!trimmed.startsWith('http')) {
    return trimmed;
  }

  if (sectorCache.has(trimmed)) {
    return sectorCache.get(trimmed) as string;
  }

  const credentials = Buffer.from(`${KOBO_USERNAME}:${KOBO_PASSWORD}`).toString('base64');

  try {
    const resp = await fetch(trimmed, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.warn(`[AwaazKoboImport] Failed to resolve sector from ${trimmed}: ${resp.status} ${body}`);
      return trimmed;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const candidate =
      (data['name'] as string | undefined) ||
      (data['label'] as string | undefined) ||
      (data['sector'] as string | undefined) ||
      (data['title'] as string | undefined) ||
      trimmed;

    sectorCache.set(trimmed, candidate);
    return candidate;
  } catch (err) {
    console.warn(`[AwaazKoboImport] Error resolving sector from ${trimmed}:`, err);
    return trimmed;
  }
}
