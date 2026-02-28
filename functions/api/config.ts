import { S3Client } from "@/utils/s3";
import { getStorageConfig } from "@/utils/bucket";

export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  
  // 如果有诊断请求
  if (url.searchParams.has("diagnose")) {
    return diagnoseStorage(context);
  }
  
  // 返回前端需要的环境变量配置
  const config = {
    QRCODE_API: env.QRCODE_API || ''
  };
  
  return new Response(JSON.stringify(config), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300' // 缓存5分钟
    }
  });
}

async function diagnoseStorage(context) {
  const storageConfig = getStorageConfig(context);
  
  return new Response(JSON.stringify({
    storageType: storageConfig.isCustomS3 ? "CustomS3" : "CloudflareR2",
    config: storageConfig.isCustomS3 ? {
      endpoint: storageConfig.endpoint,
      bucketName: storageConfig.bucketName,
      accessKey: storageConfig.accessKey ? "✓ set" : "✗ not set",
      secretKey: storageConfig.secretKey ? "✓ set" : "✗ not set",
    } : {
      accountId: context.env.CF_ACCOUNT_ID ? "✓ set" : "✗ not set",
      accessKey: context.env.AWS_ACCESS_KEY_ID ? "✓ set" : "✗ not set",
      secretKey: context.env.AWS_SECRET_ACCESS_KEY ? "✓ set" : "✗ not set",
    }
  }), {
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const url = new URL(context.request.url);
  
  if (url.searchParams.has("test-s3")) {
    return testS3Connection(context);
  }
  
  if (url.searchParams.has("raw-s3")) {
    return rawS3Request(context);
  }
  
  return new Response("Not found", { status: 404 });
}

async function rawS3Request(context) {
  const storageConfig = getStorageConfig(context);
  
  if (!storageConfig.isCustomS3) {
    return new Response(JSON.stringify({
      status: "error",
      message: "Not using custom S3"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { endpoint, bucketName, accessKey, secretKey } = storageConfig;
  
  if (!endpoint || !bucketName || !accessKey || !secretKey) {
    return new Response(JSON.stringify({
      status: "error",
      message: "Missing S3 configuration"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    console.log("[S3 Raw] Making raw S3 request", { endpoint, bucketName });
    
    const client = new S3Client(accessKey, secretKey);
    const url = `${endpoint}/${bucketName}/?delimiter=/`;
    
    console.log("[S3 Raw] URL:", url);
    
    const response = await client.s3_fetch(url);
    const text = await response.text();
    
    console.log("[S3 Raw] Response status:", response.status);
    console.log("[S3 Raw] Response headers:", Object.fromEntries(response.headers));
    console.log("[S3 Raw] Response body (first 2000 chars):", text.substring(0, 2000));
    
    return new Response(JSON.stringify({
      status: "success",
      request: {
        url: url,
        method: "GET"
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        body: text,
      }
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    console.error("[S3 Raw] Error", error);
    return new Response(JSON.stringify({
      status: "error",
      message: error.message || error.toString(),
      type: error.constructor.name,
      stack: error.stack?.split('\n').slice(0, 5)
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function testS3Connection(context) {
  const storageConfig = getStorageConfig(context);
  
  if (!storageConfig.isCustomS3) {
    return new Response(JSON.stringify({
      status: "error",
      message: "Not using custom S3"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { endpoint, bucketName, accessKey, secretKey } = storageConfig;
  
  if (!endpoint || !bucketName || !accessKey || !secretKey) {
    return new Response(JSON.stringify({
      status: "error",
      message: "Missing S3 configuration",
      missing: {
        endpoint: !endpoint,
        bucketName: !bucketName,
        accessKey: !accessKey,
        secretKey: !secretKey,
      }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    console.log("[S3 Test] Testing connection", { endpoint, bucketName });
    
    const client = new S3Client(accessKey, secretKey);
    const result = await client.listBucket(endpoint, bucketName, "", "/");
    
    console.log("[S3 Test] Success", { objects: result.objects.length, prefixes: result.delimitedPrefixes.length });
    
    return new Response(JSON.stringify({
      status: "success",
      message: "S3 connection successful",
      data: {
        objectCount: result.objects.length,
        prefixCount: result.delimitedPrefixes.length,
        samples: {
          objects: result.objects.slice(0, 3).map(o => ({ key: o.key, size: o.size })),
          prefixes: result.delimitedPrefixes.slice(0, 3),
        }
      }
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error: any) {
    console.error("[S3 Test] Error", error);
    return new Response(JSON.stringify({
      status: "error",
      message: error.message || error.toString(),
      type: error.constructor.name
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
