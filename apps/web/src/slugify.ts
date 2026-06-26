const CYRILLIC: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function slugFromTitle(title: string): string {
  const lower = title.trim().toLowerCase();
  let out = "";
  for (const ch of lower) {
    if (CYRILLIC[ch] !== undefined) {
      out += CYRILLIC[ch];
      continue;
    }
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      continue;
    }
    if (ch === " " || ch === "-" || ch === "_" || ch === ".") {
      out += "-";
    }
  }

  out = out
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  if (!out) return "napravlenie";
  if (!/^[a-z0-9]/.test(out)) out = `n-${out.replace(/^-+/, "")}`;
  return out;
}

export function ensureUniqueSlug(baseTitle: string, existingSlugs: string[]): string {
  const taken = new Set(existingSlugs);
  const base = slugFromTitle(baseTitle);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
