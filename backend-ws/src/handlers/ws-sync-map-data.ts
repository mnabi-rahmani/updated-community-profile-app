import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;
const MAP_DATA_TABLE = process.env.MAP_DATA_TABLE!;

interface MapFeature {
  id: string;
  type: 'Feature';
  geometry: unknown;
  properties: {
    id: string;
    name: string;
    zoneType: string;
    description?: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
  };
}

interface WebSocketMessage {
  action: string;
  mapId: string;
  userId: string;
  timestamp: string;
  payload: {
    type: 'create' | 'update' | 'delete' | 'fullSync';
    features?: MapFeature[];
    featureIds?: string[];
  };
}

async function getConnectionsForMap(mapId: string): Promise<Array<{ connectionId: string; userId: string }>> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: CONNECTIONS_TABLE,
      IndexName: 'MapIdIndex',
      KeyConditionExpression: 'mapId = :mapId',
      ExpressionAttributeValues: {
        ':mapId': mapId,
      },
    })
  );

  return (result.Items || []).map((item) => ({
    connectionId: item.connectionId,
    userId: item.userId,
  }));
}

async function saveFeature(mapId: string, feature: MapFeature): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: MAP_DATA_TABLE,
      Item: {
        mapId,
        featureId: feature.properties.id,
        feature: JSON.stringify(feature),
        updatedAt: new Date().toISOString(),
      },
    })
  );
}

async function deleteFeature(mapId: string, featureId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: MAP_DATA_TABLE,
      Key: {
        mapId,
        featureId,
      },
    })
  );
}

async function removeStaleConnection(connectionId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: {
        connectionId,
      },
    })
  );
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const domainName = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const endpoint = `https://${domainName}/${stage}`;

  const apigw = new ApiGatewayManagementApiClient({ endpoint });

  let message: WebSocketMessage;
  try {
    message = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      body: 'Invalid JSON',
    };
  }

  const { mapId, userId, payload } = message;

  if (!mapId || !payload) {
    return {
      statusCode: 400,
      body: 'Missing mapId or payload',
    };
  }

  try {
    if (payload.type === 'create' || payload.type === 'update') {
      if (payload.features) {
        await Promise.all(
          payload.features.map((feature) => saveFeature(mapId, feature))
        );
      }
    } else if (payload.type === 'delete') {
      if (payload.featureIds) {
        await Promise.all(
          payload.featureIds.map((featureId) => deleteFeature(mapId, featureId))
        );
      }
    }

    const connections = await getConnectionsForMap(mapId);

    const broadcastMessage = JSON.stringify({
      action: 'syncMapData',
      mapId,
      userId,
      timestamp: new Date().toISOString(),
      payload,
    });

    const sendPromises = connections
      .filter((conn) => conn.connectionId !== connectionId)
      .map(async (conn) => {
        try {
          await apigw.send(
            new PostToConnectionCommand({
              ConnectionId: conn.connectionId,
              Data: Buffer.from(broadcastMessage),
            })
          );
        } catch (error) {
          if (error instanceof GoneException) {
            console.log(`Removing stale connection: ${conn.connectionId}`);
            await removeStaleConnection(conn.connectionId);
          } else {
            console.error(`Error sending to ${conn.connectionId}:`, error);
          }
        }
      });

    await Promise.all(sendPromises);

    console.log(`Broadcast ${payload.type} to ${connections.length - 1} connections for map ${mapId}`);

    return {
      statusCode: 200,
      body: 'Data synced',
    };
  } catch (error) {
    console.error('Error syncing map data:', error);
    return {
      statusCode: 500,
      body: 'Failed to sync data',
    };
  }
};
