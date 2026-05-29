import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withAuth, type AuthenticatedEvent } from '../auth/middleware';

const BUCKET = process.env.CLUSTER_PICS_BUCKET || 'community-profile-app-cluster-pics';
const PREFIX = process.env.CLUSTER_PICS_PREFIX || 'cluster-pics';
const PREVIEW_PREFIX = process.env.CLUSTER_PICS_PREVIEW_PREFIX || 'cluster-pics-previews';
const EXPIRES_IN = 3600; // 1 hour

const s3 = new S3Client({});

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function toPreviewName(filename: string): string {
  // Replace extension with .webp (or append if none)
  const trimmed = filename.trim();
  const replaced = trimmed.replace(/\.[a-z0-9]+$/i, '');
  return `${replaced}.webp`;
}

async function signedUrlHandler(event: AuthenticatedEvent): Promise<APIGatewayProxyResultV2> {
  const filename = event.queryStringParameters?.filename;
  const variantRaw = event.queryStringParameters?.variant;
  const variant = variantRaw === 'preview' ? 'preview' : 'original';

  if (!filename || typeof filename !== 'string') {
    return json(400, { error: 'Query parameter "filename" is required' });
  }

  // Avoid path traversal: only allow safe filename
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return json(400, { error: 'Invalid filename' });
  }

  const originalKey = `${PREFIX}/${filename}`;
  const previewKey = `${PREVIEW_PREFIX}/${toPreviewName(filename)}`;
  let key = variant === 'preview' ? previewKey : originalKey;

  try {
    if (variant === 'preview') {
      // If preview object exists, use it; otherwise fall back to original.
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: previewKey }));
      } catch {
        key = originalKey;
      }
    }

    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: EXPIRES_IN });

    return json(200, { url });
  } catch (err) {
    console.error('Error generating signed URL:', err);
    return json(500, { error: 'Failed to generate signed URL' });
  }
}

export const handler = withAuth(signedUrlHandler, { requiredModule: 'clusters_map' });
