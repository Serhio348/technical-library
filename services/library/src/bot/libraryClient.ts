import { answerLibraryQuestion, type AskResult } from "../ask.js";
import type { AskAttachment } from "../attachmentExtract.js";
import { env } from "../config.js";
import { catalogEntryMatchesPath, type DocumentCatalogEntry } from "../documentCatalog.js";
import {
  getTree,
  listDirections,
  listDocumentCatalog,
  readExtractedText,
  searchInstallation,
  type DirectionMeta,
  type LibraryTree,
  type SearchHit,
} from "../storage.js";
import { clipSnippet } from "./format.js";

export type SearchResult = SearchHit & { excerpt: string };

export type ScopedDocument = {
  path: string;
  title: string;
};

export async function fetchDirections(): Promise<DirectionMeta[]> {
  return listDirections(env.LIBRARY_ROOT);
}

export async function fetchTree(slug: string, path = ""): Promise<LibraryTree> {
  return getTree(env.LIBRARY_ROOT, slug, path);
}

export async function listScopedDocuments(slug: string, scopePath: string): Promise<ScopedDocument[]> {
  const catalog = await listDocumentCatalog(env.LIBRARY_ROOT, slug, scopePath);
  return catalog.map((entry) => ({
    path: entry.path,
    title: entry.title || (entry.path.split("/").pop() ?? entry.path),
  }));
}

export async function searchLibrary(
  slug: string,
  query: string,
  scopePath: string,
  documents: string[] = [],
): Promise<SearchResult[]> {
  let hits = await searchInstallation(env.LIBRARY_ROOT, slug, query, 8);
  if (scopePath) {
    hits = hits.filter((h) => h.path === scopePath || h.path.startsWith(`${scopePath}/`));
  }
  if (documents.length > 0) {
    hits = hits.filter((h) =>
      documents.some((doc) => catalogEntryMatchesPath({ path: h.path } as DocumentCatalogEntry, doc)),
    );
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
  attachment?: AskAttachment | null,
  documents: string[] = [],
): Promise<AskResult> {
  return answerLibraryQuestion(env.LIBRARY_ROOT, slug, question, scopePath, history, mode, attachment, {
    documents,
  });
}
