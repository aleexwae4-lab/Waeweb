// WAEWEB video discovery: source-backed platform links, no scraped streams.
const videoId=/^[A-Za-z0-9_-]{11}$/;
const safeUrl=value=>{try{const u=new URL(value);return ["https:","http:"].includes(u.protocol)?u:null;}catch{return null;}};
export function videoIdentity(value){
  const u=safeUrl(value);
  if(!u)return null;
  const host=u.hostname.toLowerCase().replace(/^www\./,"").replace(/^m\./,"");
  if(host==="youtube.com"||host==="music.youtube.com"||host==="youtu.be"){
    const parts=u.pathname.split("/").filter(Boolean);
    const id=host==="youtu.be"?parts[0]
      :parts[0]==="watch"?u.searchParams.get("v")
      :["shorts","live","embed"].includes(parts[0])?parts[1]:null;
    if(!videoId.test(id||""))return null;
    return {platform:"YouTube",videoId:id,canonical:parts[0]==="shorts"
      ?"https://www.youtube.com/shorts/"+id
      :"https://www.youtube.com/watch?v="+id};
  }
  if(host==="tiktok.com"||host.endsWith(".tiktok.com")){
    const m=u.pathname.match(/^\/@[^/]+\/video\/(\d{10,25})(?:\/|$)/);
    if(!m)return null;
    return {platform:"TikTok",videoId:m[1],canonical:"https://www.tiktok.com"+m[0].replace(/\/$/,"")};
  }
  return null;
}
export function verifiedVideoResults(items,platform){
  return (items||[]).flatMap(item=>{
    const info=videoIdentity(item.url);
    if(!info||info.platform!==platform)return [];
    return [{...item,url:info.canonical,platform,videoId:info.videoId||null}];
  });
}
export async function youtubeDataVideos(query){
  const token=process.env.YOUTUBE_DATA_API_KEY?.trim();
  if(!token)return null;
  const u=new URL("https://www.googleapis.com/youtube/v3/search");
  u.search=new URLSearchParams({
    key:token,part:"snippet",type:"video",q:query,maxResults:"15",
    regionCode:"MX",relevanceLanguage:"es",safeSearch:"strict"
  }).toString();
  const res=await fetch(u,{headers:{accept:"application/json"},
    signal:AbortSignal.timeout(6500)});
  if(!res.ok)throw Error("youtube_status_"+res.status);
  const body=await res.text();
  if(body.length>2500000)throw Error("youtube_too_large");
  const data=JSON.parse(body);
  return (data.items||[]).flatMap(item=>{
    const id=item.id?.videoId,meta=item.snippet;
    if(!videoId.test(id||"")||!meta?.title)return [];
    const thumbnail=meta.thumbnails?.medium?.url||meta.thumbnails?.high?.url||meta.thumbnails?.default?.url;
    return [{
      title:String(meta.title).replace(/<[^>]*>/g," ").trim(),
      url:"https://www.youtube.com/watch?v="+id,
      snippet:[meta.channelTitle,meta.description].filter(Boolean).join(" · ").slice(0,1000),
      source:"YouTube Data API",date:meta.publishedAt||null,
      image:safeUrl(thumbnail)?.href||null,platform:"YouTube",videoId:id
    }];
  });
}

/* Match the underlying platform clip across Shorts/watch links and across
   different TikTok author URL spellings. Keep the first (provider-ranked)
   source attribution; never synthesize a clip or thumbnail. */
export function dedupeVideoResults(items){
  const seen=new Set();
  return items.filter(item=>{
    const identity=videoIdentity(item.url);
    const key=identity
      ?identity.platform+"|"+identity.videoId
      :(typeof item.url==="string"?item.url:"");
    if(!key||seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
