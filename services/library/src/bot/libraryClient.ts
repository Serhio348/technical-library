import { answerLibraryQuestion, type AskResult } from "../ask.js";
import { env } from "../config.js";
import {
  getTree,
  listDirections,
  readExtractedText,
  searchInstallation,
  type DirectionMeta,
  type LibraryTree,
  type SearchHit,
} from "../storage.js";
import { clipSnippet } from "./format.js";

export type SearchResult = SearchHit & { excerpt: string };

export async function fetchDirections(): Promise<DirectionMeta[]> {
  return listDirections(env.LIBRARY_ROOT);
}

export async function fetchTree(slug: string, path = ""): Promise<LibraryTree> {
  return getTree(env.LIBRARY_ROOT, slug, path);
}

export async function searchLibrary(
  slug: string,
  query: string,
  scopePath: string,
): Promise<SearchResult[]> {
  let hits = await searchInstallation(env.LIBRARY_ROOT, slug, query, 8);
  if (scopePath) {
    hits = hits.filter((h) => h.path === scopePath || h.path.startsWith(`${scopePath}/`));
  }

  const out: SearchResult[] = [];
  for (const hit of hits) {
    const full = (await readExtractedText(env.LIBRARY_ROOT, slug, hit.path, 2000)) ?? hit.snippet;
    out.push({
      ...hit,
      excerpt: clipSnippet(full || hit.snippet),
    });
  }
  return out;
}

export async function askLibrary(
  slug: string,
  question: string,
  scopePath: string,
  history: unknown,
  mode: "preview" | "full",
): Promise<AskResult> {
  return answerLibraryQuestion(env.LIBRARY_ROOT, slug, question, scopePath, history, mode);
}
