import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchSearch, fileUrl } from "../api";
import type { SearchHit } from "../types";
import { SpeechInputButton } from "./SpeechInputButton";

function highlightSnippet(snippet: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q || q.length < 2) return snippet;

  const lower = snippet.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return snippet;

  const before = snippet.slice(0, idx);
  const match = snippet.slice(idx, idx + q.length);
  const after = snippet.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="tl-search__mark">{match}</mark>
      {after}
    </>
  );
}

export function DocumentSearch({
  slug,
  scopePath,
}: {
  slug: string;
  scopePath: string;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const voiceBaseRef = useRef("");

  const applyVoiceTranscript = (text: string, isFinal: boolean): void => {
    const base = voiceBaseRef.current.trim();
    const next = base ? `${base} ${text}` : text;
    setQuery(next);
    if (isFinal) voiceBaseRef.current = next;
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debounced) {
      setResults([]);
      setSearched(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void fetchSearch(slug, debounced, scopePath)
      .then((items) => {
        if (!cancelled) {
          setResults(items);
          setSearched(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setSearched(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, scopePath, debounced]);

  const scopeHint = scopePath
    ? `в «${scopePath.split("/").pop()}» и подпапках`
    : "во всём направлении";

  return (
    <div className="tl-search">
      <div className="tl-search__bar">
        <Search size={16} className="tl-search__icon" />
        <input
          type="search"
          className="tl-search__input"
          value={query}
          placeholder={`Поиск по тексту ${scopeHint}…`}
          onChange={(e) => setQuery(e.target.value)}
        />
        <SpeechInputButton
          title="Нажмите и говорите — текст появится в строке"
          onListeningStart={() => {
            voiceBaseRef.current = query;
          }}
          onTranscript={applyVoiceTranscript}
        />
        {query ? (
          <button
            type="button"
            className="tl-icon-btn"
            title="Очистить"
            onClick={() => {
              voiceBaseRef.current = "";
              setQuery("");
            }}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>

      {debounced ? (
        <div className="tl-search__results">
          {loading ? <p className="tl-search__meta">Ищем…</p> : null}
          {!loading && searched && results.length === 0 ? (
            <p className="tl-search__meta">Ничего не найдено. Проверьте индекс (метка ИИ у файла).</p>
          ) : null}
          {!loading && results.length > 0 ? (
            <ul className="tl-search__list">
              {results.map((hit) => (
                <li key={hit.path} className="tl-search__item">
                  <a className="tl-search__link" href={fileUrl(slug, hit.path)} target="_blank" rel="noreferrer">
                    <span className="tl-search__name">{hit.name}</span>
                    <span className="tl-search__path">{hit.path}</span>
                  </a>
                  <p className="tl-search__snippet">{highlightSnippet(hit.snippet, debounced)}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
