import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const MAP_DATA_TABLE = process.env.MAP_DATA_TABLE!;

interface MapSummary {
  mapId: string;
  featureCount: number;
  lastUpdated: string;
  zoneTypes: string[];
}

interface StoredFeature {
  properties?: {
    zoneType?: string;
  };
}

export const handler: APIGatewayProxyHandlerV2 = async () => {
  try {
    const result = await ddb.send(
      new ScanCommand({
        TableName: MAP_DATA_TABLE,
        ProjectionExpression: 'mapId, featureId, updatedAt, feature',
      })
    );

    const items = result.Items || [];

    const mapSummaries = new Map<string, MapSummary>();

    for (const item of items) {
      const mapId = item.mapId as string;
      const updatedAt = (item.updatedAt as string) || '';
      
      let zoneType = 'unknown';
      if (item.feature) {
        try {
          const featureData: StoredFeature = JSON.parse(item.feature as string);
          zoneType = featureData.properties?.zoneType || 'unknown';
        } catch {
          // Ignore parse errors
        }
      }

      if (!mapSummaries.has(mapId)) {
        mapSummaries.set(mapId, {
          mapId,
          featureCount: 0,
          lastUpdated: updatedAt,
          zoneTypes: [],
        });
      }

      const summary = mapSummaries.get(mapId)!;
      summary.featureCount++;

      if (updatedAt && updatedAt > summary.lastUpdated) {
        summary.lastUpdated = updatedAt;
      }

      if (zoneType && zoneType !== 'unknown' && !summary.zoneTypes.includes(zoneType)) {
        summary.zoneTypes.push(zoneType);
      }
    }

    const maps = Array.from(mapSummaries.values()).sort((a, b) => 
      b.lastUpdated.localeCompare(a.lastUpdated)
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({
        success: true,
        data: {
          maps,
          total: maps.length,
        },
      }),
    };
  } catch (error) {
    console.error('Error listing maps:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to list maps',
      }),
    };
  }
};
