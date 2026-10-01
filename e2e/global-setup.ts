import { execSync } from "node:child_process";

// Seeds the demo catalog before the run when E2E_SEED=1. The seed script itself refuses production.
export default function globalSetup() {
  if (process.env.E2E_SEED !== "1") return;
  execSync("npm run seed:demo -w @videocat/server", {
    stdio: "inherit",
    env: { ...process.env, VIDEOCAT_DEMO_SEED: "1" }
  });
}
