// WAE WEB Research Core: deterministic evidence orchestration, not generative AI.
const fold = text => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
export const tokens = text => [...new Set(fold(text).match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 30);
function validDate(value) {
  if (!/^\d{4}(?:-\d{2}-\d{2})?$/.test(value)) return null;
  const full = value.length === 4 ? value + "-01-01" : value;
  const date = new Date(full + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === full ? full : null;
}
export function parseQuery(raw) {
  const input = String(raw ?? "").trim().slice(0, 180);
  const siteMatch = input.match(/(?:^|\s)site:([a-z0-9.-]+\.[a-z]{2,})(?=\s|$)/i);
  const afterMatch = input.match(/(?:^|\s)after:(\d{4}(?:-\d{2}-\d{2})?)(?=\s|$)/i);
  const beforeMatch = input.match(/(?:^|\s)before:(\d{4}(?:-\d{2}-\d{2})?)(?=\s|$)/i);
  const sourceMatch = input.match(/(?:^|\s)source:(wikipedia|crossref|openalex|openlibrary|google|wikimedia|wikidata|europepmc|gdelt)(?=\s|$)/i);
  const excludes = [...input.matchAll(/(?:^|\s)-([\p{L}\p{N}]{2,})(?=\s|$)/gu)].map(x => fold(x[1])).slice(0, 8);
  const phrases = [...input.matchAll(/"([^"]{2,80})"/g)].map(x => fold(x[1])).slice(0, 3);
  const query = input
    .replace(/(?:^|\s)site:[a-z0-9.-]+\.[a-z]{2,}(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)(?:after|before):\d{4}(?:-\d{2}-\d{2})?(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)source:(?:wikipedia|crossref|openalex|openlibrary|google|wikimedia|wikidata|europepmc|gdelt)(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)-[\p{L}\p{N}]{2,}(?=\s|$)/gu, " ")
    .replace(/"/g, " ")
    .replace(/\s+/g, " ").trim();
  return {
    input, query, site: siteMatch?.[1].toLowerCase() || null,
    after: afterMatch ? validDate(afterMatch[1]) : null,
    before: beforeMatch ? validDate(beforeMatch[1]) : null,
    source: sourceMatch?.[1].toLowerCase() || null,
    excludes, phrases,
    errors: [
      ...(afterMatch && !validDate(afterMatch[1]) ? ["Fecha after: inválida."] : []),
      ...(beforeMatch && !validDate(beforeMatch[1]) ? ["Fecha before: inválida."] : []),
      ...(afterMatch && beforeMatch && validDate(afterMatch[1]) >= validDate(beforeMatch[1]) ? ["La fecha after: debe preceder a before:."] : [])
    ]
  };
}
const sourceName = source => fold(source || "");
function dateComparable(value) {
  if (!value) return null;
  if (/^\d{4}$/.test(value)) return value + "-01-01";
  const year = String(value).slice(0, 10);
  return validDate(year);
}
function hostMatch(url, domain) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith("." + domain);
  } catch { return false; }
}
function eligible(item, spec) {
  if (spec.site && !hostMatch(item.url, spec.site)) return false;
  if (spec.source && !sourceName(item.source).replace(/\s+/g,"").includes(spec.source)) return false;
  const searchable = fold([item.title, item.snippet].join(" "));
  if (spec.excludes.some(term => new RegExp("(^|[^\\p{L}\\p{N}])" + term + "([^\\p{L}\\p{N}]|$)", "u").test(searchable))) return false;
  if (spec.phrases.some(phrase => !searchable.includes(phrase))) return false;
  if (spec.after || spec.before) {
    const date = dateComparable(item.date);
    // Unknown dates cannot satisfy date filters. No invented publication dates.
    if (!date || (spec.after && date < spec.after) || (spec.before && date >= spec.before)) return false;
  }
  return true;
}
export function scoreResult(item, query, type = "all") {
  const terms = tokens(query);
  const title = fold(item.title);
  const snippet = fold(item.snippet);
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 5;
    if (snippet.includes(term)) score += 1;
  }
  const normalizedQuery = fold(query).trim();
  if (normalizedQuery && title.includes(normalizedQuery)) score += 10;
  // General web intent prioritizes actual pages and named entities. Papers
  // remain available under Investigación; they should not bury a direct hit.
  if (type === "all") {
    if (normalizedQuery && title === normalizedQuery) score += 18;
    const origin=sourceName(item.source);
    if (/brave search|google programmable search/.test(origin)) score += 10;
    else if (/wikipedia|wikidata/.test(origin)) score += 7;
    else if (/crossref|openalex|europe pmc/.test(origin)) score -= 4;
  }
  if (type === "research" && /crossref|openalex|europe pmc/.test(sourceName(item.source))) score += 4;
  if (item.date && type === "news") {
    const year = Number(String(item.date).slice(0, 4));
    if (Number.isInteger(year)) score += Math.max(0, Math.min(5, year - new Date().getUTCFullYear() + 5));
  }
  return score;
}
export function rankResults(items, spec, type = "all") {
  return items.filter(item => eligible(item, spec))
    .map((item, i) => ({ ...item, _score: scoreResult(item, spec.query, type), _order: i }))
    .sort((a, b) => b._score - a._score || a._order - b._order)
    .map(({ _score, _order, ...item }) => item);
}
function extractSentence(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const fragments = normalized.match(/[^.!?]+[.!?]?/g) || [];
  const first = fragments[0]?.trim() || "";
  return (first.length >= 8 ? first : normalized).slice(0, 330);
}
export function researchBrief(items, limit = 4) {
  const notes = [], domains = new Set();
  for (const item of items) {
    const sentence = extractSentence(item.snippet);
    if (!sentence || !item.url || !item.source) continue;
    let host;
    try { host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { continue; }
    if (domains.has(host)) continue;
    domains.add(host);
    notes.push({ statement: sentence, title: item.title, source: item.source, url: item.url, date: item.date || null });
    if (notes.length >= limit) break;
  }
  return {
    kind: "extractive",
    label: "Panorama documental con citas (sin IA generativa)",
    notes,
    domainsRepresented: domains.size,
    disclaimer: "Cada fragmento corresponde a su fuente. Las fuentes no se han contrastado ni verificado de manera independiente."
  };
}
