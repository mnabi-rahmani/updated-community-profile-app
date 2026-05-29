import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE!;

export type MapboxSyncJobType = 'single' | 'all';
export type MapboxSyncJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface MapboxSyncJobRecord {
  jobId: string;
  jobType: MapboxSyncJobType;
  status: MapboxSyncJobStatus;
  mapId?: string;
  publish: boolean;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export function createJobId(): string {
  return crypto.randomUUID();
}

export async function createMapboxSyncJob(params: {
  jobId: string;
  jobType: MapboxSyncJobType;
  mapId?: string;
  publish: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `JOB#${params.jobId}`,
        SK: 'META',
        jobId: params.jobId,
        jobType: params.jobType,
        status: 'pending',
        ...(params.mapId && { mapId: params.mapId }),
        publish: params.publish,
        createdAt: now,
        updatedAt: now,
      },
    })
  );
}

export async function getMapboxSyncJob(jobId: string): Promise<MapboxSyncJobRecord | null> {
  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `JOB#${jobId}`, SK: 'META' },
    })
  );
  if (!res.Item) return null;
  const item = res.Item;
  return {
    jobId: item.jobId as string,
    jobType: item.jobType as MapboxSyncJobType,
    status: item.status as MapboxSyncJobStatus,
    mapId: item.mapId as string | undefined,
    publish: Boolean(item.publish),
    result: item.result as Record<string, unknown> | undefined,
    error: item.error as string | undefined,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  };
}

export async function updateMapboxSyncJobStatus(
  jobId: string,
  status: MapboxSyncJobStatus,
  options?: { result?: Record<string, unknown>; error?: string }
): Promise<void> {
  const now = new Date().toISOString();
  const updates: string[] = ['#status = :status', 'updatedAt = :now'];
  const names: Record<string, string> = { '#status': 'status' };
  const values: Record<string, unknown> = { ':status': status, ':now': now };
  if (options?.result !== undefined) {
    updates.push('result = :result');
    values[':result'] = options.result;
  }
  if (options?.error !== undefined) {
    updates.push('#error = :error');
    names['#error'] = 'error';
    values[':error'] = options.error;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `JOB#${jobId}`, SK: 'META' },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
    })
  );
}
