import type { Context } from "telegraf";

export async function downloadTelegramFile(ctx: Context, fileId: string): Promise<Buffer> {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`telegram_file_${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
