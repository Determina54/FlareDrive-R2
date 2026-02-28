import { S3Client } from "@/utils/s3";

async function getCurrentBucket(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const driveid = url.hostname.replace(/\..*/, "");

  if (!(await env[driveid].head("_$flaredrive$/CNAME")))
    await env[driveid].put("_$flaredrive$/CNAME", url.hostname);

  // 判断是否使用第三方 S3
  const isCustomS3 = env.CustomS3 === "true";
  const accessKey = isCustomS3 ? env.S3_ACCESS_KEY : env.AWS_ACCESS_KEY_ID;
  const secretKey = isCustomS3 ? env.S3_SECRET_KEY : env.AWS_SECRET_ACCESS_KEY;
  const s3Endpoint = isCustomS3 ? env.S3_ENDPOINT : `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const client = new S3Client(accessKey, secretKey);

  // 第三方 S3 如果指定了 bucket 名称，直接使用
  if (isCustomS3 && env.S3_BUCKET_NAME) {
    return new Response(env.S3_BUCKET_NAME, {
      headers: { "cache-control": "max-age=604800" },
    });
  }

  const bucketsResponse = await client.s3_fetch(
    `${s3Endpoint}/`
  );
  const bucketsText = await bucketsResponse.text();
  const bucketNames = [
    ...bucketsText.matchAll(/<Name>([0-9a-z-]*)<\/Name>/g),
  ].map((match) => match[1]);
  const currentBucket = await Promise.any(
    bucketNames.map(
      (name) =>
        new Promise<string>((resolve, reject) => {
          client
            .s3_fetch(
              `${s3Endpoint}/${name}/_$flaredrive$/CNAME`
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

    // 判断是否使用第三方 S3
    const isCustomS3 = env.CustomS3 === "true";
    const accessKey = isCustomS3 ? env.S3_ACCESS_KEY : env.AWS_ACCESS_KEY_ID;
    const secretKey = isCustomS3 ? env.S3_SECRET_KEY : env.AWS_SECRET_ACCESS_KEY;
    const s3Endpoint = isCustomS3 ? env.S3_ENDPOINT : `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

    const client = new S3Client(
      accessKey,
      secretKey
    );
    
    // 第三方 S3 如果指定了 bucket 名称，直接使用该 bucket 路径
    if (isCustomS3 && env.S3_BUCKET_NAME) {
      return client.s3_fetch(
        `${s3Endpoint}/${env.S3_BUCKET_NAME}/`
      );
    }

    return client.s3_fetch(
      `${s3Endpoint}/`
    );
  } catch (e) {
    return new Response(e.toString(), { status: 500 });
  }
}
