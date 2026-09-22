const KEY = "waeweb:research-library:v1";
const MAX_ITEMS = 100;
function validUrl(url) {
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:"; }
  catch { return false; }
}
export function cleanEntry(input) {
  if (!input || !validUrl(input.url) || !String(input.title ?? "").trim()) return null;
  return {
    title: String(input.title).trim().slice(0, 280),
    url: new URL(input.url).href,
    source: String(input.source || "Fuente").slice(0, 100),
    snippet: String(input.snippet || "").slice(0, 1200),
    date: input.date ? String(input.date).slice(0, 30) : null,
    savedAt: typeof input.savedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(input.savedAt) ? input.savedAt.slice(0, 40) : new Date().toISOString()
  };
}
export function createWorkspace(storage = globalThis.localStorage) {
  let fallback = [];
  function read() {
    try {
      if (!storage) return fallback;
      const parsed = JSON.parse(storage.getItem(KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(0, MAX_ITEMS).map(cleanEntry).filter(Boolean);
    } catch { return fallback; }
  }
  function persist(list) {
    fallback = list;
    try { storage?.setItem(KEY, JSON.stringify(list)); return Boolean(storage); }
    catch { return false; }
  }
  return {
    list: () => read(),
    add(input) {
      const entry = cleanEntry(input);
      if (!entry) return { ok: false, reason: "Fuente no válida." };
      const list = read();
      if (list.some(item => item.url === entry.url)) return { ok: true, duplicate: true };
      const next = [entry, ...list].slice(0, MAX_ITEMS);
      const persisted = persist(next);
      return { ok: true, persisted, size: next.length };
    },
    remove(url) {
      const next = read().filter(item => item.url !== url);
      return persist(next);
    },
    has(url) { return read().some(item => item.url === url); },
    count() { return read().length; }
  };
}
export function asMarkdown(entries, title = "Biblioteca de investigación WAE WEB") {
  const rows = ["# " + title, "", "Exportación local. Los fragmentos se atribuyen a sus fuentes; no están verificados de forma independiente.", ""];
  for (const [i, entry] of entries.entries()) {
    const safeTitle = entry.title.replace(/[\r\n]/g, " ");
    const safeUrl = validUrl(entry.url) ? entry.url.replace(/\)/g, "%29") : null;
    if (!safeUrl) continue;
    rows.push("## " + (i + 1) + ". " + safeTitle, "",
      "- Fuente: " + entry.source,
      "- URL: " + safeUrl,
      "- Fecha publicada: " + (entry.date || "No informada"),
      "- Guardado: " + (entry.savedAt || "No informado"), "",
      entry.snippet, "");
  }
  return rows.join("\n");
}
