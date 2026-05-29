import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';
import { getMapboxSyncJob } from '../mapbox-sync-job';

async function getMapboxSyncJobStatus(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  const jobId = event.pathParameters?.jobId;
  if (!jobId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'jobId is required' }),
    };
  }

  const job = await getMapboxSyncJob(jobId);
  if (!job) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Job not found', jobId }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({
      jobId: job.jobId,
      jobType: job.jobType,
      status: job.status,
      mapId: job.mapId,
      publish: job.publish,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }),
  };
}

export const handler = withAuth(getMapboxSyncJobStatus, { requiredModule: 'clusters_map' });
