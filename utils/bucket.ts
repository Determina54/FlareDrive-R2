export function notFound() {
  return new Response("Not found", { 
    status: 404,
    headers: withCorsHeaders()
  });
}

export function withCorsHeaders(headers?: HeadersInit): HeadersInit {
  const baseHeaders = new Headers(headers);
  baseHeaders.set("Access-Control-Allow-Origin", "*");
  baseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
  baseHeaders.set("Access-Control-Allow-Headers", "*");
  return baseHeaders;
}

export function jsonResponse(data: any, status: number = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers || {});
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), {
    status,
    headers: withCorsHeaders(responseHeaders)
  });
}

export function getStorageConfig(context) {
  const { env } = context;
  const isCustomS3 = env.CustomS3 === "true";
  
  if (isCustomS3) {
    return {
      isCustomS3: true,
      endpoint: env.S3_ENDPOINT,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      bucketName: env.S3_BUCKET_NAME,
    };
  }
  
  return {
    isCustomS3: false,
    accountId: env.CF_ACCOUNT_ID,
    accessKey: env.AWS_ACCESS_KEY_ID,
    secretKey: env.AWS_SECRET_ACCESS_KEY,
  };
}

export function parseBucketPath(context): [any, string] {
  const { request, env, params } = context;
  const url = new URL(request.url);

  const pathSegments = (params.path || []) as String[];
  const path = decodeURIComponent(pathSegments.join("/"));
  const driveid = url.hostname.replace(/\..*/, "");

  return [env[driveid] || env["BUCKET"], path];
}
