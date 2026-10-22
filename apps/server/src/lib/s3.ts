import net from "node:net";
import { AwsClient } from "aws4fetch";

// A bucket, or a prefix inside it, on any S3-compatible service (AWS, MinIO, R2, Backblaze…),
// read with SigV4-signed requests. Only what VideoCAT needs: list, read a range, delete.

export type S3Location = {
  // Origin of the service (http://192.168.1.30:9000); empty means AWS for the region.
  endpoint: string;
  region: string;
  bucket: string;
  // "" or a folder-like prefix ending in "/".
  prefix: string;
  // bucket in the path (MinIO and most self-hosted services) instead of in the host name.
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

export type S3Object = { key: string; sizeBytes: number; lastModified: Date | null; etag: string | null };

export type S3ListPage = { objects: S3Object[]; truncated: boolean; nextContinuationToken: string | null };

// Why a request failed, as a code and its details: the web words it (and translates it).
export type S3Failure =
  | { code: "endpoint_not_found" | "endpoint_refused" | "endpoint_timeout" | "tls_invalid" | "path_style_required"; host: string }
  | { code: "network"; host: string; detail: string }
  | { code: "not_s3"; status: number }
  | { code: "invalid_access_key" | "signature_mismatch" | "access_denied" }
  | { code: "no_such_bucket"; bucket: string }
  | { code: "wrong_region"; region: string | null }
  | { code: "http_error"; status: number; s3Code: string | null };

export class S3RequestError extends Error {
  constructor(readonly failure: S3Failure) {
    super(`S3 request failed: ${failure.code}`);
    this.name = "S3RequestError";
  }
}

export type S3CheckStep =
  | { step: "list"; ok: true; objects: number; truncated: boolean }
  | { step: "read"; ok: true; key: string }
  | { step: "read"; ok: null }
  | { step: "list" | "read"; ok: false; failure: S3Failure };

export type S3CheckResult = { ok: boolean; steps: S3CheckStep[] };

const requestTimeoutMs = 10_000;

export function normalizePrefix(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "";
}

export function endpointUrl(location: Pick<S3Location, "endpoint" | "region">): URL {
  return new URL(location.endpoint.trim() || `https://s3.${location.region}.amazonaws.com`);
}

export function bucketUrl(location: S3Location): URL {
  const endpoint = endpointUrl(location);
  if (location.forcePathStyle) return new URL(`${endpoint.origin}/${encodeSegment(location.bucket)}/`);
  // The bucket in the host name needs a DNS name: an IP address or localhost cannot carry it.
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname) || hostname === "localhost") throw new S3RequestError({ code: "path_style_required", host: endpoint.host });
  return new URL(`${endpoint.protocol}//${location.bucket}.${endpoint.host}/`);
}

// Each segment encoded the way SigV4 canonicalizes it, so the path sent is the path signed
// (a "+" or "(" left as is would be signed differently than received).
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function objectUrl(location: S3Location, key: string): URL {
  return new URL(`${bucketUrl(location).href}${key.split("/").map(encodeSegment).join("/")}`);
}

function clientFor(location: S3Location): AwsClient {
  return new AwsClient({
    accessKeyId: location.accessKeyId,
    secretAccessKey: location.secretAccessKey,
    service: "s3",
    region: location.region
  });
}

const xmlEntities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return xmlEntities[entity] ?? whole;
  });
}

function xmlValue(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : null;
}

// ListObjectsV2 asked with encoding-type=url: keys come URL-encoded inside the XML.
export function parseListObjects(xml: string): S3ListPage {
  if (!/<ListBucketResult[\s>]/.test(xml)) throw new S3RequestError({ code: "not_s3", status: 200 });
  const urlEncoded = xmlValue(xml, "EncodingType") === "url";
  const objects: S3Object[] = [];
  for (const [, body] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const rawKey = xmlValue(body, "Key");
    if (rawKey === null) continue;
    const modified = xmlValue(body, "LastModified");
    const etag = xmlValue(body, "ETag");
    objects.push({
      key: urlEncoded ? decodeURIComponent(rawKey.replace(/\+/g, " ")) : rawKey,
      sizeBytes: Number(xmlValue(body, "Size") ?? 0),
      lastModified: modified ? new Date(modified) : null,
      etag: etag ? etag.replace(/^"|"$/g, "") : null
    });
  }
  return {
    objects,
    truncated: xmlValue(xml, "IsTruncated") === "true",
    nextContinuationToken: xmlValue(xml, "NextContinuationToken")
  };
}

export function parseS3Error(xml: string): { code: string | null; region: string | null } {
  if (!/<Error[\s>]/.test(xml)) return { code: null, region: null };
  return { code: xmlValue(xml, "Code"), region: xmlValue(xml, "Region") };
}

function failureFromResponse(status: number, body: string, location: S3Location): S3Failure {
  const { code, region } = parseS3Error(body);
  if (!code) {
    // A redirect or an HTML page: not an S3 service at this address (or a proxy in front).
    if (status === 301 || status === 307) return { code: "wrong_region", region: null };
    return { code: "not_s3", status };
  }
  if (code === "InvalidAccessKeyId") return { code: "invalid_access_key" };
  if (code === "SignatureDoesNotMatch") return { code: "signature_mismatch" };
  if (code === "AccessDenied") return { code: "access_denied" };
  if (code === "NoSuchBucket") return { code: "no_such_bucket", bucket: location.bucket };
  if (code === "PermanentRedirect" || code === "AuthorizationHeaderMalformed" || code === "IllegalLocationConstraintException") {
    return { code: "wrong_region", region };
  }
  return { code: "http_error", status, s3Code: code };
}

function failureFromNetwork(error: unknown, host: string): S3Failure {
  const cause = (error as { cause?: { code?: string } })?.cause;
  const code = cause?.code ?? (error as { code?: string })?.code ?? "";
  if ((error as Error)?.name === "TimeoutError" || (error as Error)?.name === "AbortError") return { code: "endpoint_timeout", host };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { code: "endpoint_not_found", host };
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH") return { code: "endpoint_refused", host };
  if (/CERT|SELF_SIGNED|TLS|SSL/.test(code)) return { code: "tls_invalid", host };
  return { code: "network", host, detail: (code || (error instanceof Error ? error.message : String(error))).slice(0, 200) };
}

async function s3Request(location: S3Location, url: URL, init: RequestInit = {}): Promise<Response> {
  const host = url.host;
  let response: Response;
  try {
    response = await clientFor(location).fetch(url.href, {
      ...init,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (error) {
    throw new S3RequestError(failureFromNetwork(error, host));
  }
  if (response.status >= 300) {
    const body = await response.text().catch(() => "");
    throw new S3RequestError(failureFromResponse(response.status, body, location));
  }
  return response;
}

export async function listObjects(
  location: S3Location,
  options: { continuationToken?: string | null; maxKeys?: number } = {}
): Promise<S3ListPage> {
  const url = bucketUrl(location);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("encoding-type", "url");
  url.searchParams.set("max-keys", String(options.maxKeys ?? 1000));
  if (location.prefix) url.searchParams.set("prefix", location.prefix);
  if (options.continuationToken) url.searchParams.set("continuation-token", options.continuationToken);
  const response = await s3Request(location, url);
  return parseListObjects(await response.text());
}

export async function listAllObjects(location: S3Location, onPage?: (listed: number) => void): Promise<S3Object[]> {
  const objects: S3Object[] = [];
  let continuationToken: string | null = null;
  do {
    const page = await listObjects(location, { continuationToken });
    objects.push(...page.objects);
    onPage?.(objects.length);
    continuationToken = page.truncated ? page.nextContinuationToken : null;
  } while (continuationToken);
  return objects;
}

// A GET URL with the signature in its query, for tools that only take a URL (ffprobe, ffmpeg).
// It reads only that object and expires; it must never be stored or shown (scrubSignedUrls).
export async function presignedGetUrl(location: S3Location, key: string, expiresSeconds = 3 * 60 * 60): Promise<string> {
  const url = objectUrl(location, key);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await clientFor(location).sign(url.href, { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

export function scrubSignedUrls(text: string, signedUrl: string, replacement: string): string {
  return text.split(signedUrl).join(replacement).replace(/https?:\/\/[^\s"']*X-Amz-Signature=[^\s"']*/g, replacement);
}

// Reads one byte: proves the credential may read objects without downloading them.
export async function readFirstByte(location: S3Location, key: string): Promise<void> {
  const response = await s3Request(location, objectUrl(location, key), { headers: { Range: "bytes=0-0" } });
  await response.body?.cancel();
}

// What the form's "Probar conexión" checks: listing under the prefix, then reading an object.
// Deleting cannot be checked without deleting; it shows when the first deletion is processed.
export async function checkS3Location(location: S3Location): Promise<S3CheckResult> {
  let page: S3ListPage;
  try {
    page = await listObjects(location, { maxKeys: 20 });
  } catch (error) {
    if (!(error instanceof S3RequestError)) throw error;
    return { ok: false, steps: [{ step: "list", ok: false, failure: error.failure }] };
  }
  const steps: S3CheckStep[] = [{ step: "list", ok: true, objects: page.objects.length, truncated: page.truncated }];
  const sample = page.objects.find((object) => object.sizeBytes > 0);
  if (!sample) {
    steps.push({ step: "read", ok: null });
    return { ok: true, steps };
  }
  try {
    await readFirstByte(location, sample.key);
    steps.push({ step: "read", ok: true, key: sample.key });
    return { ok: true, steps };
  } catch (error) {
    if (!(error instanceof S3RequestError)) throw error;
    steps.push({ step: "read", ok: false, failure: error.failure });
    return { ok: false, steps };
  }
}
