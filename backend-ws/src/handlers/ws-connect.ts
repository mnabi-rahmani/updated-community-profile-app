import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE!;

export const handler: APIGatewayProxyHandler = async (event) => {
  const connectionId = event.requestContext.connectionId!;
  const mapId = event.queryStringParameters?.mapId || 'default';
  const userId = event.queryStringParameters?.userId || 'anonymous';

  const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

  try {
    await ddb.send(
      new PutCommand({
        TableName: CONNECTIONS_TABLE,
        Item: {
          connectionId,
          mapId,
          userId,
          connectedAt: new Date().toISOString(),
          ttl,
        },
      })
    );

    console.log(`Connection ${connectionId} established for map ${mapId} by user ${userId}`);

    return {
      statusCode: 200,
      body: 'Connected',
    };
  } catch (error) {
    console.error('Error saving connection:', error);
    return {
      statusCode: 500,
      body: 'Failed to connect',
    };
  }
};
