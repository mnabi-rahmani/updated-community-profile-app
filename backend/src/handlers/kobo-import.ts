import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { createSubmission, submissionExists, deleteSubmission } from '../repository/community-profile.repository';
import { ok, serverError, badRequest } from '../utils/response';
import type { CommunityProfileBulkRequest, SubTableRecord } from '../models/community-profile';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

const KOBO_BASE_URL = process.env['KOBO_BASE_URL'] ?? '';
const KOBO_ASSET_ID = process.env['KOBO_ASSET_ID'] ?? '';
const KOBO_USERNAME = process.env['KOBO_USERNAME'] ?? '';
const KOBO_PASSWORD = process.env['KOBO_PASSWORD'] ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

type KoboSubmission = Record<string, unknown>;
type ImportMode = 'new' | 'update' | 'replace';

interface KoboDataResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: KoboSubmission[];
}

export interface KoboImportResult {
  totalSubmissions: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  replacedCount: number;
  errors: string[];
}

// ── Lambda handler ─────────────────────────────────────────────────────────────

async function koboImportHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    if (!KOBO_BASE_URL || !KOBO_ASSET_ID || !KOBO_USERNAME || !KOBO_PASSWORD) {
      return badRequest('Kobo configuration is missing. Please set environment variables.');
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const mode: ImportMode = body.mode || 'new';

    console.log(`[KoboImport] Starting import from asset: ${KOBO_ASSET_ID}, mode: ${mode}, user: ${event.user.userId}`);
    const submissions = await fetchAllSubmissions();
    console.log(`[KoboImport] Fetched ${submissions.length} submissions from Kobo`);

    const result = await importSubmissions(submissions, mode);
    console.log(
      `[KoboImport] Done — imported: ${result.importedCount}, updated: ${result.updatedCount}, replaced: ${result.replacedCount}, skipped: ${result.skippedCount}, errors: ${result.errors.length}`,
    );
    return ok(result);
  } catch (err) {
    console.error('[KoboImport] Fatal error:', err);
    return serverError(err);
  }
}

export const handler = withAuth(koboImportHandler, { requiredModule: 'cea', requiredRole: 'admin' });

// ── Fetch all pages from the Kobo API ─────────────────────────────────────────

async function fetchAllSubmissions(): Promise<KoboSubmission[]> {
  const all: KoboSubmission[] = [];
  const credentials = Buffer.from(`${KOBO_USERNAME}:${KOBO_PASSWORD}`).toString('base64');
  let url: string | null = `${KOBO_BASE_URL}/assets/${KOBO_ASSET_ID}/data.json?limit=100`;

  while (url) {
    console.log(`[KoboImport] Fetching page: ${url}`);
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

// ── Transform each Kobo submission and save to DynamoDB ───────────────────────

async function importSubmissions(submissions: KoboSubmission[], mode: ImportMode): Promise<KoboImportResult> {
  const result: KoboImportResult = {
    totalSubmissions: submissions.length,
    importedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    replacedCount: 0,
    errors: [],
  };

  for (const submission of submissions) {
    const koboUuid = getString(submission, '_uuid');

    try {
      // ── Validate required fields ──────────────────────────────────────────
      if (!koboUuid) {
        result.errors.push('Submission missing _uuid, skipped');
        result.skippedCount++;
        continue;
      }

      // ── Duplicate check — handle based on mode ────────────────────────────
      const alreadyExists = await submissionExists(koboUuid);
      if (alreadyExists) {
        if (mode === 'new') {
          console.log(`[KoboImport] Skipping already-imported submission: ${koboUuid}`);
          result.skippedCount++;
          continue;
        } else if (mode === 'replace') {
          // Delete existing before reimporting
          console.log(`[KoboImport] Deleting existing submission for replace: ${koboUuid}`);
          await deleteSubmission(koboUuid);
          result.replacedCount++;
        }
        // For 'update' mode, we'll delete and recreate (same as replace logic)
        else if (mode === 'update') {
          console.log(`[KoboImport] Updating existing submission: ${koboUuid}`);
          await deleteSubmission(koboUuid);
          result.updatedCount++;
        }
      }

      // ── Extract top-level cluster fields ──────────────────────────────────
      const provinceCode = getString(submission, 'general_info/province');
      const districtCode = getString(submission, 'general_info/district');
      const clusterName = getString(submission, 'general_info/capClusterName');

      if (!clusterName) {
        result.errors.push(`Submission ${koboUuid} missing clusterName, skipped`);
        result.skippedCount++;
        continue;
      }

      // Build cluster jsonData — mirrors the original C# KoboImportService fields exactly
      const clusterJsonData: Record<string, unknown> = {};
      for (const key of [
        'general_info/Date',
        'general_info/EnumeratorName',
        'general_info/EnumeratorPhone',
        'open_date',
        'open_start',
        'open_end',
        'open_date_format',
        'deviceid',
        'general_info/village_1',
        'general_info/village_2',
        'general_info/village_3',
        'general_info/village_4',
        'general_info/village_5',
        '_submission_time',
        '_submitted_by',
        '_id',
        '_uuid',
      ]) {
        if (submission[key] !== undefined) {
          clusterJsonData[simplifyKey(key)] = submission[key];
        }
      }

      // ── Build the full bulk request ───────────────────────────────────────
      const request: CommunityProfileBulkRequest = {
        cluster: { provinceCode, districtCode, clusterName, jsonData: clusterJsonData },

        villages: extractRepeatGroup(
          submission,
          'general_info/VillageRepeat',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'general_info/VillageRepeat/village') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        participantDetails: extractRepeatGroup(
          submission,
          'Participant_Details/Participant_Details_repeat_group',
          (item) => ({ provinceCode, districtCode, clusterName, jsonData: flattenObject(item) }),
        ),

        socialStructures: extractRepeatGroup(
          submission,
          'Community_Social_Structure/comm_social_structure_group',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'Community_Social_Structure/comm_social_structure_group/selected_village_name_Structure') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        populationGroups: extractRepeatGroup(
          submission,
          'population/popgroup',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'population/popgroup/selected_village_name_pop') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        accessibilities: extractRepeatGroup(
          submission,
          'accessiblity/accessgroup',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'accessiblity/accessgroup/selected_village_name_access') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        roadConditions: extractRepeatGroup(
          submission,
          'roadconditions/roadcongroup',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'roadconditions/roadcongroup/selected_village_name_RD') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        responseStructures: extractRepeatGroup(
          submission,
          'Community_Response_Structure/comm_response_structure_group',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'Community_Response_Structure/comm_response_structure_group/selected_village_response_name_Structure') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        assets: extractRepeatGroup(
          submission,
          'community_assets/communityassets',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'community_assets/communityassets/selected_village_name_assets') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        mainHazards: extractRepeatGroup(
          submission,
          'main_hazards/mainhazards',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'main_hazards/mainhazards/selected_village_name_mainhazards') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        assetsVulnerable: extractRepeatGroup(
          submission,
          'comm_assets_Vulnerable_DisasterG/comm_assets_Vulnerable_DisasterR',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'comm_assets_Vulnerable_DisasterG/comm_assets_Vulnerable_DisasterR/selected_village_name_DisasterR') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),

        assetsDamaged: extractRepeatGroup(
          submission,
          'comm_assets_Damaged_Disaster/comm_assets_Damaged_DisasterR',
          (item) => ({
            provinceCode, districtCode, clusterName,
            village: getNestedString(item, 'comm_assets_Damaged_Disaster/comm_assets_Damaged_DisasterR/selected_village_name_Damaged_DisasterR') ?? undefined,
            jsonData: flattenObject(item),
          }),
        ),
      };

      // Pass the Kobo _uuid as the submissionUuid — this is the idempotency key.
      // Matches original app behaviour where SubmissionUuid === Kobo _uuid.
      await createSubmission(request, koboUuid);
      result.importedCount++;
      console.log(`[KoboImport] Imported submission: ${koboUuid} (${clusterName})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Error importing ${koboUuid}: ${msg}`);
      console.error(`[KoboImport] Error for submission ${koboUuid}:`, err);
    }
  }

  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractRepeatGroup(
  submission: KoboSubmission,
  groupKey: string,
  factory: (item: Record<string, unknown>) => SubTableRecord,
): SubTableRecord[] {
  const group = submission[groupKey];
  if (!Array.isArray(group)) return [];
  return (group as Record<string, unknown>[]).map(factory);
}

function getString(obj: KoboSubmission, key: string): string {
  const val = obj[key];
  return val !== undefined && val !== null ? String(val) : '';
}

function getNestedString(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  return val !== undefined && val !== null ? String(val) : null;
}

function simplifyKey(key: string): string {
  const idx = key.lastIndexOf('/');
  return idx >= 0 ? key.slice(idx + 1) : key;
}

/**
 * Flatten a nested Kobo object into a single-level map using the last path segment
 * as the key — mirrors SerializeFlattened() in the original C# KoboImportService.
 */
function flattenObject(obj: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const shortKey = simplifyKey(key);
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const nested = flattenObject(val as Record<string, unknown>);
      Object.assign(flat, nested);
    } else {
      flat[shortKey] = val;
    }
  }
  return flat;
}
