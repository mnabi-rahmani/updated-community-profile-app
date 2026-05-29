// ─────────────────────────────────────────────────────────────────────────────
// DynamoDB Single-Table Design – Awaaz Cases
//
// Uses the same CommunityProfiles table with different PK/SK patterns
// ─────────────────────────────────────────────────────────────────────────────

export const AWAAZ_ENTITY_TYPES = {
  CASE: 'AWAAZ_CASE',
} as const;

export type AwaazEntityType = (typeof AWAAZ_ENTITY_TYPES)[keyof typeof AWAAZ_ENTITY_TYPES];

export function buildAwaazPK(caseId: string): string {
  return `AWAAZ_CASE#${caseId}`;
}

export function buildAwaazSK(): string {
  return 'DETAIL';
}

export function buildAwaazGSI1PK(): string {
  return 'ALL_AWAAZ_CASES';
}

export function buildAwaazGSI1SK(dateReported: string, caseId: string): string {
  return `${dateReported}#${caseId}`;
}

// ── DynamoDB item shape ─────────────────────────────────────────────────────

export type AwaazCaseSource = 'Excel Import' | 'Kobo';

export interface AwaazCaseItem {
  PK: string;
  SK: string;
  entityType: 'AWAAZ_CASE';
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
  createdAt: string;
  updatedAt: string;
  GSI1PK: string;
  GSI1SK: string;
}

// ── API shapes ─────────────────────────────────────────────────────────────

export interface AwaazCaseSummary {
  caseId: string;
  units: string;
  feedbackChannel: string;
  channelType: string;
  dateReported: string;
  submissionDate: string;
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
}

export interface AwaazCaseDetail extends AwaazCaseSummary {
  forwardedDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListAwaazCasesResponse {
  items: AwaazCaseSummary[];
  nextToken?: string;
  totalCount?: number;
}

export interface AwaazCaseFilters {
  provinceCode?: string;
  districtCode?: string;
  channelType?: string;
  referralStatus?: string;
  region?: string;
  callerType?: string;
  gender?: string;
  issue?: string;
}

export interface AwaazImportResult {
  totalRows: number;
  importedCount: number;
  skippedCount: number;
  errors: string[];
}

export interface AwaazUpsertResult {
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  errors: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────

export const CHANNEL_TYPE_OPTIONS = ['Awaaz', 'Zite Manager'] as const;

export const REFERRAL_STATUS_OPTIONS = ['Open', 'Closed', 'In Progress', 'Pending', 'Unchecked'] as const;

export const VALIDATION_STATUS_OPTIONS = ['Approved', 'Not Approved', 'On Hold', 'Pending'] as const;

export const REGION_OPTIONS = [
  'Capital',
  'Central',
  'Central Highlands',
  'Eastern',
  'North Eastern',
  'Northern',
  'South Eastern',
  'Southern',
  'Western',
] as const;

export const CALLER_TYPE_OPTIONS = [
  'Returnee - International',
  'Returnee - Internal',
  'IDP',
  'Host Community',
  'Other',
] as const;

export const GENDER_OPTIONS = ['Male', 'Female', 'Other'] as const;

export const AGE_GROUP_OPTIONS = [
  '0 - 17',
  '18 - 25',
  '26 - 35',
  '36 - 45',
  '46 - 59',
  '60+',
] as const;

export const ISSUE_OPTIONS = [
  'Feedback & Requests',
  'Complaint',
  'Information Request',
  'Referral',
  'Emergency',
  'Other',
] as const;
