import { S3Client } from "@/utils/s3";
import { getStorageConfig } from "@/utils/bucket";

export async function onRequest(context) {
  const { request, env, params } = context;

  const storageConfig = getStorageConfig(context);
  
  const accessKey = storageConfig.isCustomS3 ? storageConfig.accessKey : env.AWS_ACCESS_KEY_ID;
  const secretKey = storageConfig.isCustomS3 ? storageConfig.secretKey : env.AWS_SECRET_ACCESS_KEY;
  const endpoint = storageConfig.isCustomS3 ? storageConfig.endpoint : `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const client = new S3Client(accessKey, secretKey);
  
  let forwardUrl;
  if (storageConfig.isCustomS3) {
    // 第三方 S3: 需要包含 bucket 名称
    const path = (params.path || []).join('/');
    forwardUrl = `${endpoint}/${storageConfig.bucketName}/${path}`;
    console.log("[Write S3] CustomS3 forward URL:", forwardUrl);
  } else {
    // R2: 原有的转发逻辑
    forwardUrl = request.url.replace(
      /.*\/api\/write\/s3\//,
      `${endpoint}/`
    );
    console.log("[Write S3] R2 forward URL:", forwardUrl);
  }

  console.log("[Write S3] Request", { 
    method: request.method,
    url: forwardUrl,
    isCustomS3: storageConfig.isCustomS3
  });

  return client.s3_fetch(forwardUrl, {
    method: request.method,
    body: request.body,
    headers: request.headers,
  });
}
