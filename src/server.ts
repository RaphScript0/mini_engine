import { startServer } from "./http/server.js";

const port = Number(process.env.PORT ?? 3000);

const { server } = await startServer({ port, metricsEnabled: process.env.METRICS_ENABLED === "1" });

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`listening on :${port}`);
