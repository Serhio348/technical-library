import { env } from "./config.js";

let active = 0;
const waiters: Array<() => void> = [];

function maxConcurrent(): number {
  return env.LIBRARY_OCR_MAX_CONCURRENT;
}

function acquire(): Promise<void> {
  if (active < maxConcurrent()) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

/** Ограничивает параллельный OCR (tesseract/pdftoppm), чтобы не «убивать» VPS. */
export async function withOcrLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

/** @internal tests */
export function _resetOcrLockForTests(): void {
  active = 0;
  waiters.length = 0;
}
