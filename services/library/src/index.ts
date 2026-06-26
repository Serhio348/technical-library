import express from "express";
import multer from "multer";
import { env, resolvedDefaultLibraryPath } from "./config.js";
import { createLibraryRouter } from "./routes.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  const defaultPath = resolvedDefaultLibraryPath();
  res.json({
    status: "ok",
    root: env.LIBRARY_ROOT,
    default_slug: env.INSTALLATION_SLUG,
    ...(defaultPath ? { default_path: defaultPath } : {}),
    max_file_mb: env.LIBRARY_MAX_FILE_MB,
  });
});

app.use("/api/library", createLibraryRouter());

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "file_too_large", max_mb: env.LIBRARY_MAX_FILE_MB });
    return;
  }
  next(err);
});

const server = app.listen(env.LIBRARY_PORT, () => {
  console.log(`technical-library listening on :${env.LIBRARY_PORT}`);
  console.log(`library root: ${env.LIBRARY_ROOT}`);
  console.log(`default collection: ${env.INSTALLATION_SLUG}`);
});

function shutdown(signal: string): void {
  console.log(`shutdown: ${signal}`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
