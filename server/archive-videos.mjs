// Source-verified playable videos from Internet Archive's public search and
// item metadata APIs. No third-party scraping, inferred file URLs or licensing.
const ID=/^[A-Za-z0-9][A-Za-z0-9_.-]{2,99}$/;
const MEDIA=/\.(?:mp4|m4v|webm|ogv)$/i;
const VIDEO_HEADERS={accept:"application/json",
  "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"};
const clean=value=>String(value??"").replace(/<[^>]*>/g," ")
  .replace(/\s+/g," ").trim().slice(0,550);
const https=value=>{try{const u=new URL(value);
  return u.protocol==="https:"&&!u.username&&!u.password?u.href:null;
}catch{return null;}};
async function archiveJson(url){
  const response=await fetch(url,{headers:VIDEO_HEADERS,redirect:"error",
    signal:AbortSignal.timeout(6400)});
  if(!response.ok)throw Error("archive_video_status_"+response.status);
  const raw=await response.text();
  if(raw.length>1350000)throw Error("archive_video_response_too_large");
  return JSON.parse(raw);
}
function filename(value){
  if(typeof value!=="string"||value.length>240||
    /[\0\\?#]/.test(value)||value.startsWith("/")||
    value.split("/").some(part=>!part||part==="."||part===".."||/%2f|%5c/i.test(part)))
    return null;
  return value.split("/").map(encodeURIComponent).join("/");
}
const dateValue=value=>typeof value==="string"&&
  /^\d{4}(-\d{2}(-\d{2})?)?/.test(value)?value.slice(0,10):null;
export async function internetArchiveVideos(query){
  const words=String(query||"").normalize("NFKC").match(/[\p{L}\p{N}]{3,}/gu)||[];
  if(!words.length)return [];
  const url=new URL("https://archive.org/advancedsearch.php");
  const params=new URLSearchParams({
    q:"mediatype:movies AND ("+words.slice(0,6).join(" AND ")+")",
    rows:"10",page:"1",output:"json"
  });
  params.append("fl[]","identifier");
  params.append("fl[]","title");
  url.search=params.toString();
  const data=await archiveJson(url);
  if(!Array.isArray(data.response?.docs))throw Error("archive_video_invalid_search");
  const candidates=data.response.docs.slice(0,7).filter(x=>ID.test(x.identifier||""));
  const results=await Promise.allSettled(candidates.map(async item=>{
    const id=item.identifier;
    const metadata=await archiveJson("https://archive.org/metadata/"+encodeURIComponent(id));
    if(metadata.is_dark||metadata.metadata?.mediatype!=="movies"||
      !Array.isArray(metadata.files))return null;
    const files=metadata.files.filter(f=>filename(f.name)&&MEDIA.test(f.name)&&
      (!f.size||Number(f.size)>0));
    // Only direct MP4/WebM/Ogg paths supplied by the actual item metadata.
    const video=files.find(f=>/\.(mp4|m4v)$/i.test(f.name))||
      files.find(f=>/\.webm$/i.test(f.name))||files[0];
    if(!video)return null;
    const mediaUrl="https://archive.org/download/"+encodeURIComponent(id)+"/"+filename(video.name);
    const thumb=metadata.files.find(f=>f.name==="__ia_thumb.jpg");
    const image=thumb?"https://archive.org/download/"+encodeURIComponent(id)+"/__ia_thumb.jpg":null;
    const m=metadata.metadata;
    const title=clean(m.title||item.title||id);
    if(!title)return null;
    const creator=Array.isArray(m.creator)?m.creator.join(", "):m.creator;
    return {title,url:"https://archive.org/details/"+encodeURIComponent(id),
      snippet:clean(creator||"Vídeo del catálogo público de Internet Archive"),
      source:"Internet Archive · vídeos",date:dateValue(m.date||m.publicdate),
      image,mediaUrl,platform:"Internet Archive",mime:
        /\.webm$/i.test(video.name)?"video/webm":
        /\.ogv$/i.test(video.name)?"video/ogg":"video/mp4",
      license:null,playback:"native"};
  }));
  return results.flatMap(r=>r.status==="fulfilled"&&r.value?[r.value]:[]);
}
