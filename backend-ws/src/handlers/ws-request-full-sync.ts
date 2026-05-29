import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
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
    type: 'fullSync';
  };
}

async function getAllFeaturesForMap(mapId: string): Promise<MapFeature[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: MAP_DATA_TABLE,
      KeyConditionExpression: 'mapId = :mapId',
      ExpressionAttributeValues: {
        ':mapId': mapId,
      },
    })
  );

  return (result.Items || []).map((item) => JSON.parse(item.feature));
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

  const { mapId, userId } = message;

  if (!mapId) {
    return {
      statusCode: 400,
      body: 'Missing mapId',
    };
  }

  try {
    const features = await getAllFeaturesForMap(mapId);

    const responseMessage = JSON.stringify({
      action: 'syncMapData',
      mapId,
      userId: 'system',
      timestamp: new Date().toISOString(),
      payload: {
        type: 'fullSync',
        fullData: {
          mapId,
          features: {
            type: 'FeatureCollection',
            features,
          },
          lastUpdated: new Date().toISOString(),
        },
      },
    });

    await apigw.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(responseMessage),
      })
    );

    console.log(`Sent full sync with ${features.length} features to connection ${connectionId}`);

    return {
      statusCode: 200,
      body: 'Full sync sent',
    };
  } catch (error) {
    console.error('Error sending full sync:', error);
    return {
      statusCode: 500,
      body: 'Failed to send full sync',
    };
  }
};
