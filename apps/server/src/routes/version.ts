import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireWebAuth } from "../lib/auth.js";
import { compareStableVersions, latestStableVersion } from "../lib/version-check.js";

const dockerHubTagsUrl = "https://hub.docker.com/v2/namespaces/reiterstahl/repositories/videocat-web/tags?page_size=100";
const dockerHubRepositoryUrl = "https://hub.docker.com/r/reiterstahl/videocat-web/tags";
const cacheDurationMs = 6 * 60 * 60 * 1000;

const versionQuerySchema = z.object({
  current: z.string().regex(/^\d+\.\d+\.\d+$/)
});

type DockerHubTagsResponse = {
  results?: Array<{ name?: unknown }>;
};

let cachedVersion: { value: string; expiresAt: number } | null = null;

async function dockerHubLatestVersion(): Promise<string> {
  if (cachedVersion && cachedVersion.expiresAt > Date.now()) return cachedVersion.value;

  const response = await fetch(dockerHubTagsUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(4_000)
  });
  if (!response.ok) throw new Error(`Docker Hub returned ${response.status}`);

  const payload = await response.json() as DockerHubTagsResponse;
  const tags = (payload.results ?? [])
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === "string");
  const latestVersion = latestStableVersion(tags);
  if (!latestVersion) throw new Error("Docker Hub returned no stable VideoCAT tags");

  cachedVersion = {
    value: latestVersion,
    expiresAt: Date.now() + cacheDurationMs
  };
  return latestVersion;
}

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/version/latest", { preHandler: requireWebAuth }, async (request) => {
    const query = versionQuerySchema.parse(request.query);
    try {
      const latestVersion = await dockerHubLatestVersion();
      return {
        currentVersion: query.current,
        latestVersion,
        updateAvailable: compareStableVersions(latestVersion, query.current) > 0,
        repositoryUrl: dockerHubRepositoryUrl
      };
    } catch (error) {
      request.log.warn({ err: error }, "Could not check the latest VideoCAT Docker Hub version");
      return {
        currentVersion: query.current,
        latestVersion: null,
        updateAvailable: false,
        repositoryUrl: dockerHubRepositoryUrl
      };
    }
  });
}
