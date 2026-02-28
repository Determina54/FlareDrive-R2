import { notFound, parseBucketPath, getStorageConfig } from "@/utils/bucket";
import {get_auth_status} from "@/utils/auth";
import { S3Client } from "@/utils/s3";

async function handleCustomS3Request(context, method) {
  const { request, env, params } = context;
  const storageConfig = getStorageConfig(context);
  
  console.log("[Items S3] Handling", { method, params });
  
  // 构建 S3 URL
  const path = (params.path || []).join('/');
  const url = new URL(request.url);
  const queryString = url.search;
  
  const accessKey = storageConfig.accessKey;
  const secretKey = storageConfig.secretKey;
  const endpoint = storageConfig.endpoint;
  const bucketName = storageConfig.bucketName;
  
  const s3Url = `${endpoint}/${bucketName}/${path}${queryString}`;
  
  console.log("[Items S3] S3 URL:", s3Url);
  console.log("[Items S3] Method:", method);
  
  const client = new S3Client(accessKey, secretKey);
  
  try {
    return await client.s3_fetch(s3Url, {
      method: method,
      body: request.body,
      headers: request.headers,
    });
  } catch (error) {
    console.error("[Items S3] Error:", error);
    return new Response(error.toString(), { status: 500 });
  }
}

export async function onRequestPostCreateMultipart(context) {
  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  const request: Request = context.request;

  const customMetadata: Record<string, string> = {};
  if (request.headers.has("fd-thumbnail"))
    customMetadata.thumbnail = request.headers.get("fd-thumbnail");

  const multipartUpload = await bucket.createMultipartUpload(path, {
    httpMetadata: {
      contentType: request.headers.get("content-type"),
    },
    customMetadata,
  });

  return new Response(
    JSON.stringify({
      key: multipartUpload.key,
      uploadId: multipartUpload.uploadId,
    })
  );
}

export async function onRequestPostCompleteMultipart(context) {
  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  const request: Request = context.request;
  const url = new URL(request.url);
  const uploadId = new URLSearchParams(url.search).get("uploadId");
  const multipartUpload = await bucket.resumeMultipartUpload(path, uploadId);

  const completeBody: { parts: Array<any> } = await request.json();

  try {
    const object = await multipartUpload.complete(completeBody.parts);
    return new Response(null, {
      headers: { etag: object.httpEtag },
    });
  } catch (error: any) {
    return new Response(error.message, { status: 400 });
  }
}

export async function onRequestPost(context) {
  const storageConfig = getStorageConfig(context);
  
  // 如果使用第三方 S3，转发处理
  if (storageConfig.isCustomS3) {
    return handleCustomS3Request(context, "POST");
  }

  const url = new URL(context.request.url);
  const searchParams = new URLSearchParams(url.search);

  if (searchParams.has("uploads")) {
    return onRequestPostCreateMultipart(context);
  }

  if (searchParams.has("uploadId")) {
    return onRequestPostCompleteMultipart(context);
  }

  return new Response("Method not allowed", { status: 405 });
}

export async function onRequestPutMultipart(context) {
  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  const request: Request = context.request;
  const url = new URL(request.url);

  const uploadId = new URLSearchParams(url.search).get("uploadId");
  const multipartUpload = await bucket.resumeMultipartUpload(path, uploadId);

  const partNumber = parseInt(
    new URLSearchParams(url.search).get("partNumber")
  );
  const uploadedPart = await multipartUpload.uploadPart(
    partNumber,
    request.body
  );

  return new Response(null, {
    headers: {
      "Content-Type": "application/json",
      etag: uploadedPart.etag,
    },
  });
}

export async function onRequestPut(context) {
  const storageConfig = getStorageConfig(context);
  
  // 如果使用第三方 S3，转发处理
  if (storageConfig.isCustomS3) {
    return handleCustomS3Request(context, "PUT");
  }

  if(!get_auth_status(context)){
    var header = new Headers()
    header.set("WWW-Authenticate",'Basic realm="需要登录"')
    return new Response("没有操作权限", {
        status: 401,
        headers: header,
    });
   }
  const url = new URL(context.request.url);

  if (new URLSearchParams(url.search).has("uploadId")) {
    return onRequestPutMultipart(context);
  }

  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  const request: Request = context.request;

  let content = request.body;
  const customMetadata: Record<string, string> = {};

  if (request.headers.has("x-amz-copy-source")) {
    const sourceName = decodeURIComponent(
      request.headers.get("x-amz-copy-source")
    );
    const source = await bucket.get(sourceName);
    content = source.body;
    if (source.customMetadata.thumbnail)
      customMetadata.thumbnail = source.customMetadata.thumbnail;
  }

  if (request.headers.has("fd-thumbnail"))
    customMetadata.thumbnail = request.headers.get("fd-thumbnail");

  const obj = await bucket.put(path, content, { customMetadata });
  const { key, size, uploaded } = obj;
  return new Response(JSON.stringify({ key, size, uploaded }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestHead(context) {
  const storageConfig = getStorageConfig(context);
  
  // 如果使用第三方 S3，转发处理
  if (storageConfig.isCustomS3) {
    return handleCustomS3Request(context, "HEAD");
  }

  // HEAD请求用于检查写入权限，不实际执行操作
  if(!get_auth_status(context)){
    // 不设置WWW-Authenticate头，避免弹出浏览器登录框
    return new Response("没有操作权限", {
        status: 403, // 使用403而不是401，避免触发浏览器认证
        headers: {
          "Content-Type": "text/plain"
        },
    });
   }

  // 如果有权限，返回200状态码
  return new Response(null, { status: 200 });
}

export async function onRequestDelete(context) {
  const storageConfig = getStorageConfig(context);
  
  // 如果使用第三方 S3，转发处理
  if (storageConfig.isCustomS3) {
    return handleCustomS3Request(context, "DELETE");
  }

  if(!get_auth_status(context)){
    var header = new Headers()
    header.set("WWW-Authenticate",'Basic realm="需要登录"')
    return new Response("没有操作权限", {
        status: 401,
        headers: header,
    });
   }
  const [bucket, path] = parseBucketPath(context);
  if (!bucket) return notFound();

  await bucket.delete(path);
  return new Response(null, { status: 204 });
}
