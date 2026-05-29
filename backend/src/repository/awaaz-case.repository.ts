import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  BatchWriteCommand,
  QueryCommand as DocQueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  AwaazCaseItem,
  AwaazCaseSummary,
  AwaazCaseDetail,
  ListAwaazCasesResponse,
  AwaazCaseFilters,
  AwaazCaseSource,
} from '../models/awaaz-case';
import {
  AWAAZ_ENTITY_TYPES,
  buildAwaazPK,
  buildAwaazSK,
  buildAwaazGSI1PK,
  buildAwaazGSI1SK,
} from '../models/awaaz-case';

const TABLE_NAME = process.env.DYNAMODB_TABLE ?? 'CommunityProfiles';
const GSI1_NAME = 'GSI1';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

function chunk<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function toSummary(item: AwaazCaseItem): AwaazCaseSummary {
  return {
    caseId: item.caseId,
    units: item.units,
    feedbackChannel: item.feedbackChannel,
    channelType: item.channelType,
    dateReported: item.dateReported,
    submissionDate: item.submissionDate || '',
    callerType: item.callerType,
    gender: item.gender,
    ageGroup: item.ageGroup,
    region: item.region,
    provinceCode: item.provinceCode,
    districtCode: item.districtCode,
    provinceName: item.provinceName,
    districtName: item.districtName,
    neighbourhood: item.neighbourhood,
    issue: item.issue,
    referralStatus: item.referralStatus,
    validationStatus: item.validationStatus || '',
    dateClosed: item.dateClosed,
    source: item.source || 'Excel Import',
  };
}

function toDetail(item: AwaazCaseItem): AwaazCaseDetail {
  return {
    ...toSummary(item),
    forwardedDate: item.forwardedDate,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function caseExists(caseId: string): Promise<boolean> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: buildAwaazPK(caseId), SK: buildAwaazSK() },
      ProjectionExpression: 'PK',
    }),
  );
  return result.Item != null;
}

export async function createCase(data: {
  caseId: string;
  units: string;
  feedbackChannel: string;
  channelType: string;
  dateReported: string;
  submissionDate?: string;
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
  validationStatus?: string;
  dateClosed: string;
  source?: AwaazCaseSource;
}): Promise<AwaazCaseSummary> {
  const now = new Date().toISOString();
  const dateForSort = data.dateReported || now.split('T')[0];

  const item: AwaazCaseItem = {
    PK: buildAwaazPK(data.caseId),
    SK: buildAwaazSK(),
    entityType: AWAAZ_ENTITY_TYPES.CASE,
    caseId: data.caseId,
    units: data.units,
    feedbackChannel: data.feedbackChannel,
    channelType: data.channelType,
    dateReported: data.dateReported,
    submissionDate: data.submissionDate || '',
    forwardedDate: data.forwardedDate,
    callerType: data.callerType,
    gender: data.gender,
    ageGroup: data.ageGroup,
    region: data.region,
    provinceCode: data.provinceCode,
    districtCode: data.districtCode,
    provinceName: data.provinceName,
    districtName: data.districtName,
    neighbourhood: data.neighbourhood,
    issue: data.issue,
    referralStatus: data.referralStatus,
    validationStatus: data.validationStatus || '',
    dateClosed: data.dateClosed,
    source: data.source || 'Excel Import',
    createdAt: now,
    updatedAt: now,
    GSI1PK: buildAwaazGSI1PK(),
    GSI1SK: buildAwaazGSI1SK(dateForSort, data.caseId),
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    }),
  );

  return toSummary(item);
}

export async function batchCreateCases(cases: Parameters<typeof createCase>[0][]): Promise<{
  importedCount: number;
  skippedCount: number;
  errors: string[];
}> {
  const now = new Date().toISOString();
  let importedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  const items: AwaazCaseItem[] = [];

  for (const data of cases) {
    try {
      const exists = await caseExists(data.caseId);
      if (exists) {
        skippedCount++;
        continue;
      }

      const dateForSort = data.dateReported || now.split('T')[0];
      items.push({
        PK: buildAwaazPK(data.caseId),
        SK: buildAwaazSK(),
        entityType: AWAAZ_ENTITY_TYPES.CASE,
        caseId: data.caseId,
        units: data.units,
        feedbackChannel: data.feedbackChannel,
        channelType: data.channelType,
        dateReported: data.dateReported,
        submissionDate: data.submissionDate || '',
        forwardedDate: data.forwardedDate,
        callerType: data.callerType,
        gender: data.gender,
        ageGroup: data.ageGroup,
        region: data.region,
        provinceCode: data.provinceCode,
        districtCode: data.districtCode,
        provinceName: data.provinceName,
        districtName: data.districtName,
        neighbourhood: data.neighbourhood,
        issue: data.issue,
        referralStatus: data.referralStatus,
        validationStatus: data.validationStatus || '',
        dateClosed: data.dateClosed,
        source: data.source || 'Excel Import',
        createdAt: now,
        updatedAt: now,
        GSI1PK: buildAwaazGSI1PK(),
        GSI1SK: buildAwaazGSI1SK(dateForSort, data.caseId),
      });
    } catch (err) {
      errors.push(`Failed to process case ${data.caseId}: ${String(err)}`);
    }
  }

  for (const batch of chunk(items, 25)) {
    try {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: batch.map((item) => ({
              PutRequest: { Item: item },
            })),
          },
        }),
      );
      importedCount += batch.length;
    } catch (err) {
      errors.push(`Batch write failed: ${String(err)}`);
    }
  }

  return { importedCount, skippedCount, errors };
}

export async function batchUpsertCases(cases: Parameters<typeof createCase>[0][]): Promise<{
  importedCount: number;
  updatedCount: number;
  errors: string[];
}> {
  const now = new Date().toISOString();
  let importedCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];

  const newItems: AwaazCaseItem[] = [];
  const updateItems: { data: Parameters<typeof createCase>[0]; existingCreatedAt: string }[] = [];

  for (const data of cases) {
    try {
      const existing = await getCase(data.caseId);
      if (existing) {
        updateItems.push({ data, existingCreatedAt: existing.createdAt });
      } else {
        const dateForSort = data.dateReported || now.split('T')[0];
        newItems.push({
          PK: buildAwaazPK(data.caseId),
          SK: buildAwaazSK(),
          entityType: AWAAZ_ENTITY_TYPES.CASE,
          caseId: data.caseId,
          units: data.units,
          feedbackChannel: data.feedbackChannel,
          channelType: data.channelType,
          dateReported: data.dateReported,
          submissionDate: data.submissionDate || '',
          forwardedDate: data.forwardedDate,
          callerType: data.callerType,
          gender: data.gender,
          ageGroup: data.ageGroup,
          region: data.region,
          provinceCode: data.provinceCode,
          districtCode: data.districtCode,
          provinceName: data.provinceName,
          districtName: data.districtName,
          neighbourhood: data.neighbourhood,
          issue: data.issue,
          referralStatus: data.referralStatus,
          validationStatus: data.validationStatus || '',
          dateClosed: data.dateClosed,
          source: data.source || 'Excel Import',
          createdAt: now,
          updatedAt: now,
          GSI1PK: buildAwaazGSI1PK(),
          GSI1SK: buildAwaazGSI1SK(dateForSort, data.caseId),
        });
      }
    } catch (err) {
      errors.push(`Failed to process case ${data.caseId}: ${String(err)}`);
    }
  }

  for (const batch of chunk(newItems, 25)) {
    try {
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE_NAME]: batch.map((item) => ({
              PutRequest: { Item: item },
            })),
          },
        }),
      );
      importedCount += batch.length;
    } catch (err) {
      errors.push(`Batch write failed: ${String(err)}`);
    }
  }

  for (const { data, existingCreatedAt } of updateItems) {
    try {
      const dateForSort = data.dateReported || now.split('T')[0];
      const item: AwaazCaseItem = {
        PK: buildAwaazPK(data.caseId),
        SK: buildAwaazSK(),
        entityType: AWAAZ_ENTITY_TYPES.CASE,
        caseId: data.caseId,
        units: data.units,
        feedbackChannel: data.feedbackChannel,
        channelType: data.channelType,
        dateReported: data.dateReported,
        submissionDate: data.submissionDate || '',
        forwardedDate: data.forwardedDate,
        callerType: data.callerType,
        gender: data.gender,
        ageGroup: data.ageGroup,
        region: data.region,
        provinceCode: data.provinceCode,
        districtCode: data.districtCode,
        provinceName: data.provinceName,
        districtName: data.districtName,
        neighbourhood: data.neighbourhood,
        issue: data.issue,
        referralStatus: data.referralStatus,
        validationStatus: data.validationStatus || '',
        dateClosed: data.dateClosed,
        source: data.source || 'Excel Import',
        createdAt: existingCreatedAt,
        updatedAt: now,
        GSI1PK: buildAwaazGSI1PK(),
        GSI1SK: buildAwaazGSI1SK(dateForSort, data.caseId),
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
      updatedCount++;
    } catch (err) {
      errors.push(`Failed to update case ${data.caseId}: ${String(err)}`);
    }
  }

  return { importedCount, updatedCount, errors };
}

export async function getCase(caseId: string): Promise<AwaazCaseDetail | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: buildAwaazPK(caseId), SK: buildAwaazSK() },
    }),
  );

  if (!result.Item) return null;
  return toDetail(result.Item as AwaazCaseItem);
}

export async function listCases(options: {
  filters?: AwaazCaseFilters;
  limit?: number;
  nextToken?: string;
}): Promise<ListAwaazCasesResponse> {
  const { filters = {}, limit = 50, nextToken } = options;

  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (nextToken) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf-8'));
    } catch {
      exclusiveStartKey = undefined;
    }
  }

  const filterParts: string[] = [];
  const expressionValues: Record<string, unknown> = { ':gsi1pk': buildAwaazGSI1PK() };
  const expressionNames: Record<string, string> = {};

  if (filters.provinceCode) {
    filterParts.push('#pc = :pc');
    expressionNames['#pc'] = 'provinceCode';
    expressionValues[':pc'] = filters.provinceCode;
  }
  if (filters.districtCode) {
    filterParts.push('#dc = :dc');
    expressionNames['#dc'] = 'districtCode';
    expressionValues[':dc'] = filters.districtCode;
  }
  if (filters.channelType) {
    filterParts.push('#ct = :ct');
    expressionNames['#ct'] = 'channelType';
    expressionValues[':ct'] = filters.channelType;
  }
  if (filters.referralStatus) {
    filterParts.push('#rs = :rs');
    expressionNames['#rs'] = 'referralStatus';
    expressionValues[':rs'] = filters.referralStatus;
  }
  if (filters.region) {
    filterParts.push('#rg = :rg');
    expressionNames['#rg'] = 'region';
    expressionValues[':rg'] = filters.region;
  }
  if (filters.callerType) {
    filterParts.push('#clt = :clt');
    expressionNames['#clt'] = 'callerType';
    expressionValues[':clt'] = filters.callerType;
  }
  if (filters.gender) {
    filterParts.push('#gn = :gn');
    expressionNames['#gn'] = 'gender';
    expressionValues[':gn'] = filters.gender;
  }
  if (filters.issue) {
    filterParts.push('#iss = :iss');
    expressionNames['#iss'] = 'issue';
    expressionValues[':iss'] = filters.issue;
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
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: exclusiveStartKey as Record<string, unknown> | undefined,
    }),
  );

  const items = (result.Items ?? []) as AwaazCaseItem[];

  return {
    items: items.map(toSummary),
    nextToken: result.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
      : undefined,
  };
}

export async function getDistinctValues(field: keyof AwaazCaseSummary): Promise<string[]> {
  const result = await docClient.send(
    new DocQueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: { ':gsi1pk': buildAwaazGSI1PK() },
      ProjectionExpression: field,
    }),
  );
  const values = (result.Items ?? []).map((i) => i[field] as string).filter(Boolean);
  return [...new Set(values)].sort();
}

export async function deleteCasesBySource(source: AwaazCaseSource): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  let deletedCount = 0;
  const errors: string[] = [];

  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new DocQueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :gsi1pk',
        FilterExpression: '#src = :src',
        ExpressionAttributeNames: { '#src': 'source' },
        ExpressionAttributeValues: {
          ':gsi1pk': buildAwaazGSI1PK(),
          ':src': source,
        },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const items = result.Items ?? [];
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;

    for (const batch of chunk(items, 25)) {
      try {
        await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [TABLE_NAME]: batch.map((item) => ({
                DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
              })),
            },
          }),
        );
        deletedCount += batch.length;
      } catch (err) {
        errors.push(`Batch delete failed: ${String(err)}`);
      }
    }
  } while (exclusiveStartKey);

  return { deletedCount, errors };
}
