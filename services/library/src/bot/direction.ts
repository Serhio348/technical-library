import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { env } from "../config.js";
import type { DirectionMeta } from "../storage.js";
import { mainKeyboard } from "./keyboards.js";
import { fetchDirections, fetchTree } from "./libraryClient.js";
import { clearInputMode, getSession, resetAskState, sessionLabel } from "./session.js";

export async function applyDirection(ctx: Context, direction: DirectionMeta): Promise<void> {
  const session = getSession(ctx.chat!.id);
  session.slug = direction.slug;
  session.directionTitle = direction.title;
  session.scopePath = "";
  resetAskState(session);
  clearInputMode(session);

  await ctx.reply(
    `✅ <b>${direction.title}</b>\n\nМожно искать (🔍) или задать вопрос (💬).\nПапку — кнопкой 📁 Папка.`,
    { parse_mode: "HTML", ...mainKeyboard() },
  );
}

export async function promptChooseDirection(ctx: Context): Promise<void> {
  const directions = await fetchDirections();
  if (directions.length === 0) {
    await ctx.reply("Пока нет направлений. Добавьте их в веб-интерфейсе.", mainKeyboard());
    return;
  }

  const rows = directions.map((d) => [Markup.button.callback(d.title, `d:${d.slug}`)]);
  await ctx.reply("Выберите направление:", Markup.inlineKeyboard(rows));
}

export async function promptChooseFolder(ctx: Context): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!session.slug) {
    await ctx.reply("Сначала выберите направление — 📚 Направление.", mainKeyboard());
    await promptChooseDirection(ctx);
    return;
  }

  const tree = await fetchTree(session.slug, "");
  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback("📂 Все папки направления", "f:")],
  ];
  for (const folder of tree.folders) {
    rows.push([Markup.button.callback(`📁 ${folder.name}`, `f:${folder.path}`)]);
  }

  await ctx.reply(`Папка в «${session.directionTitle || session.slug}»:`, Markup.inlineKeyboard(rows));
}

export async function applyFolder(ctx: Context, path: string): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!session.slug) {
    await promptChooseDirection(ctx);
    return;
  }

  session.scopePath = path.replace(/\\/g, "/");
  resetAskState(session);
  clearInputMode(session);

  const label = session.scopePath
    ? (session.scopePath.split("/").pop() ?? session.scopePath)
    : "все папки";

  await ctx.reply(`📁 Папка: <b>${label}</b>\n\n${sessionLabel(session)}`, {
    parse_mode: "HTML",
    ...mainKeyboard(),
  });
}

export async function ensureDirectionOrPrompt(ctx: Context): Promise<boolean> {
  const session = getSession(ctx.chat!.id);
  if (session.slug) return true;
  await ctx.reply("Сначала выберите направление — 📚 Направление.", mainKeyboard());
  await promptChooseDirection(ctx);
  return false;
}

export async function autoPickDirectionOnStart(ctx: Context): Promise<void> {
  const session = getSession(ctx.chat!.id);
  const directions = await fetchDirections();

  if (session.slug) {
    const found = directions.find((d) => d.slug === session.slug);
    if (found) session.directionTitle = found.title;
    return;
  }

  if (directions.length === 1) {
    await applyDirection(ctx, directions[0]!);
    return;
  }

  const defaultSlug = env.DEFAULT_DIRECTION_SLUG;
  if (defaultSlug) {
    const found = directions.find((d) => d.slug === defaultSlug);
    if (found) await applyDirection(ctx, found);
  }
}
