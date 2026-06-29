export type AppRoute =
  | { view: "home" }
  | { view: "direction"; slug: string; path: string };

export function parseAppHash(hash = window.location.hash): AppRoute {
  const raw = hash.replace(/^#/, "").replace(/^\//, "");
  if (!raw) return { view: "home" };

  const segments = raw.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });

  if (segments.length === 0) return { view: "home" };
  return { view: "direction", slug: segments[0]!, path: segments.slice(1).join("/") };
}

export function buildAppHash(slug: string, path = ""): string {
  const parts = [slug, ...path.split("/").filter(Boolean)];
  return `#/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

export function homeAppHash(): string {
  return "#/";
}
