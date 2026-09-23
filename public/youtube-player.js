// Isolated user-initiated player: maps and browser never create this frame.
export function createYoutubeFrame(id,title){
  if(!/^[A-Za-z0-9_-]{11}$/.test(id||""))throw Error("Identificador de vídeo inválido");
  const frame=document.createElement("iframe");
  frame.className="youtube-inline-frame";
  frame.src="https://www.youtube-nocookie.com/embed/"+id;
  frame.title="Reproductor de YouTube: "+String(title||"Vídeo");
  frame.loading="lazy";
  frame.referrerPolicy="strict-origin-when-cross-origin";
  frame.allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share";
  frame.allowFullscreen=true;
  return frame;
}

// Only data-backed, click-initiated third-party embeds. Never load an
// arbitrary URL from query text or user-supplied HTML.
export function createPlatformVideoFrame(item){
  let src=null;
  if(item?.platform==="TikTok"&&/^\d{10,25}$/.test(item.videoId||""))
    src="https://www.tiktok.com/player/v1/"+item.videoId;
  if(item?.platform==="PeerTube"&&typeof item.embedUrl==="string"){
    try{
      const u=new URL(item.embedUrl),origin=new URL(item.url);
      if(u.protocol==="https:"&&u.origin===origin.origin&&
        /^\/videos\/embed\/[A-Za-z0-9_-]{12,36}$/.test(u.pathname)&&
        !u.username&&!u.password&&!u.search&&!u.hash)src=u.href;
    }catch{}
  }
  if(!src)throw Error("No hay un reproductor seguro para este vídeo.");
  const frame=document.createElement("iframe");
  frame.className="youtube-inline-frame video-inline-frame";
  frame.title="Reproductor "+item.platform+": "+String(item.title||"Vídeo");
  frame.loading="lazy";
  frame.referrerPolicy="strict-origin-when-cross-origin";
  frame.allow="autoplay; encrypted-media; picture-in-picture; fullscreen";
  frame.allowFullscreen=true;
  frame.src=src;
  return frame;
}
