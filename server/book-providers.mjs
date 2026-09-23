// Federated bibliographic discovery: metadata only, never proxy or redistribute books.
const TIMEOUT_MS = 6200;
const LIMIT_BYTES = 2_000_000;
const HEADERS = { accept: "application/json", "user-agent": "WAEWEB-Biblioteca/1.0 (https://github.com/aleexwae4-lab/Waeweb)" };
const tidy = value => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const year = input => {
  const match = String(input ?? "").match(/^(\d{4})(?:-\d{2}(?:-\d{2})?)?$/);
  return match ? match[1] : null;
};
const verified = (url, hosts) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && hosts.includes(parsed.hostname.toLowerCase()) ? parsed.href : null;
  } catch { return null; }
};
const item = (title, url, source, authors, published, image, access, description) => ({
  title: tidy(title), url, source,
  snippet: [authors?.length ? "Autoría: " + authors.map(tidy).filter(Boolean).slice(0, 3).join(", ") : "",
    year(published) ? "Publicación: " + year(published) : "",
    tidy(description).slice(0, 240)].filter(Boolean).join(" · ") || "Registro bibliográfico",
  date: year(published), image: image || null,
  ...(access ? { bookAccess: access } : {})
});
async function fetchJson(url) {
  const response = await fetch(url, {headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS)});
  if (!response.ok) throw new Error("book_provider_http_" + response.status);
  const raw = await response.text();
  if (raw.length > LIMIT_BYTES) throw new Error("book_provider_too_large");
  return JSON.parse(raw);
}
export const BOOK_SOURCES = Object.freeze(["Open Library", "Google Books", "Library of Congress", "Project Gutenberg", "Internet Archive"]);

// No API key needed for public volumes; an optional server-side key can improve
// managed quota, but is NEVER sent to the browser.
export async function googleBooks(query) {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  const params = {q: query, maxResults: "20", printType: "books", country: "MX"};
  if (process.env.GOOGLE_BOOKS_API_KEY) params.key = process.env.GOOGLE_BOOKS_API_KEY;
  url.search = new URLSearchParams(params).toString();
  const payload = await fetchJson(url);
  return (Array.isArray(payload.items) ? payload.items : []).flatMap(volume => {
    const id = typeof volume.id === "string" && /^[A-Za-z0-9_-]{2,80}$/.test(volume.id) ? volume.id : null;
    const info = volume.volumeInfo || {};
    if (!id || typeof info.title !== "string" || !info.title.trim() || (info.printType && info.printType !== "BOOK")) return [];
    const cover = verified(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail, ["books.google.com", "books.googleusercontent.com", "lh3.googleusercontent.com", "books.google.es", "books.google.com.mx"]);
    const view = volume.accessInfo?.viewability;
    const access = view === "PARTIAL" ? "Vista previa parcial en origen" :
      view === "ALL_PAGES" ? "Consulta de páginas en origen (verifica condiciones)" : null;
    return [item(info.title, "https://books.google.com/books?id=" + encodeURIComponent(id),
      "Google Books", Array.isArray(info.authors) ? info.authors : [], info.publishedDate,
      cover, access, info.publisher || "")];
  });
}

// Gutendex is a third-party metadata service for Project Gutenberg. Its
// public API is not a production-scale hosting guarantee.
export async function projectGutenberg(query) {
  const url = new URL("https://gutendex.com/books/");
  url.search = new URLSearchParams({search: query}).toString();
  const data = await fetchJson(url);
  return (Array.isArray(data.results) ? data.results : []).flatMap(book => {
    if (!Number.isSafeInteger(book.id) || book.id < 1 || !tidy(book.title)) return [];
    const authors = Array.isArray(book.authors) ? book.authors.map(author => author?.name).filter(name => typeof name === "string") : [];
    const cover = verified(book.formats?.["image/jpeg"], ["www.gutenberg.org", "gutenberg.org", "www.gutenberg.net", "gutenberg.net"]);
    // US copyright status is not global; never claim Mexican public-domain status.
    const access = book.copyright === false
      ? "Texto en Project Gutenberg · verifica derechos aplicables en tu país" : null;
    return [item(book.title, "https://www.gutenberg.org/ebooks/" + book.id,
      "Project Gutenberg", authors, null, cover, access,
      Array.isArray(book.subjects) ? book.subjects.slice(0, 2).join("; ") : "")];
  });
}

// This is the digitized books/printed-material API, not the entire LoC catalog.
export async function congressBooks(query) {
  const url = new URL("https://www.loc.gov/books/");
  url.search = new URLSearchParams({q: query, fo: "json", at: "results", c: "15"}).toString();
  const data = await fetchJson(url);
  return (Array.isArray(data.results) ? data.results : []).flatMap(entry => {
    const canonical = verified(entry.id, ["www.loc.gov", "loc.gov"]);
    const title = typeof entry.title === "string" ? entry.title : Array.isArray(entry.title) ? entry.title[0] : "";
    if (!canonical || !tidy(title)) return [];
    const authors = Array.isArray(entry.contributor) ? entry.contributor : [];
    const cover = verified(Array.isArray(entry.image_url) ? entry.image_url[0] : null,
      ["www.loc.gov", "loc.gov", "tile.loc.gov", "cdn.loc.gov"]);
    return [item(title, canonical, "Library of Congress",
      authors, entry.date, cover, null,
      Array.isArray(entry.description) ? entry.description[0] : entry.description || "")];
  });
}

// Internet Archive search exposes metadata about texts, not guaranteed free
// access or download. Lucene syntax is escaped instead of trusting user input.
const archiveQuery = query => '"' + String(query).replace(/[+\-&|!(){}\[\]^~*?:\\/"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) + '" AND mediatype:texts';
export async function internetArchiveBooks(query) {
  const url = new URL("https://archive.org/advancedsearch.php");
  url.search = new URLSearchParams({
    q: archiveQuery(query), "fl[]": "identifier", rows: "16", page: "1",
    output: "json"
  }).toString();
  // Select fields with repeated query parameters to avoid relying on
  // unspecified response defaults for advancedsearch.php.
  for (const field of ["title", "creator", "year", "date", "description", "mediatype"])
    url.searchParams.append("fl[]", field);
  const data = await fetchJson(url);
  return (Array.isArray(data.response?.docs) ? data.response.docs : []).flatMap(doc => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/.test(doc.identifier || "") || !tidy(doc.title) ||
      (doc.mediatype && doc.mediatype !== "texts")) return [];
    const authors = Array.isArray(doc.creator) ? doc.creator : typeof doc.creator === "string" ? [doc.creator] : [];
    const name = doc.identifier;
    const cover = "https://archive.org/services/img/" + encodeURIComponent(name);
    return [item(doc.title, "https://archive.org/details/" + encodeURIComponent(name),
      "Internet Archive", authors, doc.year || doc.date, cover, null,
      "Texto digitalizado · acceso sujeto a derechos y disponibilidad")];
  });
}
