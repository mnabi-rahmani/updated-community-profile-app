import { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { getAllProvinces, getDistrictsByProvince } from '../data';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE!;
const GSI1_NAME = 'GSI1';

interface ClusterWithLocation {
  clusterName: string;
  provinceCode: string;
  provinceName: string;
  districtCode: string;
  districtName: string;
}

export const handler: APIGatewayProxyHandler = async () => {
  try {
    const provinces = getAllProvinces();
    const provinceMap = new Map(provinces.map((p) => [p.code, p.name]));
    
    const districtMap = new Map<string, string>();
    for (const province of provinces) {
      const districts = getDistrictsByProvince(province.code);
      for (const district of districts) {
        districtMap.set(district.code, district.name);
      }
    }

    const clustersWithLocation: ClusterWithLocation[] = [];
    const seenClusters = new Set<string>();

    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const params: QueryCommandInput = {
        TableName: TABLE_NAME,
        IndexName: GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'ALL_SUBMISSIONS',
        },
        ProjectionExpression: 'clusterName, provinceCode, districtCode',
      };

      if (lastEvaluatedKey) {
        params.ExclusiveStartKey = lastEvaluatedKey;
      }

      const result = await ddb.send(new QueryCommand(params));
      const items = result.Items || [];

      for (const item of items) {
        const clusterName = item.clusterName as string;
        const provinceCode = item.provinceCode as string;
        const districtCode = item.districtCode as string;

        if (!clusterName || !provinceCode) {
          continue;
        }

        const key = `${clusterName}|${provinceCode}|${districtCode || ''}`;
        if (seenClusters.has(key)) {
          continue;
        }
        seenClusters.add(key);

        const provinceName = provinceMap.get(provinceCode) || provinceCode;
        const districtName = districtMap.get(districtCode) || districtCode || '';

        clustersWithLocation.push({
          clusterName,
          provinceCode,
          provinceName,
          districtCode: districtCode || '',
          districtName,
        });
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    clustersWithLocation.sort((a, b) => {
      const provCompare = a.provinceName.localeCompare(b.provinceName);
      if (provCompare !== 0) return provCompare;
      const distCompare = a.districtName.localeCompare(b.districtName);
      if (distCompare !== 0) return distCompare;
      return a.clusterName.localeCompare(b.clusterName);
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(clustersWithLocation),
    };
  } catch (error) {
    console.error('Error fetching clusters lookup:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to fetch clusters' }),
    };
  }
};
