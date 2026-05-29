import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  PutCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';
import {
  createJobId,
  createMapboxSyncJob,
  updateMapboxSyncJobStatus,
} from '../mapbox-sync-job';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const lambda = new LambdaClient({});
const TABLE_NAME = process.env.DYNAMODB_TABLE!;
const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME!;

const MAPBOX_BASE = 'https://api.mapbox.com';
const AGGREGATE_CONFIG_PK = 'CONFIG';
const AGGREGATE_CONFIG_SK = 'MAPBOX_AGGREGATE';
const AGGREGATE_TILESET_NAME = 'community-profile-clusters';

interface MapboxDataset {
  id: string;
  name?: string;
  description?: string;
}

interface MapFeature {
  type: 'Feature';
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

/** Async invocation payload – not from API Gateway */
export interface AsyncSyncAllEvent {
  async: true;
  jobId: string;
  type: 'all';
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

async function listAllDatasetFeatureIds(
  username: string,
  token: string,
  datasetId: string
): Promise<Set<string>> {
  const ids = new Set<string>();
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
      if (id != null) ids.add(String(id));
    }
    const link = res.headers.get('Link');
    start = undefined;
    if (link) {
      const nextMatch = /<[^>]*[?&]start=([^>&]+)[^>]*>;\s*rel="next"/i.exec(link);
      if (nextMatch) start = decodeURIComponent(nextMatch[1]);
    }
    if (features.length < 1000) break;
    if (features.length > 0 && !start) {
      const last = features[features.length - 1];
      const lastId = last.id ?? (last.properties?.id as string);
      if (lastId != null) start = String(lastId);
    }
  } while (start);
  return ids;
}

function aggregateFeatureId(mapId: string, featureId: string): string {
  return `${mapId}__${featureId}`;
}

type SyncAllResult = {
  datasetId: string | null;
  mapsCount: number;
  featuresSynced: number;
  tilesetId?: string;
  error?: string;
  detail?: string;
  message?: string;
};

/** Runs sync for all maps; returns result (or partial on non-fatal errors). */
async function runSyncAllMaps(publishTileset: boolean): Promise<SyncAllResult> {
  const token = process.env.MAPBOX_SECRET_TOKEN!;
  const username = process.env.MAPBOX_USERNAME!;

  const queryResult = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'MAP' },
      ProjectionExpression: 'mapId',
      ScanIndexForward: false,
    })
  );

  const mapIds = (queryResult.Items || []).map((i) => i.mapId as string).filter(Boolean);
  if (mapIds.length === 0) {
    return {
      datasetId: null,
      mapsCount: 0,
      featuresSynced: 0,
      message: 'No maps to sync.',
    };
  }

  const BATCH_SIZE = 100;
  const allMaps: { mapId: string; name: string; cluster?: unknown; features: MapFeature[] }[] = [];
  for (let i = 0; i < mapIds.length; i += BATCH_SIZE) {
    const chunk = mapIds.slice(i, i + BATCH_SIZE);
    const batchResult = await ddb.send(
      new BatchGetCommand({
        RequestItems: {
          [TABLE_NAME]: {
            Keys: chunk.map((mapId) => ({ PK: `MAP#${mapId}`, SK: 'METADATA' })),
          },
        },
      })
    );
    const items = batchResult.Responses?.[TABLE_NAME] || [];
    for (const item of items) {
      const features = (item.features as MapFeature[]) || [];
      allMaps.push({
        mapId: item.mapId as string,
        name: (item.name as string) || 'Unnamed',
        cluster: item.cluster,
        features,
      });
    }
  }

  let datasetId: string;
  const configResult = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: AGGREGATE_CONFIG_PK, SK: AGGREGATE_CONFIG_SK },
    })
  );

  if (configResult.Item?.datasetId) {
    datasetId = configResult.Item.datasetId as string;
  } else {
    const createRes = await mapboxFetch(username, token, `/datasets/v1/${encodeURIComponent(username)}`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Community Profile – All cluster maps',
        description: 'All cluster map features synced from the app',
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Failed to create Mapbox dataset: ${text}`);
    }
    const dataset = (await createRes.json()) as MapboxDataset;
    datasetId = dataset.id;
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: AGGREGATE_CONFIG_PK,
          SK: AGGREGATE_CONFIG_SK,
          datasetId,
          updatedAt: new Date().toISOString(),
        },
      })
    );
  }

  const existingIds = await listAllDatasetFeatureIds(username, token, datasetId);
  const wantedIds = new Set<string>();
  let totalSynced = 0;

  for (const map of allMaps) {
    for (const f of map.features) {
      const fid = (f.properties?.id as string) ?? (f as MapFeature).id;
      if (!fid) continue;
      const compositeId = aggregateFeatureId(map.mapId, String(fid));
      wantedIds.add(compositeId);

      const featureBody: MapFeature = {
        type: 'Feature',
        id: compositeId,
        geometry: f.geometry,
        properties: {
          ...f.properties,
          id: compositeId,
          mapId: map.mapId,
          mapName: map.name,
          ...(map.cluster ? { cluster: map.cluster } : {}),
        },
      };

      const putRes = await mapboxFetch(
        username,
        token,
        `/datasets/v1/${encodeURIComponent(username)}/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(compositeId)}`,
        { method: 'PUT', body: JSON.stringify(featureBody) }
      );
      if (!putRes.ok) {
        const text = await putRes.text();
        throw new Error(`Failed to sync feature to Mapbox: ${text}`);
      }
      totalSynced++;
    }
  }

  for (const mid of existingIds) {
    if (wantedIds.has(mid)) continue;
    const delRes = await mapboxFetch(
      username,
      token,
      `/datasets/v1/${encodeURIComponent(username)}/${encodeURIComponent(datasetId)}/features/${encodeURIComponent(mid)}`,
      { method: 'DELETE' }
    );
    if (!delRes.ok && delRes.status !== 404) {
      console.error('Mapbox delete feature failed:', mid, await delRes.text());
    }
  }

  let tilesetId: string | undefined;
  if (publishTileset) {
    const tilesetFullId = `${username}.${AGGREGATE_TILESET_NAME}`;
    const uploadRes = await mapboxFetch(username, token, `/uploads/v1/${encodeURIComponent(username)}`, {
      method: 'POST',
      body: JSON.stringify({
        url: `mapbox://datasets/${username}/${datasetId}`,
        tileset: tilesetFullId,
        name: 'Community Profile – All cluster maps',
      }),
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      return {
        datasetId,
        mapsCount: allMaps.length,
        featuresSynced: totalSynced,
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
          mapsCount: allMaps.length,
          featuresSynced: totalSynced,
          tilesetId: tilesetFullId,
          error: 'Tileset publish failed',
          detail: status.error,
        };
      }
      attempts++;
    }
    tilesetId = tilesetFullId;
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: AGGREGATE_CONFIG_PK,
          SK: AGGREGATE_CONFIG_SK,
          datasetId,
          mapboxTilesetId: tilesetId,
          updatedAt: new Date().toISOString(),
        },
      })
    );
  }

  return {
    datasetId,
    mapsCount: allMaps.length,
    featuresSynced: totalSynced,
    ...(tilesetId && { tilesetId }),
  };
}

async function runAsyncSyncAll(event: AsyncSyncAllEvent): Promise<void> {
  const { jobId, publish } = event;
  await updateMapboxSyncJobStatus(jobId, 'running');
  try {
    const result = await runSyncAllMaps(publish);
    await updateMapboxSyncJobStatus(jobId, 'completed', {
      result: result as unknown as Record<string, unknown>,
      ...(result.error && { error: result.detail || result.error }),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('maps-sync-mapbox-all async job failed:', err);
    await updateMapboxSyncJobStatus(jobId, 'failed', { error: message });
  }
}

async function httpSyncAll(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const token = process.env.MAPBOX_SECRET_TOKEN;
    const username = process.env.MAPBOX_USERNAME;
    if (!token || !username) {
      return {
        statusCode: 503,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({
          error: 'Mapbox sync not configured. Set MAPBOX_SECRET_TOKEN and MAPBOX_USERNAME.',
        }),
      };
    }

    const publishTileset = event.queryStringParameters?.publish === '1';
    const jobId = createJobId();
    await createMapboxSyncJob({ jobId, jobType: 'all', publish: publishTileset });

    await lambda.send(
      new InvokeCommand({
        FunctionName: FUNCTION_NAME,
        InvocationType: 'Event',
        Payload: JSON.stringify({
          async: true,
          jobId,
          type: 'all',
          publish: publishTileset,
        } as AsyncSyncAllEvent),
      })
    );

    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ jobId, message: 'Sync started. Poll /maps/sync-mapbox/status/{jobId} for status.' }),
    };
  } catch (error: unknown) {
    console.error('maps-sync-mapbox-all failed:', error);
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
  event: AuthenticatedEvent | AsyncSyncAllEvent
): Promise<APIGatewayProxyResultV2 | void> {
  if (
    typeof event === 'object' &&
    event !== null &&
    (event as AsyncSyncAllEvent).async === true &&
    (event as AsyncSyncAllEvent).jobId &&
    (event as AsyncSyncAllEvent).type === 'all'
  ) {
    await runAsyncSyncAll(event as AsyncSyncAllEvent);
    return;
  }
  return withAuth(httpSyncAll, { requiredModule: 'clusters_map' })(event as AuthenticatedEvent);
}
