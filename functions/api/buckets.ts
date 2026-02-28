import { S3Client } from "@/utils/s3";

async function getCurrentBucket(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const driveid = url.hostname.replace(/\..*/, "");

  // 修改1：使用第三方存储的endpoint
  const endpoint = env.STORAGE_ENDPOINT;  // 从环境变量获取
  
  // 修改2：这里有问题！env[driveid] 是R2绑定，需要改成S3客户端访问
  // 原来的代码直接用了R2绑定，现在需要用S3客户端
  const client = new S3Client(
    env.STORAGE_ACCESS_KEY || env.AWS_ACCESS_KEY_ID,
    env.STORAGE_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY,
    env.STORAGE_REGION || 'auto'
  );
  
  // 修改3：检查CNAME文件是否存在，需要用S3客户端
  try {
    // 尝试获取CNAME文件，检查是否存在
    const cnameResponse = await client.s3_fetch(
      `${endpoint}/${driveid}/_$flaredrive$/CNAME`,
      { method: 'HEAD' }  // HEAD请求只检查是否存在
    );
    
    // 如果状态码不是200，说明文件不存在
    if (cnameResponse.status !== 200) {
      // 创建CNAME文件
      await client.s3_fetch(
        `${endpoint}/${driveid}/_$flaredrive$/CNAME`,
        {
          method: 'PUT',
          body: url.hostname,
          headers: { 'Content-Type': 'text/plain' }
        }
      );
    }
  } catch (error) {
    // 如果请求失败（文件不存在），创建它
    await client.s3_fetch(
      `${endpoint}/${driveid}/_$flaredrive$/CNAME`,
      {
        method: 'PUT',
        body: url.hostname,
        headers: { 'Content-Type': 'text/plain' }
      }
    );
  }

  // 修改4：获取存储桶列表
  // 注意：有些第三方存储可能不支持列出所有存储桶，需要预先配置
  let bucketNames;
  
  try {
    // 尝试列出所有存储桶
    const bucketsResponse = await client.s3_fetch(`${endpoint}/`);
    const bucketsText = await bucketsResponse.text();
    
    // 解析XML获取存储桶名称（保持原有逻辑）
    bucketNames = [
      ...bucketsText.matchAll(/<Name>([0-9a-z-]*)<\/Name>/g),
    ].map((match) => match[1]);
    
    // 如果没有找到存储桶，尝试使用预设的存储桶
    if (bucketNames.length === 0 && env.STORAGE_BUCKET) {
      bucketNames = [env.STORAGE_BUCKET];
    }
  } catch (error) {
    // 如果列出存储桶失败，使用预设的存储桶
    console.error('Failed to list buckets:', error);
    bucketNames = env.STORAGE_BUCKET ? [env.STORAGE_BUCKET] : [];
  }
  
  // 查找匹配的存储桶（保持原有逻辑）
  const currentBucket = await Promise.any(
    bucketNames.map(
      (name) =>
        new Promise<string>((resolve, reject) => {
          client.s3_fetch(
            `${endpoint}/${name}/_$flaredrive$/CNAME`
          )
          .then((response) => response.text())
          .then((text) => {
            if (text === url.hostname) resolve(name);
            else reject();
          })
          .catch(() => reject());
        })
    )
  );

  return new Response(currentBucket, {
    headers: { "cache-control": "max-age=604800" },
  });
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;

    const url = new URL(request.url);
    if (url.searchParams.has("current")) return await getCurrentBucket(context);

    // 修改5：使用第三方存储的凭证和endpoint
    const client = new S3Client(
      env.STORAGE_ACCESS_KEY || env.AWS_ACCESS_KEY_ID,
      env.STORAGE_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY,
      env.STORAGE_REGION || 'auto'
    );
    
    // 获取存储桶列表
    return client.s3_fetch(
      `${env.STORAGE_ENDPOINT}/`
    );
  } catch (e) {
    return new Response(e.toString(), { status: 500 });
  }
}
