import { S3Client } from "@/utils/s3";
import { getStorageConfig } from "@/utils/bucket";

export async function onRequest(context) {
  const { request, env } = context;

  const storageConfig = getStorageConfig(context);
  
  const accessKey = storageConfig.isCustomS3 ? storageConfig.accessKey : env.AWS_ACCESS_KEY_ID;
  const secretKey = storageConfig.isCustomS3 ? storageConfig.secretKey : env.AWS_SECRET_ACCESS_KEY;
  const endpoint = storageConfig.isCustomS3 ? storageConfig.endpoint : `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const client = new S3Client(accessKey, secretKey);
  const forwardUrl = request.url.replace(
    /.*\/api\/write\/s3\//,
    `${endpoint}/`
  );

  return client.s3_fetch(forwardUrl, {
    method: request.method,
    body: request.body,
    headers: request.headers,
  });
}
