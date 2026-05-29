import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE!;

export const handler: APIGatewayProxyHandler = async (event) => {
  const mapId = event.pathParameters?.mapId;

  if (!mapId) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'mapId is required' }),
    };
  }

  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `MAP#${mapId}`,
          SK: 'METADATA',
        },
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Map not found' }),
      };
    }

    const map = {
      mapId: result.Item.mapId,
      name: result.Item.name,
      description: result.Item.description,
      cluster: result.Item.cluster || null,
      features: result.Item.features || [],
      createdAt: result.Item.createdAt,
      updatedAt: result.Item.updatedAt,
      ...(result.Item.mapboxDatasetId && { mapboxDatasetId: result.Item.mapboxDatasetId }),
      ...(result.Item.mapboxTilesetId && { mapboxTilesetId: result.Item.mapboxTilesetId }),
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(map),
    };
  } catch (error) {
    console.error('Error getting map:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to get map' }),
    };
  }
};
