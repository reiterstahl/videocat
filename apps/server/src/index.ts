import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { buildApp } from "./app.js";
import { thumbnailStorageHint, thumbnailStorageProblem } from "./lib/thumbnail-storage.js";

const app = await buildApp();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

const storageProblem = await thumbnailStorageProblem(env.THUMBNAILS_DIR);
if (storageProblem) {
  app.log.error(`THUMBNAILS_DIR (${env.THUMBNAILS_DIR}) is not writable; thumbnail uploads will fail. ${storageProblem}. ${thumbnailStorageHint}`);
}

await app.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT });
