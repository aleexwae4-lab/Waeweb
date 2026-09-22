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
