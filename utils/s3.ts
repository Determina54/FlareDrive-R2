function arrayBufferToHex(arrayBuffer: ArrayBuffer) {
  return [...new Uint8Array(arrayBuffer)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSHA256(secret: ArrayBuffer, message: string | ArrayBuffer) {
  if (typeof message === "string") message = new TextEncoder().encode(message);
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return signature;
}

export class S3Client {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  useVirtualHost: boolean;

  constructor(accessKeyId: string, secretAccessKey: string, region?: string, useVirtualHost?: boolean) {
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region || "auto";
    this.useVirtualHost = useVirtualHost ?? false;
  }

  public async s3_fetch(input: string, init?: RequestInit) {
    init = init || {};
    const url = new URL(input);
    const objectKey = decodeURI(url.pathname);
    const method = init.method || "GET";
    const canonicalQueryString = [...url.searchParams]
      .map(
        ([key, value]) =>
          encodeURIComponent(key) + "=" + encodeURIComponent(value)
      )
      .join("&");
    
    // 计算 payload hash
    let hashedPayload = "UNSIGNED-PAYLOAD";
    if (init.body) {
      // 如果有 body，计算实际的 SHA-256 hash
      let bodyBuffer: ArrayBuffer;
      if (typeof init.body === "string") {
        bodyBuffer = new TextEncoder().encode(init.body);
      } else if (init.body instanceof ArrayBuffer) {
        bodyBuffer = init.body;
      } else if (init.body instanceof Uint8Array) {
        bodyBuffer = init.body.buffer;
      } else {
        // 其他类型使用 UNSIGNED-PAYLOAD
        hashedPayload = "UNSIGNED-PAYLOAD";
        bodyBuffer = null;
      }
      
      if (bodyBuffer) {
        const hashBuffer = await crypto.subtle.digest("SHA-256", bodyBuffer);
        hashedPayload = arrayBufferToHex(hashBuffer);
      }
    }
    
    const headers = new Headers(init.headers);
    const datetime = new Date().toISOString().replace(/-|:|\.\d+/g, "");
    headers.set("x-amz-date", datetime);
    headers.set("x-amz-content-sha256", hashedPayload);
    headers.set("host", url.host);
    const signedHeaderKeys = [...headers.keys()].filter(
      (header) =>
        header === "host" ||
        header === "content-type" ||
        header.startsWith("x-amz-")
    );
    const canonicalHeaders = signedHeaderKeys
      .map((key) => `${key}:${headers.get(key)}\n`)
      .join("");
    const signedHeaders = signedHeaderKeys.join(";");
    const canonicalUri = encodeURIComponent(objectKey)
      .replaceAll("%2F", "/")
      .replace(/[!*'()]/g, function (c) {
        return "%" + c.charCodeAt(0).toString(16).toUpperCase();
      });
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedPayload,
    ].join("\n");

    const hashedRequest = arrayBufferToHex(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonicalRequest)
      )
    );
    const scope = `${datetime.slice(0, 8)}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      datetime,
      scope,
      hashedRequest,
    ].join("\n");

    const dateKey = await hmacSHA256(
      new TextEncoder().encode("AWS4" + this.secretAccessKey),
      datetime.slice(0, 8)
    );
    const dateRegionKey = await hmacSHA256(dateKey, this.region);
    const dateRegionServiceKey = await hmacSHA256(dateRegionKey, "s3");
    const signingKey = await hmacSHA256(dateRegionServiceKey, "aws4_request");
    const signature = arrayBufferToHex(
      await hmacSHA256(signingKey, stringToSign)
    );

    const credential = `${this.accessKeyId}/${scope}`;
    const authorizationString = `AWS4-HMAC-SHA256 Credential=${credential},SignedHeaders=${signedHeaders},Signature=${signature}`;

    headers.set("Authorization", authorizationString);
    init.headers = headers;
    return fetch(input, init);
  }

  public async listBucket(endpoint: string, bucketName: string, prefix?: string, delimiter?: string) {
    const params = new URLSearchParams();
    
    // 规范化 prefix：确保有 trailing slash（如果有内容）
    let normalizedPrefix = prefix || "";
    if (normalizedPrefix && !normalizedPrefix.endsWith("/")) {
      normalizedPrefix += "/";
    }
    // 如果 prefix 是空字符串或者被删除了，不要加 /
    if (normalizedPrefix === "/") {
      normalizedPrefix = "";
    }
    
    if (normalizedPrefix && normalizedPrefix.trim()) {
      params.append("prefix", normalizedPrefix);
    }
    if (delimiter) {
      params.append("delimiter", delimiter);
    }
    
    // 构造正确的 S3 URL
    const queryString = params.toString();
    const url = queryString 
      ? `${endpoint}/${bucketName}/?${queryString}`
      : `${endpoint}/${bucketName}/`;
    
    console.log("[S3] Listing bucket:", { endpoint, bucketName, originalPrefix: prefix, normalizedPrefix, delimiter, url });
    
    try {
      const response = await this.s3_fetch(url);
      const xmlText = await response.text();
      
      console.log("[S3] Response status:", response.status);
      console.log("[S3] Response text length:", xmlText.length);
      console.log("[S3] First 1000 chars:", xmlText.substring(0, 1000));
      
      if (response.status !== 200) {
        console.error("[S3] Error response:", response.status, xmlText);
        throw new Error(`S3 ListBucket failed with status ${response.status}: ${xmlText}`);
      }
      
      // 简单的 XML 解析
      const objects: any[] = [];
      const delimitedPrefixes: string[] = [];
      
      // 检查 XML 是否包含 Contents 标签
      if (!xmlText.includes('<Contents>')) {
        console.warn("[S3] No <Contents> found in response");
      }
      
      // 解析 Contents（文件） - 不依赖字段顺序
      const contentsRegex = /<Contents>[\s\S]*?<\/Contents>/g;
      let match;
      let contentsMatches = [];
      
      while ((match = contentsRegex.exec(xmlText)) !== null) {
        contentsMatches.push(match[0]);
      }
      
      console.log("[S3] Found", contentsMatches.length, "<Contents> blocks");
      
      for (const contentBlock of contentsMatches) {
        // 从内容块中提取各个字段
        const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(contentBlock);
        const sizeMatch = /<Size>([\d]+)<\/Size>/.exec(contentBlock);
        const lastModifiedMatch = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(contentBlock);
        
        if (keyMatch && sizeMatch) {
          console.log("[S3] Adding object:", keyMatch[1]);
          objects.push({
            key: keyMatch[1],
            size: parseInt(sizeMatch[1]),
            uploaded: lastModifiedMatch ? new Date(lastModifiedMatch[1]) : new Date(),
            // 与 R2 API 兼容，添加空的元数据对象
            httpMetadata: {
              contentType: "application/octet-stream",
            },
            customMetadata: {},
          });
        } else {
          console.warn("[S3] Failed to extract key/size from Contents block:", contentBlock.substring(0, 200));
        }
      }
      
      console.log("[S3] Parsed objects:", objects.length);
      if (objects.length > 0) {
        console.log("[S3] Sample objects:", objects.slice(0, 3));
      }
      
      // 解析 CommonPrefixes（文件夹）
      const prefixRegex = /<CommonPrefixes>[\s\S]*?<Prefix>([\s\S]*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g;
      while ((match = prefixRegex.exec(xmlText)) !== null) {
        delimitedPrefixes.push(match[1]);
      }
      
      console.log("[S3] Parsed prefixes:", delimitedPrefixes.length, delimitedPrefixes);
      
      return {
        objects,
        delimitedPrefixes,
      };
    } catch (error) {
      console.error("[S3] Error listing bucket:", error);
      return { objects: [], delimitedPrefixes: [] };
    }
  }
}
