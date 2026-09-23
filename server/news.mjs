// WAE WEB public news federation. No untrusted URLs are fetched; only fixed HTTPS RSS endpoints.
const HEADERS={accept:"application/rss+xml, application/xml, text/xml;q=0.9",
  "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"};
export const NEWS_WINDOWS=Object.freeze({"24h":86400000,"7d":604800000,"30d":2592000000});
const PUBLIC_FEEDS=Object.freeze([
  {name:"BBC Mundo · RSS",url:"https://www.bbc.com/mundo/index.xml",publisher:"BBC Mundo"},
  {name:"El País · RSS",url:"https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada",publisher:"El País"}
]);
const tidy=text=>String(text??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const decodeEntities=text=>String(text??"").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity)=>{
  const named={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "};
  if(entity.startsWith("#")){
    const n=entity[1].toLowerCase()==="x"?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
    return n>0&&n<=0x10ffff&&! (n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):"";
  }
  return named[entity.toLowerCase()]??"";
});
const textValue=value=>tidy(decodeEntities(decodeEntities(String(value??"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")))).slice(0,1000);
const field=(item,tag)=>{
  const m=item.match(new RegExp("<"+tag+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+tag+">","i"));
  return m?textValue(m[1]):"";
};
const xmlSafeUrl=value=>{
  try{const u=new URL(value);return u.protocol==="https:"?u.href:null;}
  catch{return null;}
};
export function normalizeNewsDate(value){
  const input=String(value||"").trim();
  const gdelt=input.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const parsed=Date.parse(gdelt
    ?gdelt[1]+"-"+gdelt[2]+"-"+gdelt[3]+"T"+gdelt[4]+":"+gdelt[5]+":"+gdelt[6]+"Z"
    :input);
  // Bad or far-future clocks cannot be presented as live publication times.
  if(!Number.isFinite(parsed)||parsed>Date.now()+15*60000||parsed<946684800000)return null;
  return new Date(parsed).toISOString();
}
const matchesQuery=(text,query)=>{
  const normalized=value=>value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const terms=normalized(query).match(/[\p{L}\p{N}]{3,}/gu)||[];
  if(!terms.length)return false;
  const haystack=normalized(text);
  return terms.some(term=>haystack.includes(term));
};
export function parseNewsFeed(xml,{source,publisher,query="",window="7d",now=Date.now(),filter=false}={}){
  if(typeof xml!=="string"||!/<(?:rss|feed)\b/i.test(xml))throw new Error("news_invalid_feed");
  const items=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,100);
  const age=NEWS_WINDOWS[window]||NEWS_WINDOWS["7d"];
  const found=[];
  for(const [,item] of items){
    const title=field(item,"title"),url=xmlSafeUrl(field(item,"link"));
    const published=normalizeNewsDate(field(item,"pubDate")||field(item,"published")||field(item,"dc:date"));
    if(!title||!url||!published)continue;
    const publishedAt=Date.parse(published);
    if(publishedAt<now-age||publishedAt>now+15*60000)continue;
    const description=field(item,"description")||field(item,"summary");
    if(filter&&!matchesQuery(title+" "+description,query))continue;
    const outlet=field(item,"source")||publisher||"Medio no identificado";
    const entry={title:title.slice(0,240),url,snippet:description.slice(0,650),
      source:source==="Google News"?"Google News · "+outlet:source,
      publisher:outlet,date:published,image:null,newsDateKind:"published"};
    found.push(entry);
    if(found.length>=20)break;
  }
  return found;
}
async function fetchFeed(url,opts){
  const response=await fetch(url,{headers:HEADERS,signal:AbortSignal.timeout(5800)});
  if(!response.ok)throw new Error("news_feed_status_"+response.status);
  const body=await response.text();
  if(body.length>1600000)throw new Error("news_feed_too_large");
  return parseNewsFeed(body,opts);
}
export function newsFeedSources(query,window="7d"){
  const when={"24h":"1d","7d":"7d","30d":"30d"}[window]||"7d";
  const editions=[
    {name:"Google News · México",hl:"es-419",gl:"MX",ceid:"MX:es-419"},
    {name:"Google News · Internacional",hl:"en-US",gl:"US",ceid:"US:en"}
  ];
  return [
    ...editions.map(edition=>[edition.name,()=>{
      const url=new URL("https://news.google.com/rss/search");
      url.search=new URLSearchParams({q:query+" when:"+when,hl:edition.hl,gl:edition.gl,ceid:edition.ceid}).toString();
      return fetchFeed(url,{source:"Google News",query,window});
    }]),
    ...PUBLIC_FEEDS.map(feed=>[feed.name,()=>fetchFeed(feed.url,{
      source:feed.name,publisher:feed.publisher,query,window,filter:true
    })])
  ];
}
export function rankNewsResults(results,query,window="7d",now=Date.now()){
  const age=NEWS_WINDOWS[window]||NEWS_WINDOWS["7d"];
  const seenUrls=new Set(),seenTitles=new Set();
  return results.filter(item=>{
    const url=xmlSafeUrl(item.url);
    if(!url||!item.title)return false;
    const when=normalizeNewsDate(item.date||item.seenAt);
    if(when&&(Date.parse(when)<now-age||Date.parse(when)>now+15*60000))return false;
    const key=url.replace(/#.*$/,"").replace(/([?&])utm_[^&]+/gi,"$1");
    const title=tidy(item.title).toLocaleLowerCase("es").replace(/\s+[-–|]\s+[^-–|]{2,55}$/,"");
    if(seenUrls.has(key)||seenTitles.has(title))return false;
    seenUrls.add(key);seenTitles.add(title);return true;
  }).sort((a,b)=>{
    const date=value=>Date.parse(normalizeNewsDate(value.date||value.seenAt)||"")||0;
    const dt=date(b)-date(a);
    if(dt)return dt;
    const score=item=>{
      const terms=query.toLocaleLowerCase("es").match(/[\p{L}\p{N}]{3,}/gu)||[];
      const text=tidy(item.title).toLocaleLowerCase("es");
      return terms.filter(term=>text.includes(term)).length;
    };
    return score(b)-score(a);
  }).slice(0,80);
}
