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
    evidenceKind: input.evidenceKind === "source_excerpt" ? "source_excerpt" : "search_snippet",
    fetchedAt: input.evidenceKind === "source_excerpt" &&
      typeof input.fetchedAt === "string" &&
      !Number.isNaN(Date.parse(input.fetchedAt)) ?
      new Date(input.fetchedAt).toISOString() : null,
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
    capture(input) {
      // Updating a previously saved hit must never create a duplicate or
      // silently turn an unavailable preview into a purported source excerpt.
      if (input?.evidenceKind !== "source_excerpt" ||
          String(input?.snippet || "").trim().length < 30)
        return { ok: false, reason: "Sin extracto original recuperado." };
      const entry = cleanEntry(input);
      if (!entry) return { ok: false, reason: "Fuente no válida." };
      const list = read();
      const previous = list.find(item => item.url === entry.url);
      if (previous) entry.savedAt = previous.savedAt;
      const next = [entry, ...list.filter(item => item.url !== entry.url)]
        .slice(0, MAX_ITEMS);
      const persisted = persist(next);
      return { ok: true, persisted, updated: Boolean(previous), size: next.length };
    },
    remove(url) {
      const next = read().filter(item => item.url !== url);
      return persist(next);
    },
    has(url) { return read().some(item => item.url === url); },
    count() { return read().length; }
  };
}
// Local-only discovery: accent-insensitive, deterministic and never sends saved
// research to a search provider or to the server.
export function filterWorkspaceEntries(entries, query="", kind="all") {
  const normalized=value=>String(value??"").toLocaleLowerCase("es")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const terms=normalized(query).trim().split(/\s+/).filter(Boolean).slice(0,12);
  return (Array.isArray(entries)?entries:[]).filter(entry=>{
    if(kind==="source_excerpt"&&entry.evidenceKind!=="source_excerpt")return false;
    if(kind==="search_snippet"&&entry.evidenceKind==="source_excerpt")return false;
    const text=normalized([entry.title,entry.source,entry.snippet,entry.url].join(" "));
    return terms.every(term=>text.includes(term));
  });
}
export function asComparisonMarkdown(entries) {
  if(!Array.isArray(entries)||entries.length!==2)throw Error("Selecciona dos fuentes.");
  const sources=entries.map(cleanEntry);
  if(sources.some(item=>!item))throw Error("Hay una fuente no válida.");
  const lines=["# Comparación documental WAE WEB","",
    "Esta comparación reúne dos textos guardados. No determina si sus afirmaciones son verdaderas ni si coinciden.",""];
  sources.forEach((item,index)=>{
    lines.push("## Fuente "+(index+1)+": "+item.title.replace(/[\r\n]/g," "),"",
      "- Procedencia: "+item.source,
      "- Dirección original: "+item.url,
      "- Fecha de publicación: "+(item.date||"No informada"),
      "- Evidencia: "+(item.evidenceKind==="source_excerpt"
        ?"Extracto recuperado de la página original":"Fragmento del resultado de búsqueda"),
      "- Fecha de recuperación: "+(item.fetchedAt||"No informada"),"",
      item.snippet||"Sin texto guardado.","");
  });
  return lines.join("\n");
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
      "- Guardado: " + (entry.savedAt || "No informado"),
      "- Tipo: " + (entry.evidenceKind === "source_excerpt"
        ? "Extracto recuperado de la página original"
        : "Fragmento del resultado de búsqueda"),
      ...(entry.evidenceKind === "source_excerpt"
        ? ["- Recuperado: " + (entry.fetchedAt || "Fecha no informada")] : []), "",
      entry.snippet, "");
  }
  return rows.join("\n");
}
