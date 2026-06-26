import express from "express";
import multer from "multer";
import { existsSync } from "fs";
import { join } from "path";
import { env, isDeepSeekConfigured, isTelegramBotConfigured, resolvedDefaultScopePath } from "./config.js";
import { createLibraryRouter } from "./routes.js";
import { startBot, stopBot, isBotRunning } from "./bot/index.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  const defaultScope = resolvedDefaultScopePath();
  res.json({
    status: "ok",
    service: "technical-library",
    root: env.LIBRARY_ROOT,
    ...(env.DEFAULT_DIRECTION_SLUG ? { default_direction: env.DEFAULT_DIRECTION_SLUG } : {}),
    ...(defaultScope ? { default_scope_path: defaultScope } : {}),
    max_file_mb: env.LIBRARY_MAX_FILE_MB,
    llm_configured: isDeepSeekConfigured(),
    telegram_configured: isTelegramBotConfigured(),
    telegram_running: isBotRunning(),
  });
});

app.use("/api/library", createLibraryRouter());

const webRoot = join(__dirname, "../web");
if (existsSync(webRoot)) {
  app.use(express.static(webRoot, { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
  app.get(/^(?!\/api\/|\/health).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(join(webRoot, "index.html"));
  });
}

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
  startBot();
});

function shutdown(signal: string): void {
  console.log(`shutdown: ${signal}`);
  void stopBot(signal).finally(() => {
    server.close(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
