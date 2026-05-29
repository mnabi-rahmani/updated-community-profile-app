import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { name, description, features } = body;
  const now = new Date().toISOString();

  const updateExpressions: string[] = ['updatedAt = :updatedAt', 'GSI1SK = :updatedAt'];
  const expressionAttributeValues: Record<string, unknown> = {
    ':updatedAt': now,
  };

  if (name !== undefined) {
    updateExpressions.push('#name = :name');
    expressionAttributeValues[':name'] = name.trim();
  }

  if (description !== undefined) {
    updateExpressions.push('description = :description');
    expressionAttributeValues[':description'] = description?.trim() || null;
  }

  if (features !== undefined) {
    updateExpressions.push('features = :features');
    updateExpressions.push('featureCount = :featureCount');
    expressionAttributeValues[':features'] = features;
    expressionAttributeValues[':featureCount'] = features.length;
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `MAP#${mapId}`,
          SK: 'METADATA',
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: name !== undefined ? { '#name': 'name' } : undefined,
        ConditionExpression: 'attribute_exists(PK)',
      })
    );

    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `MAP#${mapId}`,
          SK: 'METADATA',
        },
      })
    );

    const map = {
      mapId: result.Item?.mapId,
      name: result.Item?.name,
      description: result.Item?.description,
      cluster: result.Item?.cluster || null,
      features: result.Item?.features || [],
      createdAt: result.Item?.createdAt,
      updatedAt: result.Item?.updatedAt,
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(map),
    };
  } catch (error: unknown) {
    console.error('Error updating map:', error);
    
    if ((error as { name?: string }).name === 'ConditionalCheckFailedException') {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Map not found' }),
      };
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to update map' }),
    };
  }
};
