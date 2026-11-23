// Original uploaded files, kept in S3-compatible storage (AWS S3, MinIO, R2…) when S3_BUCKET is set.
// Without it, uploads are still extracted and searchable; only the original file is not kept.
// Credentials come from the standard AWS variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const Bucket = process.env.S3_BUCKET;
const s3 = Bucket
  ? new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      // MinIO and most self-hosted stores need path-style URLs; AWS works with both.
      forcePathStyle: !!process.env.S3_ENDPOINT,
    })
  : null;

export const storageEnabled = () => s3 !== null;

/** Every object of a knowledge base lives under this prefix, so deleting the knowledge base can delete them all. */
export const kbPrefix = (kbId: number) => `kb/${kbId}/`;

export async function putFile(key: string, body: Buffer, contentType: string) {
  await s3!.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getFile(key: string) {
  const r = await s3!.send(new GetObjectCommand({ Bucket, Key: key }));
  return { body: Buffer.from(await r.Body!.transformToByteArray()), contentType: r.ContentType ?? "application/octet-stream" };
}

/** Best effort: the database row is already gone, so a storage failure only leaves an orphaned object. */
export async function deleteFile(key: string) {
  if (!s3) return;
  await s3.send(new DeleteObjectCommand({ Bucket, Key: key })).catch((e) => console.error("storage delete failed", key, e));
}

export async function deletePrefix(prefix: string) {
  if (!s3) return;
  try {
    let token: string | undefined;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
      token = page.NextContinuationToken;
    } while (token);
  } catch (e) {
    console.error("storage delete failed", prefix, e);
  }
}
