// ─────────────────────────────────────────────────────────────────────────────
// DynamoDB Single-Table Design  –  CommunityProfiles
//
// Table Name  : CommunityProfiles
// Partition Key (PK)  : String
// Sort Key      (SK)  : String
//
// Item key patterns
// ─────────────────────────────────────────────────────────────────────────────
//  Submission summary  :  PK = "SUBMISSION#<uuid>"   SK = "META"
//  Cluster             :  PK = "SUBMISSION#<uuid>"   SK = "CLUSTER#<id>"
//  Village             :  PK = "SUBMISSION#<uuid>"   SK = "VILLAGE#<id>"
//  ParticipantDetail   :  PK = "SUBMISSION#<uuid>"   SK = "PARTICIPANT#<id>"
//  SocialStructure     :  PK = "SUBMISSION#<uuid>"   SK = "SOCIAL_STRUCTURE#<id>"
//  PopulationGroup     :  PK = "SUBMISSION#<uuid>"   SK = "POPULATION_GROUP#<id>"
//  Accessibility       :  PK = "SUBMISSION#<uuid>"   SK = "ACCESSIBILITY#<id>"
//  RoadCondition       :  PK = "SUBMISSION#<uuid>"   SK = "ROAD_CONDITION#<id>"
//  ResponseStructure   :  PK = "SUBMISSION#<uuid>"   SK = "RESPONSE_STRUCTURE#<id>"
//  Asset               :  PK = "SUBMISSION#<uuid>"   SK = "ASSET#<id>"
//  MainHazard          :  PK = "SUBMISSION#<uuid>"   SK = "MAIN_HAZARD#<id>"
//  AssetVulnerable     :  PK = "SUBMISSION#<uuid>"   SK = "ASSET_VULNERABLE#<id>"
//  AssetDamaged        :  PK = "SUBMISSION#<uuid>"   SK = "ASSET_DAMAGED#<id>"
//
// GSI1  (listing / filtering)
//  PK = "ALL_SUBMISSIONS"   SK = "<ISO-createdAt>#<submissionUuid>"
//  Projected attributes:  ALL
//  → Supports: list all submissions (paginated), filter client-side by
//              provinceCode / districtCode / clusterName
// ─────────────────────────────────────────────────────────────────────────────

// ── DynamoDB key helpers ─────────────────────────────────────────────────────

export const ENTITY_TYPES = {
  META: 'META',
  CLUSTER: 'CLUSTER',
  VILLAGE: 'VILLAGE',
  PARTICIPANT: 'PARTICIPANT',
  SOCIAL_STRUCTURE: 'SOCIAL_STRUCTURE',
  POPULATION_GROUP: 'POPULATION_GROUP',
  ACCESSIBILITY: 'ACCESSIBILITY',
  ROAD_CONDITION: 'ROAD_CONDITION',
  RESPONSE_STRUCTURE: 'RESPONSE_STRUCTURE',
  ASSET: 'ASSET',
  MAIN_HAZARD: 'MAIN_HAZARD',
  ASSET_VULNERABLE: 'ASSET_VULNERABLE',
  ASSET_DAMAGED: 'ASSET_DAMAGED',
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

export function buildPK(submissionUuid: string): string {
  return `SUBMISSION#${submissionUuid}`;
}

export function buildSK(entityType: EntityType, id?: string): string {
  return id ? `${entityType}#${id}` : entityType;
}

export function buildGSI1PK(): string {
  return 'ALL_SUBMISSIONS';
}

export function buildGSI1SK(createdAt: string, submissionUuid: string): string {
  return `${createdAt}#${submissionUuid}`;
}

// ── Base DynamoDB item ───────────────────────────────────────────────────────

export interface DynamoBaseItem {
  PK: string;
  SK: string;
  entityType: EntityType;
}

// ── Submission summary (META item) ───────────────────────────────────────────

export interface SubmissionMeta extends DynamoBaseItem {
  entityType: 'META';
  submissionUuid: string;
  provinceCode: string;
  districtCode: string;
  clusterName: string;
  /** Top-level enumerator name extracted from cluster JsonData for list display */
  enumeratorName: string;
  /** Top-level enumerator phone extracted from cluster JsonData for list display */
  enumeratorPhone: string;
  /** Survey date extracted from cluster JsonData (ISO-8601 date string) */
  surveyDate: string;
  createdAt: string;
  updatedAt: string;
  /** GSI1 Partition Key – always "ALL_SUBMISSIONS" */
  GSI1PK: string;
  /** GSI1 Sort Key – "<createdAt>#<submissionUuid>" for chronological ordering */
  GSI1SK: string;
}

// ── Shared base for every sub-table item ─────────────────────────────────────

export interface SubTableItem extends DynamoBaseItem {
  id: string;
  submissionUuid: string;
  provinceCode: string;
  districtCode: string;
  clusterName: string;
  village?: string;
  /** All Kobo-specific field values for this sub-table stored as a flexible map */
  jsonData: Record<string, unknown>;
}

// ── Typed sub-table item interfaces ──────────────────────────────────────────

export interface ClusterItem extends SubTableItem {
  entityType: 'CLUSTER';
}

export interface VillageItem extends SubTableItem {
  entityType: 'VILLAGE';
}

export interface ParticipantDetailItem extends SubTableItem {
  entityType: 'PARTICIPANT';
}

export interface SocialStructureItem extends SubTableItem {
  entityType: 'SOCIAL_STRUCTURE';
}

export interface PopulationGroupItem extends SubTableItem {
  entityType: 'POPULATION_GROUP';
}

export interface AccessibilityItem extends SubTableItem {
  entityType: 'ACCESSIBILITY';
}

export interface RoadConditionItem extends SubTableItem {
  entityType: 'ROAD_CONDITION';
}

export interface ResponseStructureItem extends SubTableItem {
  entityType: 'RESPONSE_STRUCTURE';
}

export interface AssetItem extends SubTableItem {
  entityType: 'ASSET';
}

export interface MainHazardItem extends SubTableItem {
  entityType: 'MAIN_HAZARD';
}

export interface AssetVulnerableItem extends SubTableItem {
  entityType: 'ASSET_VULNERABLE';
}

export interface AssetDamagedItem extends SubTableItem {
  entityType: 'ASSET_DAMAGED';
}

export type AnyTableItem =
  | SubmissionMeta
  | ClusterItem
  | VillageItem
  | ParticipantDetailItem
  | SocialStructureItem
  | PopulationGroupItem
  | AccessibilityItem
  | RoadConditionItem
  | ResponseStructureItem
  | AssetItem
  | MainHazardItem
  | AssetVulnerableItem
  | AssetDamagedItem;

// ── API Request / Response shapes ─────────────────────────────────────────────

/** Single sub-table row payload used by both create and update requests */
export interface SubTableRecord {
  provinceCode: string;
  districtCode: string;
  clusterName: string;
  village?: string;
  jsonData: Record<string, unknown>;
}

/**
 * Full bulk create/update payload.
 * Mirrors CommunityProfileBulkCreateRequest from the existing .NET backend.
 */
export interface CommunityProfileBulkRequest {
  cluster?: SubTableRecord;
  villages: SubTableRecord[];
  participantDetails: SubTableRecord[];
  socialStructures: SubTableRecord[];
  populationGroups: SubTableRecord[];
  accessibilities: SubTableRecord[];
  roadConditions: SubTableRecord[];
  responseStructures: SubTableRecord[];
  assets: SubTableRecord[];
  mainHazards: SubTableRecord[];
  assetsVulnerable: SubTableRecord[];
  assetsDamaged: SubTableRecord[];
}

/** Full submission returned from the API (read model) */
export interface CommunityProfileSubmission {
  meta: SubmissionSummary;
  cluster?: SubTableRecord;
  villages: SubTableRecord[];
  participantDetails: SubTableRecord[];
  socialStructures: SubTableRecord[];
  populationGroups: SubTableRecord[];
  accessibilities: SubTableRecord[];
  roadConditions: SubTableRecord[];
  responseStructures: SubTableRecord[];
  assets: SubTableRecord[];
  mainHazards: SubTableRecord[];
  assetsVulnerable: SubTableRecord[];
  assetsDamaged: SubTableRecord[];
}

/** Lightweight summary for the list view */
export interface SubmissionSummary {
  submissionUuid: string;
  provinceCode: string;
  districtCode: string;
  clusterName: string;
  enumeratorName: string;
  enumeratorPhone: string;
  surveyDate: string;
  createdAt: string;
  updatedAt: string;
}

/** Paginated list response */
export interface ListSubmissionsResponse {
  items: SubmissionSummary[];
  /** DynamoDB LastEvaluatedKey serialised as base64 for cursor pagination */
  nextToken?: string;
}

/** Standard API success wrapper */
export interface ApiResponse<T> {
  success: true;
  data: T;
}

/** Standard API error wrapper */
export interface ApiErrorResponse {
  success: false;
  message: string;
  statusCode: number;
}

// ── Lookup / Enum constants (mirrors the existing Angular model) ──────────────

export const PROVINCE_OPTIONS: { code: string; name: string }[] = [
  { code: 'AF01', name: 'Kabul' },
  { code: 'AF02', name: 'Kapisa' },
  { code: 'AF03', name: 'Parwan' },
  { code: 'AF04', name: 'Maidan Wardak' },
  { code: 'AF05', name: 'Logar' },
  { code: 'AF06', name: 'Nangarhar' },
  { code: 'AF07', name: 'Laghman' },
  { code: 'AF08', name: 'Panjsher' },
  { code: 'AF09', name: 'Baghlan' },
  { code: 'AF10', name: 'Bamyan' },
  { code: 'AF11', name: 'Ghazni' },
  { code: 'AF12', name: 'Paktika' },
  { code: 'AF13', name: 'Paktya' },
  { code: 'AF14', name: 'Khost' },
  { code: 'AF15', name: 'Kunar' },
  { code: 'AF16', name: 'Nuristan' },
  { code: 'AF17', name: 'Badakhshan' },
  { code: 'AF18', name: 'Takhar' },
  { code: 'AF19', name: 'Kunduz' },
  { code: 'AF20', name: 'Samangan' },
  { code: 'AF21', name: 'Balkh' },
  { code: 'AF22', name: 'Sar-e-Pul' },
  { code: 'AF23', name: 'Ghor' },
  { code: 'AF24', name: 'Daykundi' },
  { code: 'AF25', name: 'Uruzgan' },
  { code: 'AF26', name: 'Zabul' },
  { code: 'AF27', name: 'Kandahar' },
  { code: 'AF28', name: 'Jawzjan' },
  { code: 'AF29', name: 'Faryab' },
  { code: 'AF30', name: 'Hilmand' },
  { code: 'AF31', name: 'Badghis' },
  { code: 'AF32', name: 'Hirat' },
  { code: 'AF33', name: 'Farah' },
  { code: 'AF34', name: 'Nimroz' },
];

export const GENDER_OPTIONS = ['male', 'female', 'Information not available'] as const;

export const YES_NO_OPTIONS = ['yes', 'no'] as const;

export const HAZARD_FORCE_OPTIONS = [
  { value: 'hazardforce1', label: 'Extremely Destructive' },
  { value: 'hazardforce2', label: 'Severely Destructive' },
  { value: 'hazardforce3', label: 'Moderately Destructive' },
  { value: 'hazardforce4', label: 'Non Destructive' },
] as const;

export const TIMEFRAME_OPTIONS = [
  { value: 'timeframe1', label: 'Ongoing' },
  { value: 'timeframe2', label: 'Within 1 year' },
  { value: 'timeframe3', label: 'Within 5 years' },
  { value: 'timeframe4', label: 'Within 10 years' },
  { value: 'timeframe5', label: 'Within 15 years' },
  { value: 'timeframe6', label: 'Within 20 years' },
] as const;

export const NATURAL_DISASTER_OPTIONS = [
  { value: 'Ndlist1', label: 'Flood' },
  { value: 'Ndlist2', label: 'Earthquake' },
  { value: 'Ndlist3', label: 'Landslide' },
  { value: 'Ndlist4', label: 'Rock fall' },
  { value: 'Ndlist5', label: 'Drought' },
  { value: 'Ndlist6', label: 'Avalanche' },
  { value: 'Ndlist7', label: 'Other' },
] as const;

export const MAIN_HAZARD_OPTIONS = [
  { value: 'mainhazards1', label: 'Flood' },
  { value: 'mainhazards2', label: 'Earthquake' },
  { value: 'mainhazards3', label: 'Drought' },
  { value: 'mainhazards4', label: 'Avalanche' },
  { value: 'mainhazards5', label: 'Landslide' },
  { value: 'mainhazards6', label: 'Rock fall' },
  { value: 'mainhazards7', label: 'Others' },
] as const;

export const ROAD_CONDITION_OPTIONS = [
  { value: 'roadconditions1', label: 'Always open' },
  { value: 'roadconditions2', label: 'Light vehicles only' },
  { value: 'roadconditions3', label: 'Light + heavy vehicles' },
  { value: 'roadconditions4', label: 'Closed in winter' },
  { value: 'roadconditions5', label: 'Affected' },
  { value: 'roadconditions6', label: 'NA' },
] as const;

export const WALKING_TRACK_OPTIONS = [
  { value: 'walkingtrackcon1', label: 'NA' },
  { value: 'walkingtrackcon2', label: 'Always open' },
  { value: 'walkingtrackcon3', label: 'Closed in winter' },
] as const;

export const COMMUNITY_SOCIAL_STRUCTURE_ROLES = [
  'malik',
  'mula_imam',
  'youth_council',
  'community_member_1',
  'community_member_2',
  'women_focal_point',
  'other_influencer',
  'short_description',
] as const;

export const POPULATION_FIELDS = [
  { key: 'pop1', label: 'Total Households' },
  { key: 'pop2', label: 'Total Population' },
  { key: 'pop3', label: 'Male Population' },
  { key: 'pop4', label: 'Female Population' },
  { key: 'pop5', label: 'IDP Families' },
  { key: 'pop6', label: 'Returnee Families' },
  { key: 'pop7', label: 'Migrant Families' },
  { key: 'pop8', label: 'Disabled Persons' },
  { key: 'pop9', label: 'Elderly (60+)' },
  { key: 'pop10', label: 'Children Under 5' },
  { key: 'pop11', label: 'Boys 5-17' },
  { key: 'pop12', label: 'Girls 5-17' },
  { key: 'popEth1', label: 'Ethnic Group 1' },
  { key: 'popEth2', label: 'Ethnic Group 2' },
  { key: 'popEth3', label: 'Ethnic Group 3' },
  { key: 'popEth4', label: 'Ethnic Group 4' },
  { key: 'popEth5', label: 'Ethnic Group 5' },
  { key: 'popEth6', label: 'Ethnic Group 6' },
  { key: 'popEth7', label: 'Ethnic Group 7' },
] as const;

export const RESPONSE_STRUCTURE_ROLES = [
  { key: 'male_health_worker', label: 'Male Health Worker' },
  { key: 'female_health_worker', label: 'Female Health Worker' },
  { key: 'first_aid_team', label: 'First Aid Team' },
  { key: 'search_rescue_team', label: 'Search & Rescue Team' },
  { key: 'early_warning', label: 'Early Warning' },
  { key: 'drr_knowledge', label: 'DRR Knowledge' },
  { key: 'psychosocial', label: 'Psychosocial' },
  { key: 'others', label: 'Others' },
] as const;

export const COMMUNITY_ASSET_OPTIONS = [
  { value: 'communityasset1', label: 'BHC' },
  { value: 'communityasset2', label: 'CHC' },
  { value: 'communityasset3', label: 'Farmland' },
  { value: 'communityasset4', label: 'Livestock' },
  { value: 'communityasset5', label: 'School' },
  { value: 'communityasset6', label: 'Mosque' },
  { value: 'communityasset7', label: 'Water Source' },
  { value: 'communityasset8', label: 'Bridge' },
  { value: 'communityasset9', label: 'Market' },
  { value: 'communityasset10', label: 'Road' },
  { value: 'communityasset11', label: 'Irrigation Canal' },
  { value: 'communityasset12', label: 'Community Centre' },
  { value: 'communityasset13', label: 'Forest' },
  { value: 'communityasset14', label: 'Mineral Mine' },
  { value: 'communityasset15', label: 'MHP' },
  { value: 'communityasset16', label: 'Solar Panel' },
  { value: 'communityasset17', label: 'Pond / Reservoir' },
  { value: 'communityasset18', label: 'Retaining Wall' },
  { value: 'communityasset19', label: 'Gabion' },
  { value: 'communityasset20', label: 'Check Dam' },
  { value: 'communityasset21', label: 'Other' },
] as const;

export const ELEMENTS_AT_RISK_OPTIONS = [
  { value: 'elementsatrisk1', label: 'Houses' },
  { value: 'elementsatrisk2', label: 'Agricultural Land' },
  { value: 'elementsatrisk3', label: 'Gardens' },
  { value: 'elementsatrisk4', label: 'Roads' },
  { value: 'elementsatrisk5', label: 'Health Facility' },
  { value: 'elementsatrisk6', label: 'Education Facility' },
  { value: 'elementsatrisk7', label: 'Mosque' },
  { value: 'elementsatrisk8', label: 'Market' },
  { value: 'elementsatrisk9', label: 'Irrigation Canal' },
  { value: 'elementsatrisk10', label: 'Water Supply' },
  { value: 'elementsatrisk11', label: 'Community Centre' },
  { value: 'elementsatrisk12', label: 'Bridge' },
  { value: 'elementsatrisk13', label: 'MHP' },
  { value: 'elementsatrisk14', label: 'Forest' },
  { value: 'elementsatrisk15', label: 'Mineral Mines' },
  { value: 'elementsatrisk16', label: 'Other' },
] as const;

export const ROAD_TYPES = [
  { key: 'paved', label: 'Paved Road', dataKey: 'road_paved' },
  { key: 'unpaved', label: 'Unpaved Road', dataKey: 'road_unpaved' },
  { key: 'tertiary', label: 'Community / Tertiary Road', dataKey: 'road_tertiary' },
  { key: 'gravel', label: 'Gravel Road', dataKey: 'road_gravel' },
] as const;

export const SUB_TABLE_KEYS = [
  'cluster',
  'villages',
  'participantDetails',
  'socialStructures',
  'populationGroups',
  'accessibilities',
  'roadConditions',
  'responseStructures',
  'assets',
  'mainHazards',
  'assetsVulnerable',
  'assetsDamaged',
] as const satisfies (keyof CommunityProfileBulkRequest)[];

export const SUB_TABLE_LABELS: Record<(typeof SUB_TABLE_KEYS)[number], string> = {
  cluster: 'Cluster',
  villages: 'Villages',
  participantDetails: 'Participant Details',
  socialStructures: 'Social Structures',
  populationGroups: 'Population Groups',
  accessibilities: 'Accessibilities',
  roadConditions: 'Road Conditions',
  responseStructures: 'Response Structures',
  assets: 'Community Assets',
  mainHazards: 'Main Hazards',
  assetsVulnerable: 'Assets Vulnerable',
  assetsDamaged: 'Assets Damaged',
};
