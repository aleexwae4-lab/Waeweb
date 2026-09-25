// WAE WEB Research Core: deterministic evidence orchestration, not generative AI.
const fold = text => String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
export const normalizeNaturalQuery=text=>String(text??"").normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim().slice(0,180);
const SPELLING=new Map([["githup","github"],["gitub","github"],["mercadolibre","mercado libre"],["wikipeda","wikipedia"],["youtub","youtube"],["oxxo","OXXO"],["whatsap","WhatsApp"],["facebok","Facebook"],["instagran","Instagram"]]);
export function correctQuery(text){
  const raw=normalizeNaturalQuery(text),parts=raw.split(/(\s+)/);
  let changed=false;
  const corrected=parts.map(part=>{const replacement=SPELLING.get(fold(part));if(!replacement)return part;changed=changed||replacement!==part;return replacement;}).join("");
  return {query:corrected,changed,original:raw,suggestion:changed?corrected:null};
}
export function classifyIntent(text){
  const q=fold(text);
  if(/\b(?:mapa|cerca de mi|cerca|direccion|ubicacion|restaurante|banco|cine|gasolinera|oxxo|farmacia|hotel)\b/.test(q))return "local";
  if(/\b(?:comprar|precio|oferta|tienda|producto|marketplace)\b/.test(q))return "shopping";
  if(/\b(?:noticias?|hoy|ultima hora|actualidad)\b/.test(q))return "news";
  if(/\b(?:imagenes?|fotos?|fotografias?)\b/.test(q))return "images";
  if(/\b(?:videos?|youtube|tiktok)\b/.test(q))return "videos";
  if(/\b(?:doi|paper|articulo cientifico|investigacion|estudio|journal)\b/.test(q))return "research";
  if(/^(?:https?:\/\/|www\.)/.test(q)||/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/.test(q)||/\b(?:sitio oficial|pagina oficial|web oficial|iniciar sesion)\b/.test(q))return "navigation";
  return "information";
}
export const tokens = text => [...new Set(fold(text).match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 30);

// Query understanding is deliberately local and deterministic. It does not
// send the user's text to an LLM or claim semantic understanding that WAEWEB
// cannot verify. These signals are safe to expose as an explanation of how a
// query was interpreted and can later feed a separately audited reranker.
const SPELLING_TERMS = Object.freeze([
  "amazon","chatgpt","facebook","farmacia","gasolinera","github","google",
  "guadalajara","instagram","mercado","mexico","openai","oxxo","restaurante",
  "tiktok","wikipedia","whatsapp","youtube","zapopan"
]);
const QUERY_ALIASES = Object.freeze({
  auto:["automovil","coche"],automovil:["auto","coche"],coche:["auto","automovil"],
  celular:["telefono","smartphone"],telefono:["celular","smartphone"],
  computadora:["ordenador","pc"],ordenador:["computadora","pc"],
  oxxo:["tienda","conveniencia"],farmacia:["medicamentos"],
  gasolinera:["combustible","gasolina"]
});
function editDistance(a,b){
  const left=[...fold(a)],right=[...fold(b)];
  const row=Array.from({length:right.length+1},(_,i)=>i);
  for(let i=1;i<=left.length;i++){
    let diagonal=row[0];row[0]=i;
    for(let j=1;j<=right.length;j++){
      const above=row[j],cost=left[i-1]===right[j-1]?0:1;
      row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+cost);diagonal=above;
    }
  }
  return row[right.length];
}
export function spellingSuggestion(value){
  const input=String(value??"").trim();
  if(!input||/(?:^|\s)(?:site|source|after|before):|"|(?:^|\s)-\p{L}/iu.test(input))return null;
  const parts=input.split(/\s+/);let changed=false;
  const corrected=parts.map(part=>{
    const bare=fold(part).replace(/[^\p{L}\p{N}]/gu,"");
    if(bare.length<4||SPELLING_TERMS.includes(bare))return part;
    let best=null,bestDistance=Infinity;
    for(const term of SPELLING_TERMS){
      const distance=editDistance(bare,term);
      if(distance<bestDistance){best=term;bestDistance=distance;}
    }
    const limit=bare.length>=8?2:1;
    if(bestDistance>limit)return part;
    changed=true;return best==="mexico"?"México":best;
  });
  const suggestion=corrected.join(" ");
  return changed&&fold(suggestion)!==fold(input)?suggestion:null;
}
export function expandQueryAliases(value){
  const found=[];
  for(const term of tokens(value))for(const alias of QUERY_ALIASES[term]||[])
    if(!found.includes(alias))found.push(alias);
  return found.slice(0,6);
}
export function detectQueryLanguage(value){
  const input=fold(value),words=tokens(input);
  if(/[¿¡ñ]/i.test(String(value||""))||words.some(word=>
    ["como","donde","que","para","cerca","comprar","noticias","imagenes"].includes(word)))return "es";
  if(words.some(word=>["how","where","what","near","buy","news","images"].includes(word)))return "en";
  return "und";
}
const LOCAL_TERMS=/\b(?:cerca de mi|cerca|abierto ahora|restaurante|farmacia|gasolinera|banco|cine|tienda|sucursal|direccion|mapa|ruta)\b/i;
export function classifyQueryIntent(value){
  const query=fold(value).trim();
  if(!query)return "unknown";
  if(calculationAnswer(query))return "calculation";
  if(/\b(?:noticias?|ultima hora|actualidad)\b/.test(query))return "news";
  if(/\b(?:imagenes?|fotos?|fotografias?|logo)\b/.test(query))return "image";
  if(/\b(?:videos?|youtube|tiktok)\b/.test(query))return "video";
  if(/\b(?:doi|paper|articulo cientifico|investigacion|estudio|bibliografia)\b/.test(query))return "research";
  if(LOCAL_TERMS.test(query)||/\b(?:en|de)\s+[a-z]{3,}(?:\s+[a-z]{3,})?$/.test(query))return "local";
  if(/\b(?:comprar|precio|oferta|tienda|producto|servicio)\b/.test(query))return "purchase";
  if(/^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}/.test(query)||
     SPELLING_TERMS.includes(query)||query.split(/\s+/).length<=2&&
     ["mercado libre"].includes(query))return "navigation";
  if(/^(?:que|quien|como|cuando|donde|por que|cual|what|who|how|when|where)\b/.test(query))return "information";
  return "general";
}
function numberLabel(value){
  const rounded=Math.abs(value)<1e-12?0:Number(value.toPrecision(12));
  return new Intl.NumberFormat("es-MX",{maximumFractionDigits:10}).format(rounded);
}
function evaluateArithmetic(expression){
  const compact=expression.replace(/\s+/g,"").replace(/,/g,".");
  if(!compact||compact.length>80||!/^[0-9.+\-*/^()]+$/.test(compact))return null;
  const pieces=compact.match(/\d+(?:\.\d+)?|[()+\-*/^]/g)||[];
  if(pieces.join("")!==compact||pieces.length>50)return null;
  let cursor=0;
  const primary=()=>{
    const token=pieces[cursor++];
    if(token==="+")return primary();
    if(token==="-")return -primary();
    if(token==="("){
      const value=sum();if(pieces[cursor++]!==")")throw Error("parenthesis");return value;
    }
    const number=Number(token);if(!Number.isFinite(number))throw Error("number");return number;
  };
  const power=()=>{let value=primary();while(pieces[cursor]==="^"){cursor++;value**=power();}return value;};
  const product=()=>{let value=power();while(pieces[cursor]==="*"||pieces[cursor]==="/"){
    const op=pieces[cursor++],right=power();if(op==="/"&&right===0)throw Error("zero");
    value=op==="*"?value*right:value/right;
  }return value;};
  const sum=()=>{let value=product();while(pieces[cursor]==="+"||pieces[cursor]==="-"){
    const op=pieces[cursor++],right=product();value=op==="+"?value+right:value-right;
  }return value;};
  try{const value=sum();return cursor===pieces.length&&Number.isFinite(value)?value:null;}catch{return null;}
}
const UNIT_GROUPS=Object.freeze({
  m:{kind:"longitud",factor:1,label:"m"},metro:{kind:"longitud",factor:1,label:"m"},metros:{kind:"longitud",factor:1,label:"m"},
  km:{kind:"longitud",factor:1000,label:"km"},kilometro:{kind:"longitud",factor:1000,label:"km"},kilometros:{kind:"longitud",factor:1000,label:"km"},
  mi:{kind:"longitud",factor:1609.344,label:"mi"},milla:{kind:"longitud",factor:1609.344,label:"mi"},millas:{kind:"longitud",factor:1609.344,label:"mi"},
  ft:{kind:"longitud",factor:.3048,label:"ft"},pie:{kind:"longitud",factor:.3048,label:"ft"},pies:{kind:"longitud",factor:.3048,label:"ft"},
  kg:{kind:"masa",factor:1,label:"kg"},kilogramo:{kind:"masa",factor:1,label:"kg"},kilogramos:{kind:"masa",factor:1,label:"kg"},
  g:{kind:"masa",factor:.001,label:"g"},gramo:{kind:"masa",factor:.001,label:"g"},gramos:{kind:"masa",factor:.001,label:"g"},
  lb:{kind:"masa",factor:.45359237,label:"lb"},libra:{kind:"masa",factor:.45359237,label:"lb"},libras:{kind:"masa",factor:.45359237,label:"lb"}
});
export function calculationAnswer(value){
  let query=fold(value).trim().replace(/[?¿]/g,"");
  query=query.replace(/^(?:cuanto es|calcula|calcular)\s+/,"");
  const conversion=query.match(/^([+-]?\d+(?:[.,]\d+)?)\s*([a-z]+)\s+(?:a|en)\s+([a-z]+)$/);
  if(conversion){
    const amount=Number(conversion[1].replace(",",".")),from=UNIT_GROUPS[conversion[2]],to=UNIT_GROUPS[conversion[3]];
    if(from&&to&&from.kind===to.kind&&Number.isFinite(amount)){
      const result=amount*from.factor/to.factor;
      return {kind:"conversion",label:"Conversión local",value:numberLabel(result)+" "+to.label,
        expression:numberLabel(amount)+" "+from.label+" = "+numberLabel(result)+" "+to.label,
        source:"Motor determinista WAEWEB",disclaimer:"Conversión matemática; no utiliza tipos de cambio ni una API externa."};
    }
  }
  const temperature=query.match(/^([+-]?\d+(?:[.,]\d+)?)\s*(?:°\s*)?(c|f|celsius|fahrenheit)\s+(?:a|en)\s+(c|f|celsius|fahrenheit)$/);
  if(temperature){
    const amount=Number(temperature[1].replace(",",".")),from=temperature[2][0],to=temperature[3][0];
    if(from!==to&&Number.isFinite(amount)){
      const result=from==="c"?amount*9/5+32:(amount-32)*5/9;
      return {kind:"conversion",label:"Conversión de temperatura",value:numberLabel(result)+" °"+to.toUpperCase(),
        expression:numberLabel(amount)+" °"+from.toUpperCase()+" = "+numberLabel(result)+" °"+to.toUpperCase(),
        source:"Motor determinista WAEWEB",disclaimer:"Conversión matemática local."};
    }
  }
  const arithmetic=evaluateArithmetic(query);
  return arithmetic===null?null:{kind:"calculation",label:"Cálculo local",value:numberLabel(arithmetic),
    expression:query+" = "+numberLabel(arithmetic),source:"Motor determinista WAEWEB",
    disclaimer:"Resultado calculado localmente; comprueba cifras críticas antes de utilizarlas."};
}
export function analyzeQuery(value){
  const normalized=String(value??"").normalize("NFKC").replace(/\s+/g," ").trim().slice(0,180);
  return {normalized,folded:fold(normalized),language:detectQueryLanguage(normalized),
    intent:classifyQueryIntent(normalized),suggestion:spellingSuggestion(normalized),
    aliases:expandQueryAliases(normalized),answer:calculationAnswer(normalized)};
}
function validDate(value) {
  if (!/^\d{4}(?:-\d{2}-\d{2})?$/.test(value)) return null;
  const full = value.length === 4 ? value + "-01-01" : value;
  const date = new Date(full + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === full ? full : null;
}
export function parseQuery(raw) {
  const input = normalizeNaturalQuery(raw);
  const siteMatch = input.match(/(?:^|\s)site:([a-z0-9.-]+\.[a-z]{2,})(?=\s|$)/i);
  const afterMatch = input.match(/(?:^|\s)after:(\d{4}(?:-\d{2}-\d{2})?)(?=\s|$)/i);
  const beforeMatch = input.match(/(?:^|\s)before:(\d{4}(?:-\d{2}-\d{2})?)(?=\s|$)/i);
  const sourceMatch = input.match(/(?:^|\s)source:(wikipedia|crossref|openalex|openlibrary|googlebooks|google|loc|gutenberg|internetarchive|wikimedia|wikidata|europepmc|gdelt|searxng|stackoverflow|superuser|mdn|github|gitlab|crates|brave|pinterest)(?=\s|$)/i);
  const excludes = [...input.matchAll(/(?:^|\s)-([\p{L}\p{N}]{2,})(?=\s|$)/gu)].map(x => fold(x[1])).slice(0, 8);
  const phrases = [...input.matchAll(/"([^"]{2,80})"/g)].map(x => fold(x[1])).slice(0, 3);
  const query = input
    .replace(/(?:^|\s)site:[a-z0-9.-]+\.[a-z]{2,}(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)(?:after|before):\d{4}(?:-\d{2}-\d{2})?(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)source:(?:wikipedia|crossref|openalex|openlibrary|googlebooks|google|loc|gutenberg|internetarchive|wikimedia|wikidata|europepmc|gdelt|searxng|stackoverflow|superuser|mdn|github|gitlab|crates|brave|pinterest)(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)-[\p{L}\p{N}]{2,}(?=\s|$)/gu, " ")
    .replace(/"/g, " ")
    .replace(/\s+/g, " ").trim();
  const correction=correctQuery(query);
  return {
    input, query: correction.query, originalQuery: query, correction, intent: classifyIntent(correction.query), site: siteMatch?.[1].toLowerCase() || null,
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
const SOURCE_ALIASES = {googlebooks:"google books",loc:"library of congress",
  gutenberg:"project gutenberg",internetarchive:"internet archive",
  stackoverflow:"stack overflow",superuser:"super user",mdn:"mdn web docs"};
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
  if (spec.source && !sourceName(item.source).replace(/\s+/g,"")
    .includes((SOURCE_ALIASES[spec.source] || spec.source).replace(/\s+/g,""))) return false;
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
    let host="";try{host=new URL(item.url).hostname.toLowerCase().replace(/^www\./,"");}catch{}
    const trusted=/^(?:github\.com|wikipedia\.org|wikidata\.org|openai\.com|microsoft\.com|apple\.com|mozilla\.org|developer\.mozilla\.org|gob\.mx|unam\.mx)$/.test(host)||/\.gob\.mx$|\.edu$|\.edu\.mx$/.test(host);
    if(trusted && !/(?:^|\.)(?:wikidata|wikipedia)\.org$/.test(host))score+=4;
    if(/(?:^|\.)(?:blogspot\.com|wordpress\.com)$/.test(host))score-=1;
    const spam=/(?:casino|apuestas|viagra|crypto giveaway|descarga gratis crack|click here)/i.test([item.title,item.snippet].join(" "));
    if(spam)score-=20;
    if(item.date){
      const t=Date.parse(item.date);if(Number.isFinite(t)){const age=(Date.now()-t)/86400000;if(age>=0)score+=Math.max(0,4-Math.log10(age+1)*1.5);}
    }
    // An exact navigational match should surface the real website above
    // encyclopaedia entries, repositories and HN articles about that name.
    if(item.siteLink===true)score+=44;
    const origin=sourceName(item.source);
    if (/brave search|google programmable search|searxng/.test(origin)) score += 10;
    else if (/wikipedia|wikidata/.test(origin)) score += 7;
    else if (/stack overflow|super user|mdn web docs/.test(origin)) score += 6;
    else if (/crossref|openalex|europe pmc/.test(origin)) score -= 4;
  }
  if (type === "videos") {
    // Platform-identified clips precede ambiguous generic video search hits,
    // without replacing keyword relevance or inventing playback metadata.
    if (item.platform === "YouTube") score += 10;
    else if (item.platform === "TikTok") score += 9;
    else if (item.platform === "Wikimedia Commons") score += 2;
  }
  if (type === "research" && /crossref|openalex|europe pmc/.test(sourceName(item.source))) score += 4;
  if (item.date && type === "news") {
    const year = Number(String(item.date).slice(0, 4));
    if (Number.isInteger(year)) score += Math.max(0, Math.min(5, year - new Date().getUTCFullYear() + 5));
  }
  let host="";
  try{host=new URL(item.url).hostname.toLowerCase().replace(/^www\./,"");}catch{}
  if(/(?:^|\.)(?:gob\.mx|gov|edu|ac\.uk)$/.test(host))score+=4;
  if(host.endsWith(".mx")&&/\b(?:mexico|jalisco|guadalajara|zapopan)\b/.test(normalizedQuery))score+=2;
  const titleTerms=fold(item.title).match(/[\p{L}\p{N}]{2,}/gu)||[];
  if(titleTerms.length>=7&&new Set(titleTerms).size/titleTerms.length<.46)score-=7;
  if(host.startsWith("xn--")||(host.match(/-/g)||[]).length>4)score-=3;
  return score;
}

function bm25Scores(items,query){
  const queryTerms=[...new Set([...tokens(query),...expandQueryAliases(query)])];
  const documents=items.map(item=>{
    const title=fold(item.title).match(/[\p{L}\p{N}]{2,}/gu)||[];
    const snippet=fold(item.snippet).match(/[\p{L}\p{N}]{2,}/gu)||[];
    return {terms:[...title,...title,...snippet],length:title.length+snippet.length};
  });
  const average=documents.reduce((sum,doc)=>sum+doc.length,0)/Math.max(1,documents.length)||1;
  return documents.map(doc=>queryTerms.reduce((score,term)=>{
    const frequency=doc.terms.reduce((sum,word)=>sum+(word===term?1:0),0);
    if(!frequency)return score;
    const containing=documents.reduce((sum,other)=>sum+(other.terms.includes(term)?1:0),0);
    const idf=Math.log(1+(documents.length-containing+.5)/(containing+.5));
    const denominator=frequency+1.2*(1-.75+.75*doc.length/average);
    return score+idf*(frequency*2.2/denominator);
  },0));
}
// Web intent must not be crowded out by encyclopedia records just because
// their entity titles match the query. Only source-backed URLs enter this
// tiering; these labels never claim independently verified website ownership.
export function webResultKind(item){
  if(item?.siteLink===true)return "named_site";
  let host="";
  try{host=new URL(item?.url).hostname.toLowerCase().replace(/^www\./,"");}
  catch{return "web_page";}
  const encyclopedia=/(?:^|\.)(?:wikipedia|wikidata)\.org$/.test(host)||
    host==="commons.wikimedia.org"||
    /^(?:wikipedia|wikidata|wikimedia commons)(?:\s|$)/.test(sourceName(item?.source));
  return encyclopedia?"encyclopedia":"web_page";
}
// Domain diversity is applied only to general web results and only when
// multiple hosts exist. It never drops pages or changes explicit site: searches.
export function diversifyWebResults(items, {limit=12,maxPerHost=2}={}) {
  const counts=new Map(), featured=[], deferred=[];
  for(const item of items){
    let host="";
    try{host=new URL(item.url).hostname.toLowerCase().replace(/^www\./,"");}catch{}
    const count=counts.get(host)||0;
    if(featured.length<limit && count<maxPerHost){
      featured.push(item);
      counts.set(host,count+1);
    }else deferred.push(item);
  }
  return [...featured,...deferred];
}
// Fair first-page exposure across independent catalogs. Preserve each
// provider's internally ranked order and return EVERY source-backed record.
export function diversifyKnowledgeResults(items){
  const buckets=new Map();
  for(const item of items){
    if(!buckets.has(item.source))buckets.set(item.source,[]);
    buckets.get(item.source).push(item);
  }
  const groups=[...buckets.values()];
  const ordered=[];
  let pending=true;
  while(pending){
    pending=false;
    for(const group of groups)if(group.length){
      ordered.push(group.shift());pending=true;
    }
  }
  return ordered;
}
export function rankResults(items, spec, type = "all") {
  const candidates=items.filter(item => eligible(item, spec));
  const lexical=bm25Scores(candidates,spec.query);
  const ranked=candidates
    .map((item, i) => ({ ...item, _score: scoreResult(item, spec.query, type)+lexical[i], _order: i }))
    .sort((a, b) => b._score - a._score || a._order - b._order)
    .map(({ _score, _order, ...item }) => item);
  if(type==="knowledge"&&!spec.source)return diversifyKnowledgeResults(ranked);
  if(type==="all"&&!spec.site&&!spec.source){
    // Preserve provider relevance and domain diversity inside each tier:
    // [named websites] -> [genuine web pages] -> [encyclopedia enrichment].
    // Diversifying the concatenated list would push encyclopedia cards ahead
    // of deferred organic pages from repeated hosts.
    const tiers=["named_site","web_page","encyclopedia"];
    return tiers.flatMap(kind=>diversifyWebResults(
      ranked.filter(item=>webResultKind(item)===kind)));
  }
  return ranked;
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
