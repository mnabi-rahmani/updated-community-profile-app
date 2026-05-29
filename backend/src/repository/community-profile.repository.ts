import { randomUUID } from 'crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  BatchWriteCommand,
  QueryCommand as DocQueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  AnyTableItem,
  CommunityProfileBulkRequest,
  CommunityProfileSubmission,
  ListSubmissionsResponse,
  SubTableItem,
  SubTableRecord,
  SubmissionMeta,
  SubmissionSummary,
} from '../models/community-profile';
import {
  ENTITY_TYPES,
  buildGSI1PK,
  buildGSI1SK,
  buildPK,
  buildSK,
} from '../models/community-profile';

const TABLE_NAME = process.env.DYNAMODB_TABLE ?? 'CommunityProfiles';
const GSI1_NAME = 'GSI1';

// ── DynamoDB client setup ────────────────────────────────────────────────────

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// ── Helper: extract top-level display fields from cluster jsonData ────────────

function extractMetaFromCluster(
  cluster: SubTableRecord,
  submissionUuid: string,
  now: string,
): Omit<SubmissionMeta, 'PK' | 'SK' | 'entityType' | 'GSI1PK' | 'GSI1SK'> {
  const json = cluster.jsonData as Record<string, string>;
  return {
    submissionUuid,
    provinceCode: cluster.provinceCode,
    districtCode: cluster.districtCode,
    clusterName: cluster.clusterName,
    enumeratorName: (json['EnumeratorName'] ?? json['enumeratorName'] ?? '') as string,
    enumeratorPhone: (json['EnumeratorPhone'] ?? json['enumeratorPhone'] ?? '') as string,
    surveyDate: (json['Date'] ?? json['date'] ?? '') as string,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Helper: map a SubTableRecord to a DynamoDB SubTableItem ──────────────────

function toSubTableItem(
  submissionUuid: string,
  entityType: SubTableItem['entityType'],
  record: SubTableRecord,
  id?: string,
): SubTableItem {
  const itemId = id ?? randomUUID();
  return {
    PK: buildPK(submissionUuid),
    SK: buildSK(entityType, itemId),
    entityType,
    id: itemId,
    submissionUuid,
    provinceCode: record.provinceCode,
    districtCode: record.districtCode,
    clusterName: record.clusterName,
    village: record.village,
    jsonData: record.jsonData,
  };
}

// ── Helper: map DynamoDB items back to SubTableRecord[] ──────────────────────

function toSubTableRecord(item: SubTableItem): SubTableRecord {
  return {
    provinceCode: item.provinceCode,
    districtCode: item.districtCode,
    clusterName: item.clusterName,
    village: item.village,
    jsonData: item.jsonData,
  };
}

// ── Helper: split array into DynamoDB BatchWrite chunks (max 25 per call) ────

function chunk<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// ── CHECK EXISTENCE ───────────────────────────────────────────────────────────

/**
 * Returns true if a META item already exists for the given submissionUuid.
 * Used by the Kobo importer to skip already-imported submissions (idempotency).
 */
export async function submissionExists(submissionUuid: string): Promise<boolean> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: buildPK(submissionUuid), SK: ENTITY_TYPES.META },
      ProjectionExpression: 'PK',
    }),
  );
  return result.Item != null;
}

// ── CREATE ────────────────────────────────────────────────────────────────────

export async function createSubmission(
  request: CommunityProfileBulkRequest,
  /** Supply a specific UUID (e.g. the Kobo _uuid) instead of auto-generating one */
  externalUuid?: string,
): Promise<SubmissionSummary> {
  const submissionUuid = externalUuid ?? randomUUID();
  const now = new Date().toISOString();

  const items: AnyTableItem[] = [];

  // Submission META item
  if (request.cluster) {
    const metaBase = extractMetaFromCluster(request.cluster, submissionUuid, now);
    const meta: SubmissionMeta = {
      ...metaBase,
      PK: buildPK(submissionUuid),
      SK: ENTITY_TYPES.META,
      entityType: ENTITY_TYPES.META,
      GSI1PK: buildGSI1PK(),
      GSI1SK: buildGSI1SK(now, submissionUuid),
    };
    items.push(meta);

    // Cluster sub-table
    items.push(toSubTableItem(submissionUuid, ENTITY_TYPES.CLUSTER, request.cluster) as AnyTableItem);
  }

  // Remaining sub-tables
  const subTableMap: [SubTableItem['entityType'], SubTableRecord[]][] = [
    [ENTITY_TYPES.VILLAGE, request.villages],
    [ENTITY_TYPES.PARTICIPANT, request.participantDetails],
    [ENTITY_TYPES.SOCIAL_STRUCTURE, request.socialStructures],
    [ENTITY_TYPES.POPULATION_GROUP, request.populationGroups],
    [ENTITY_TYPES.ACCESSIBILITY, request.accessibilities],
    [ENTITY_TYPES.ROAD_CONDITION, request.roadConditions],
    [ENTITY_TYPES.RESPONSE_STRUCTURE, request.responseStructures],
    [ENTITY_TYPES.ASSET, request.assets],
    [ENTITY_TYPES.MAIN_HAZARD, request.mainHazards],
    [ENTITY_TYPES.ASSET_VULNERABLE, request.assetsVulnerable],
    [ENTITY_TYPES.ASSET_DAMAGED, request.assetsDamaged],
  ];

  for (const [entityType, records] of subTableMap) {
    for (const record of records) {
      items.push(toSubTableItem(submissionUuid, entityType, record) as AnyTableItem);
    }
  }

  // Batch-write all items (DynamoDB max 25 per batch)
  for (const batch of chunk(items, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      }),
    );
  }

  const meta = items.find((i) => i.entityType === ENTITY_TYPES.META) as SubmissionMeta;
  return {
    submissionUuid: meta.submissionUuid,
    provinceCode: meta.provinceCode,
    districtCode: meta.districtCode,
    clusterName: meta.clusterName,
    enumeratorName: meta.enumeratorName,
    enumeratorPhone: meta.enumeratorPhone,
    surveyDate: meta.surveyDate,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

// ── GET (single submission) ───────────────────────────────────────────────────

export async function getSubmission(
  submissionUuid: string,
): Promise<CommunityProfileSubmission | null> {
  const result = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': buildPK(submissionUuid) },
    }),
  );

  if (!result.Items || result.Items.length === 0) return null;

  const all = result.Items as AnyTableItem[];

  const meta = all.find((i) => i.entityType === ENTITY_TYPES.META) as SubmissionMeta | undefined;
  if (!meta) return null;

  const filter = <T extends SubTableItem>(type: EntityType): SubTableRecord[] =>
    (all.filter((i) => i.entityType === type) as T[]).map(toSubTableRecord);

  type EntityType = SubTableItem['entityType'];

  return {
    meta: {
      submissionUuid: meta.submissionUuid,
      provinceCode: meta.provinceCode,
      districtCode: meta.districtCode,
      clusterName: meta.clusterName,
      enumeratorName: meta.enumeratorName,
      enumeratorPhone: meta.enumeratorPhone,
      surveyDate: meta.surveyDate,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    },
    cluster: filter(ENTITY_TYPES.CLUSTER)[0],
    villages: filter(ENTITY_TYPES.VILLAGE),
    participantDetails: filter(ENTITY_TYPES.PARTICIPANT),
    socialStructures: filter(ENTITY_TYPES.SOCIAL_STRUCTURE),
    populationGroups: filter(ENTITY_TYPES.POPULATION_GROUP),
    accessibilities: filter(ENTITY_TYPES.ACCESSIBILITY),
    roadConditions: filter(ENTITY_TYPES.ROAD_CONDITION),
    responseStructures: filter(ENTITY_TYPES.RESPONSE_STRUCTURE),
    assets: filter(ENTITY_TYPES.ASSET),
    mainHazards: filter(ENTITY_TYPES.MAIN_HAZARD),
    assetsVulnerable: filter(ENTITY_TYPES.ASSET_VULNERABLE),
    assetsDamaged: filter(ENTITY_TYPES.ASSET_DAMAGED),
  };
}

// ── LIST (paginated, via GSI1) ────────────────────────────────────────────────

export async function listSubmissions(options: {
  provinceCode?: string;
  districtCode?: string;
  clusterName?: string;
  limit?: number;
  nextToken?: string;
}): Promise<ListSubmissionsResponse> {
  const { provinceCode, districtCode, clusterName, limit = 50, nextToken } = options;

  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (nextToken) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf-8'));
    } catch {
      exclusiveStartKey = undefined;
    }
  }

  // Build optional filter expression for province/district/cluster
  const filterParts: string[] = [];
  const expressionValues: Record<string, unknown> = { ':gsi1pk': buildGSI1PK() };
  const expressionNames: Record<string, string> = {};

  if (provinceCode) {
    filterParts.push('#pc = :pc');
    expressionNames['#pc'] = 'provinceCode';
    expressionValues[':pc'] = provinceCode;
  }
  if (districtCode) {
    filterParts.push('#dc = :dc');
    expressionNames['#dc'] = 'districtCode';
    expressionValues[':dc'] = districtCode;
  }
  if (clusterName) {
    filterParts.push('#cn = :cn');
    expressionNames['#cn'] = 'clusterName';
    expressionValues[':cn'] = clusterName;
  }

  const result = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      ExpressionAttributeValues: expressionValues,
      ExpressionAttributeNames:
        Object.keys(expressionNames).length > 0 ? expressionNames : undefined,
      ScanIndexForward: false, // newest first
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey as Record<string, unknown> | undefined,
    }),
  );

  const items = (result.Items ?? []) as SubmissionMeta[];

  return {
    items: items.map((m) => ({
      submissionUuid: m.submissionUuid,
      provinceCode: m.provinceCode,
      districtCode: m.districtCode,
      clusterName: m.clusterName,
      enumeratorName: m.enumeratorName,
      enumeratorPhone: m.enumeratorPhone,
      surveyDate: m.surveyDate,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    })),
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

// ── UPDATE (delete-and-recreate strategy, matching existing .NET backend) ─────

export async function updateSubmission(
  submissionUuid: string,
  request: CommunityProfileBulkRequest,
): Promise<SubmissionSummary | null> {
  // Step 1: fetch existing keys so we can delete them
  const existing = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': buildPK(submissionUuid) },
      ProjectionExpression: 'PK, SK',
    }),
  );

  if (!existing.Items || existing.Items.length === 0) return null;

  // Step 2: delete all existing items in batches
  const deleteRequests = existing.Items.map((item) => ({
    DeleteRequest: { Key: { PK: item['PK'], SK: item['SK'] } },
  }));

  for (const batch of chunk(deleteRequests, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE_NAME]: batch },
      }),
    );
  }

  // Step 3: re-create with updated data (preserving original createdAt from meta)
  const originalMeta = existing.Items.find(
    (i) => i['SK'] === ENTITY_TYPES.META,
  ) as SubmissionMeta | undefined;
  const createdAt = originalMeta?.createdAt ?? new Date().toISOString();
  const now = new Date().toISOString();

  const items: AnyTableItem[] = [];

  if (request.cluster) {
    const metaBase = extractMetaFromCluster(request.cluster, submissionUuid, createdAt);
    const meta: SubmissionMeta = {
      ...metaBase,
      updatedAt: now,
      PK: buildPK(submissionUuid),
      SK: ENTITY_TYPES.META,
      entityType: ENTITY_TYPES.META,
      GSI1PK: buildGSI1PK(),
      GSI1SK: buildGSI1SK(createdAt, submissionUuid),
    };
    items.push(meta);
    items.push(toSubTableItem(submissionUuid, ENTITY_TYPES.CLUSTER, request.cluster) as AnyTableItem);
  }

  const subTableMap: [SubTableItem['entityType'], SubTableRecord[]][] = [
    [ENTITY_TYPES.VILLAGE, request.villages],
    [ENTITY_TYPES.PARTICIPANT, request.participantDetails],
    [ENTITY_TYPES.SOCIAL_STRUCTURE, request.socialStructures],
    [ENTITY_TYPES.POPULATION_GROUP, request.populationGroups],
    [ENTITY_TYPES.ACCESSIBILITY, request.accessibilities],
    [ENTITY_TYPES.ROAD_CONDITION, request.roadConditions],
    [ENTITY_TYPES.RESPONSE_STRUCTURE, request.responseStructures],
    [ENTITY_TYPES.ASSET, request.assets],
    [ENTITY_TYPES.MAIN_HAZARD, request.mainHazards],
    [ENTITY_TYPES.ASSET_VULNERABLE, request.assetsVulnerable],
    [ENTITY_TYPES.ASSET_DAMAGED, request.assetsDamaged],
  ];

  for (const [entityType, records] of subTableMap) {
    for (const record of records) {
      items.push(toSubTableItem(submissionUuid, entityType, record) as AnyTableItem);
    }
  }

  for (const batch of chunk(items, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: batch.map((item) => ({
            PutRequest: { Item: item },
          })),
        },
      }),
    );
  }

  const meta = items.find((i) => i.entityType === ENTITY_TYPES.META) as SubmissionMeta;
  return {
    submissionUuid: meta.submissionUuid,
    provinceCode: meta.provinceCode,
    districtCode: meta.districtCode,
    clusterName: meta.clusterName,
    enumeratorName: meta.enumeratorName,
    enumeratorPhone: meta.enumeratorPhone,
    surveyDate: meta.surveyDate,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function deleteSubmission(submissionUuid: string): Promise<boolean> {
  const existing = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': buildPK(submissionUuid) },
      ProjectionExpression: 'PK, SK',
    }),
  );

  if (!existing.Items || existing.Items.length === 0) return false;

  const deleteRequests = existing.Items.map((item) => ({
    DeleteRequest: { Key: { PK: item['PK'], SK: item['SK'] } },
  }));

  for (const batch of chunk(deleteRequests, 25)) {
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: { [TABLE_NAME]: batch },
      }),
    );
  }

  return true;
}

// ── Helper: get distinct provinces / districts / clusters for filter dropdowns ─

export async function getDistinctProvinces(): Promise<string[]> {
  const result = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: { ':gsi1pk': buildGSI1PK() },
      ProjectionExpression: 'provinceCode',
    }),
  );
  const codes = (result.Items ?? []).map((i) => i['provinceCode'] as string);
  return [...new Set(codes)].sort();
}

export async function getDistinctDistricts(provinceCode: string): Promise<string[]> {
  const result = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: 'provinceCode = :pc',
      ExpressionAttributeValues: { ':gsi1pk': buildGSI1PK(), ':pc': provinceCode },
      ProjectionExpression: 'districtCode',
    }),
  );
  const codes = (result.Items ?? []).map((i) => i['districtCode'] as string);
  return [...new Set(codes)].sort();
}

export async function getDistinctClusters(
  provinceCode: string,
  districtCode?: string,
): Promise<string[]> {
  const filterParts = ['provinceCode = :pc'];
  const values: Record<string, unknown> = { ':gsi1pk': buildGSI1PK(), ':pc': provinceCode };

  if (districtCode) {
    filterParts.push('districtCode = :dc');
    values[':dc'] = districtCode;
  }

  const result = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      FilterExpression: filterParts.join(' AND '),
      ExpressionAttributeValues: values,
      ProjectionExpression: 'clusterName',
    }),
  );
  const names = (result.Items ?? []).map((i) => i['clusterName'] as string);
  return [...new Set(names)].sort();
}
