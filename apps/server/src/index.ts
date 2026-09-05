import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";
import { buildApp } from "./app.js";

const app = await buildApp();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

await app.listen({ host: env.SERVER_HOST, port: env.SERVER_PORT });
