import { notFound, parseBucketPath, getStorageConfig, withCorsHeaders } from "@/utils/bucket";
import { S3Client } from "@/utils/s3";

export async function onRequestGet(context) {
  const [bucket, path] = parseBucketPath(context);
  const storageConfig = getStorageConfig(context);
  
  console.log("[Raw] Request", { path, isCustomS3: storageConfig.isCustomS3 });
  
  if (!storageConfig.isCustomS3 && !bucket) return notFound();

  // 第三方 S3 直接下载
  if (storageConfig.isCustomS3) {
    if (!path) return notFound();
    
    console.log("[Raw] Using CustomS3", { 
      endpoint: storageConfig.endpoint,
      bucket: storageConfig.bucketName,
      path 
    });
    
    try {
      const client = new S3Client(storageConfig.accessKey, storageConfig.secretKey);
      const s3Url = `${storageConfig.endpoint}/${storageConfig.bucketName}/${path}`;
      
      console.log("[Raw] Fetching from S3:", s3Url);
      
      const response = await client.s3_fetch(s3Url);
      
      console.log("[Raw] S3 response status:", response.status);
      
      if (response.status !== 200) {
        return notFound();
      }
      
      const headers = new Headers(response.headers);
      if (path.startsWith("_$flaredrive$/thumbnails/")) {
        headers.set("Cache-Control", "max-age=31536000");
      }
      
      // 添加 CORS 头
      const corsHeaders = withCorsHeaders(headers);
      
      return new Response(response.body, {
        headers: corsHeaders,
        status: response.status,
        statusText: response.statusText
      });
    } catch (error) {
      console.error("[Raw] Error:", error);
      return notFound();
    }
  }

  // R2 使用 PUBURL 转发
  const url = context.env["PUBURL"] + "/" + context.request.url.split("/raw/")[1]

  var response = await fetch(new Request(url, {
    body: context.request.body,
    headers: context.request.headers,
    method: context.request.method,
    redirect: "follow",
  }))

  const headers = new Headers(response.headers);
  if (path.startsWith("_$flaredrive$/thumbnails/")) {
    headers.set("Cache-Control", "max-age=31536000");
  }

  return new Response(response.body, {
    headers: headers,
    status: response.status,
    statusText: response.statusText
  });
}