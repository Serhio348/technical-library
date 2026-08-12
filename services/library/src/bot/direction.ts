import type { Context } from "telegraf";
import { Markup } from "telegraf";
import { env } from "../config.js";
import type { DirectionMeta } from "../storage.js";
import { mainKeyboard } from "./keyboards.js";
import { fetchDirections, fetchTree, listScopedDocuments } from "./libraryClient.js";
import { clearInputMode, getSession, resetAskState, sessionLabel } from "./session.js";

const DOC_PAGE_SIZE = 10;

function buttonLabel(text: string, max = 48): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export async function applyDirection(ctx: Context, direction: DirectionMeta): Promise<void> {
  const session = getSession(ctx.chat!.id);
  session.slug = direction.slug;
  session.directionTitle = direction.title;
  session.scopePath = "";
  session.documentPath = "";
  session.documentFiles = [];
  resetAskState(session);
  clearInputMode(session);

  await ctx.reply(
    `✅ <b>${direction.title}</b>\n\nМожно искать (🔍) или задать вопрос (💬).\nПапку — 📁, конкретный файл — 📄.`,
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
  session.documentPath = "";
  session.documentFiles = [];
  resetAskState(session);
  clearInputMode(session);

  const label = session.scopePath
    ? (session.scopePath.split("/").pop() ?? session.scopePath)
    : "все папки";

  await ctx.reply(
    `📁 Папка: <b>${label}</b>\n\n${sessionLabel(session)}\n\nПри необходимости ограничьте поиск одним файлом — 📄 Файл.`,
    {
      parse_mode: "HTML",
      ...mainKeyboard(),
    },
  );
}

export async function promptChooseDocument(ctx: Context, page = 0): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!session.slug) {
    await ctx.reply("Сначала выберите направление — 📚 Направление.", mainKeyboard());
    await promptChooseDirection(ctx);
    return;
  }

  const docs = await listScopedDocuments(session.slug, session.scopePath);
  if (docs.length === 0) {
    await ctx.reply(
      "В выбранной области нет файлов. Выберите другую папку или загрузите документы в веб-интерфейсе.",
      mainKeyboard(),
    );
    return;
  }

  session.documentFiles = docs.map((d) => d.path);
  const totalPages = Math.max(1, Math.ceil(docs.length / DOC_PAGE_SIZE));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * DOC_PAGE_SIZE;
  const slice = docs.slice(start, start + DOC_PAGE_SIZE);

  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback("📄 Все файлы в области", "file:all")],
  ];
  for (let i = 0; i < slice.length; i += 1) {
    const idx = start + i;
    const doc = slice[i]!;
    const mark = session.documentPath === doc.path ? "✓ " : "";
    rows.push([Markup.button.callback(`${mark}${buttonLabel(doc.title)}`, `file:${idx}`)]);
  }

  if (totalPages > 1) {
    const nav: ReturnType<typeof Markup.button.callback>[] = [];
    if (safePage > 0) nav.push(Markup.button.callback("⬅️", `filepage:${safePage - 1}`));
    nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, "filepage:noop"));
    if (safePage < totalPages - 1) nav.push(Markup.button.callback("➡️", `filepage:${safePage + 1}`));
    rows.push(nav);
  }

  const scopeHint = session.scopePath
    ? `папка «${session.scopePath.split("/").pop()}»`
    : "всё направление";
  await ctx.reply(
    `Файл для поиска/вопроса (${scopeHint}, ${docs.length}):\n` +
      `Сейчас: ${session.documentPath ? session.documentPath.split("/").pop() : "все файлы"}`,
    Markup.inlineKeyboard(rows),
  );
}

export async function applyDocument(ctx: Context, path: string): Promise<void> {
  const session = getSession(ctx.chat!.id);
  if (!session.slug) {
    await promptChooseDirection(ctx);
    return;
  }

  session.documentPath = path.replace(/\\/g, "/");
  resetAskState(session);
  clearInputMode(session);

  if (!session.documentPath) {
    await ctx.reply(`📄 Поиск по <b>всем файлам</b> в области.\n\n${sessionLabel(session)}`, {
      parse_mode: "HTML",
      ...mainKeyboard(),
    });
    return;
  }

  const name = session.documentPath.split("/").pop() ?? session.documentPath;
  await ctx.reply(
    `📄 Файл: <b>${name}</b>\n\nПоиск и вопросы — в этом файле, в том числе уточнения. Сброс: снова 📄 Файл → «Все файлы».\n\n${sessionLabel(session)}`,
    {
      parse_mode: "HTML",
      ...mainKeyboard(),
    },
  );
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
