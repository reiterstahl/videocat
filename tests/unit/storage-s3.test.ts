import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://videocat:videocat@localhost:5432/videocat";
process.env.JWT_SECRET ??= "test-jwt-secret-that-is-long-enough";
process.env.AGENT_TOKEN ??= "test-agent-token-that-is-long-enough";
process.env.ADMIN_PASSWORD ??= "test-password-12345";

const { bucketUrl, normalizePrefix, objectUrl, parseListObjects, parseS3Error, S3RequestError } = await import("../../apps/server/src/lib/s3.ts");
const { openSecret, sealSecret, secretHint } = await import("../../apps/server/src/lib/secret-box.ts");

const location = {
  endpoint: "http://192.168.1.30:9000",
  region: "us-east-1",
  bucket: "videos",
  prefix: "",
  forcePathStyle: true,
  accessKeyId: "key",
  secretAccessKey: "secret"
};

test("prefixes are stored as folders, without leading slashes", () => {
  assert.equal(normalizePrefix(""), "");
  assert.equal(normalizePrefix("  /Videos/2024/ "), "Videos/2024/");
  assert.equal(normalizePrefix("Videos"), "Videos/");
});

test("bucket and object URLs follow the addressing style and encode keys the way they are signed", () => {
  assert.equal(bucketUrl(location).href, "http://192.168.1.30:9000/videos/");
  assert.equal(bucketUrl({ ...location, endpoint: "", region: "eu-west-1", forcePathStyle: false }).href, "https://videos.s3.eu-west-1.amazonaws.com/");
  assert.equal(bucketUrl({ ...location, endpoint: "https://s3.example.com", forcePathStyle: false }).href, "https://videos.s3.example.com/");
  for (const endpoint of ["http://192.168.1.30:9000", "http://localhost:9000", "http://[::1]:9000"]) {
    assert.throws(() => bucketUrl({ ...location, endpoint, forcePathStyle: false }), (error: unknown) =>
      error instanceof S3RequestError && error.failure.code === "path_style_required", endpoint);
  }
  assert.equal(
    objectUrl(location, "Películas/Mi viaje (2024) + extra!.mp4").href,
    "http://192.168.1.30:9000/videos/Pel%C3%ADculas/Mi%20viaje%20%282024%29%20%2B%20extra%21.mp4"
  );
});

test("ListObjectsV2 with URL-encoded keys is read back to the real keys", () => {
  const page = parseListObjects(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>videos</Name><Prefix></Prefix>
<KeyCount>2</KeyCount><MaxKeys>2</MaxKeys><EncodingType>url</EncodingType><IsTruncated>true</IsTruncated>
<NextContinuationToken>abc&amp;def</NextContinuationToken>
<Contents><Key>Pel%C3%ADculas/Mi+viaje+%282024%29+%2B+extra%21.mp4</Key><LastModified>2026-10-22T17:22:43.000Z</LastModified><ETag>&quot;6d4f&quot;</ETag><Size>10</Size></Contents>
<Contents><Key>Ra%C3%ADz.mp4</Key><LastModified>2026-10-22T17:22:44.000Z</LastModified><ETag>"77aa"</ETag><Size>2048</Size></Contents>
</ListBucketResult>`);
  assert.deepEqual(page.objects.map((object) => [object.key, object.sizeBytes, object.etag]), [
    ["Películas/Mi viaje (2024) + extra!.mp4", 10, "6d4f"],
    ["Raíz.mp4", 2048, "77aa"]
  ]);
  assert.equal(page.objects[0].lastModified?.toISOString(), "2026-10-22T17:22:43.000Z");
  assert.equal(page.truncated, true);
  assert.equal(page.nextContinuationToken, "abc&def");
});

test("an answer that is not an S3 listing is reported as such", () => {
  assert.throws(() => parseListObjects("<html><body>Login</body></html>"), (error: unknown) =>
    error instanceof S3RequestError && error.failure.code === "not_s3");
  assert.deepEqual(parseS3Error("<Error><Code>AuthorizationHeaderMalformed</Code><Region>eu-west-1</Region></Error>"), { code: "AuthorizationHeaderMalformed", region: "eu-west-1" });
  assert.deepEqual(parseS3Error("<html></html>"), { code: null, region: null });
});

test("a sealed secret opens only with its key and its bucket", () => {
  const key = crypto.randomBytes(32);
  const sealed = sealSecret("minio-secret-value", "bucket-1", key);
  assert.ok(!sealed.includes("minio-secret-value"));
  assert.notEqual(sealSecret("minio-secret-value", "bucket-1", key), sealed, "every seal uses a new IV");
  assert.equal(openSecret(sealed, "bucket-1", key), "minio-secret-value");
  assert.throws(() => openSecret(sealed, "bucket-2", key));
  assert.throws(() => openSecret(sealed, "bucket-1", crypto.randomBytes(32)));
  assert.throws(() => sealSecret("x", "bucket-1", null), /STORAGE_SECRET_KEY/);
  assert.equal(secretHint("minio-secret-value"), "alue");
  assert.equal(secretHint("short"), "");
});
