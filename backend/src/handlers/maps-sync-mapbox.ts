import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';
import {
  createJobId,
  createMapboxSyncJob,
  updateMapboxSyncJobStatus,
  getMapboxSyncJob,
} from '../mapbox-sync-job';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const lambda = new LambdaClient({});
const TABLE_NAME = process.env.DYNAMODB_TABLE!;
const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME!;

const MAPBOX_BASE = 'https://api.mapbox.com';

interface MapboxDataset {
  id: string;
  name?: string;
  description?: string;
  features?: number;
}

interface MapFeature {
  type: 'Feature';
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

/** Async invocation payload – not from API Gateway */
export interface AsyncSyncMapEvent {
  async: true;
  jobId: string;
  type: 'single';
  mapId: string;
  publish: boolean;
}

function mapboxFetch(
  username: string,
  token: string,
  path: string,
  options: { method?: string; body?: string } = {}
): Promise<Response> {
  const url = `${MAPBOX_BASE}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  return fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body,
  });
}

async function listAllDatasetFeatures(
  username: string,
  token: string,
  datasetId: string
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  let start: string | undefined;
  do {
    const path = `/datasets/v1/${encodeURIComponent(username)}/${encodeURIComponent(datasetId)}/features?limit=1000${start ? `&start=${encodeURIComponent(start)}` : ''}`;
    const res = await mapboxFetch(username, token, path);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Mapbox list features failed: ${res.status} ${text}`);
    }
    const fc = (await res.json()) as { features?: MapFeature[] };
    const features = fc.features || [];
    for (const f of features) {
      const id = f.id ?? (f.properties?.id as string);
      if (id != null) ids.set(String(id), String(id));
    }
    const link = res.headers.get('Link');
    start = undefined;
    if (link) {
      const nextMatch = /<[^>]*[?&]start=([^>&]+)[^>]*>;\s*rel="next"/i.exec(link);
      if (nextMatch) start = decodeURIComponent(nextMatch[1]);
    }
    if (features.length < 1000) break;
    if (features.length > 0 && !start) {
      const lastId = features[features.length - 1].id ?? (features[features.length - 1].properties?.id as string);
      if (lastId != null) start = String(lastId);
    }
  } while (start);
  return ids;
}

/** Runs sync for one map; returns result or throws. */
async function runSyncOneMap(
  mapId: string,
  publishTileset: boolean
): Promise<{ datasetId: string; featuresSynced: number; tilesetId?: string; error?: string; detail?: string }> {
  const token = process.env.MAPBOX_SECRET_TOKEN!;
  const username = process.env.MAPBOX_USERNAME!;

  const getResult = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `MAP#${mapId}`, SK: 'METADATA' },
    })
  );

  if (!getResult.Item) {
    throw new Error('Map not found');
  }

  const item = getResult.Item;
  const name = (item.name as string) || 'Unnamed map';
  const description = (item.description as string) || '';
  const features = (item.features as MapFeature[]) || [];
  let datasetId = item.mapboxDatasetId as string | undefined;

  if (!datasetId) {
    const createRes = await mapboxFetch(username, token, `/datasets/v1/${encodeURIComponent(username)}`, {
      method: 'POST',
      body: JSON.stringify({ name: name.slice(0, 256), description: description.slice(0, 500) }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Failed to create Mapbox dataset: ${text}`);
    }
    const dataset = (await createRes.json()) as MapboxDataset;
    datasetId = dataset.id;

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `MAP#${mapId}`, SK: 'METADATA' },
        UpdateExpression: 'SET mapboxDatasetId = :id, updatedAt = :now, GSI1SK = :now',
        ExpressionAttributeValues: { ':id': datasetId, ':now': new Date().toISOString() },
      })
    );
  }

  const existingIds = await listAllDatasetFeatures(username, token, datasetId);
  const appIds = new Set<string>();

  for (const f of features) {
    const id = (f.properties?.id as string) ?? (f as MapFeature).id;
    if (!id) continue;
    const sid = String(id);
    appIds.add(sid);

    const featureBody: MapFeature = {
      type: 'Feature',
      id: sid,
      geometry: f.geometry,
      properties: { ...f.properties, id: sid },
    };

    const putRes = await mapboxFetch(
      username,
      token,
      `/datasets/v1/${encodeURIComponent(username)}/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(sid)}`,
      { method: 'PUT', body: JSON.stringify(featureBody) }
    );
    if (!putRes.ok) {
      const text = await putRes.text();
      throw new Error(`Failed to sync feature to Mapbox: ${text}`);
    }
  }

  for (const mid of existingIds.keys()) {
    if (appIds.has(mid)) continue;
    const delRes = await mapboxFetch(
      username,
      token,
      `/datasets/v1/${encodeURIComponent(username)}/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(mid)}`,
      { method: 'DELETE' }
    );
    if (!delRes.ok && delRes.status !== 404) {
      const text = await delRes.text();
      console.error('Mapbox delete feature failed:', mid, text);
    }
  }

  let tilesetId: string | undefined;
  if (publishTileset) {
    const safeTilesetName = `cluster-${mapId.replace(/-/g, '').slice(0, 22)}`;
    const tilesetFullId = `${username}.${safeTilesetName}`;

    const uploadRes = await mapboxFetch(username, token, `/uploads/v1/${encodeURIComponent(username)}`, {
      method: 'POST',
      body: JSON.stringify({
        url: `mapbox://datasets/${username}/${datasetId}`,
        tileset: tilesetFullId,
        name: name.slice(0, 64),
      }),
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return {
        datasetId,
        featuresSynced: features.length,
        error: 'Dataset synced; publishing to tileset failed',
        detail: text,
      };
    }
    const upload = (await uploadRes.json()) as { id: string; complete?: boolean; error?: string };
    let complete = upload.complete;
    let attempts = 0;
    while (!complete && attempts < 60) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await mapboxFetch(
        username,
        token,
        `/uploads/v1/${encodeURIComponent(username)}/${encodeURIComponent(upload.id)}`
      );
      const status = (await statusRes.json()) as { complete?: boolean; error?: string };
      complete = status.complete;
      if (status.error) {
        return {
          datasetId,
          featuresSynced: features.length,
          tilesetId: tilesetFullId,
          error: 'Tileset publish failed',
          detail: status.error,
        };
      }
      attempts++;
    }
    tilesetId = tilesetFullId;
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `MAP#${mapId}`, SK: 'METADATA' },
        UpdateExpression: 'SET mapboxTilesetId = :tid, updatedAt = :now, GSI1SK = :now',
        ExpressionAttributeValues: { ':tid': tilesetId, ':now': new Date().toISOString() },
      })
    );
  }

  return {
    datasetId,
    featuresSynced: features.length,
    ...(tilesetId && { tilesetId }),
  };
}

async function runAsyncSyncMap(event: AsyncSyncMapEvent): Promise<void> {
  const { jobId, mapId, publish } = event;
  await updateMapboxSyncJobStatus(jobId, 'running');
  try {
    const result = await runSyncOneMap(mapId, publish);
    await updateMapboxSyncJobStatus(jobId, 'completed', {
      result: result as unknown as Record<string, unknown>,
      ...(result.error && { error: result.detail || result.error }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('maps-sync-mapbox async job failed:', err);
    await updateMapboxSyncJobStatus(jobId, 'failed', { error: message });
  }
}

async function httpSyncMap(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const mapId = event.pathParameters?.mapId;
    if (!mapId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'mapId is required' }),
      };
    }

    const token = process.env.MAPBOX_SECRET_TOKEN;
    const username = process.env.MAPBOX_USERNAME;
    if (!token || !username) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Mapbox sync not configured. Set MAPBOX_SECRET_TOKEN and MAPBOX_USERNAME (Mapbox account username).',
        }),
      };
    }

    const publishTileset = event.queryStringParameters?.publish === '1';
    const jobId = createJobId();
    await createMapboxSyncJob({ jobId, jobType: 'single', mapId, publish: publishTileset });

    await lambda.send(
      new InvokeCommand({
        FunctionName: FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: JSON.stringify({
          async: true,
          jobId,
          type: 'single',
          mapId,
          publish: publishTileset,
        } as AsyncSyncMapEvent),
      })
    );

    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ jobId, message: 'Sync started. Poll /maps/sync-mapbox/status/{jobId} for status.' }),
    };
  } catch (error: unknown) {
    console.error('maps-sync-mapbox failed:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        error: 'Internal Server Error',
        detail: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

export async function handler(
  event: AuthenticatedEvent | AsyncSyncMapEvent
): Promise<APIGatewayProxyResultV2 | void> {
  if (
    typeof event === 'object' &&
    event !== null &&
    (event as AsyncSyncMapEvent).async === true &&
    (event as AsyncSyncMapEvent).jobId &&
    (event as AsyncSyncMapEvent).type === 'single'
  ) {
    await runAsyncSyncMap(event as AsyncSyncMapEvent);
    return;
  }
  return withAuth(httpSyncMap, { requiredModule: 'clusters_map' })(event as AuthenticatedEvent);
}
