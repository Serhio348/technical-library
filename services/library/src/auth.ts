import type { Request, Response, NextFunction } from "express";
import { env } from "./config.js";

export function requireLibrarySecret(req: Request, res: Response, next: NextFunction): void {
  const secret = env.LIBRARY_SHARED_SECRET;
  if (!secret) {
    next();
    return;
  }
  const header = req.header("x-library-secret");
  if (typeof header !== "string" || header !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
