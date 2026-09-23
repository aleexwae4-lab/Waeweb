// WAE WEB: editorial book discovery. Metadata is catalogued; ownership is NOT asserted.
import {isBookWork,openBookDetail} from "/book-experience.js";

const el=(tag,css,value)=>{
  const node=document.createElement(tag);
  if(css)node.className=css;
  if(value!==undefined)node.textContent=String(value??"");
  return node;
};
const action=(label,fn,css)=>{
  const node=el("button",css,label);
  node.type="button";
  node.addEventListener("click",fn);
  return node;
};
function info(item){
  const authors=String(item.snippet||"").match(/(?:^| · )Autoría:\s*([^·]+)/)?.[1]?.trim();
  return authors||"Autoría no indicada en el catálogo";
}
function cover(item,open){
  const holder=action("",open,"wae-library-cover-action");
  holder.setAttribute("aria-label","Ver ficha de "+item.title);
  if(/^https:\/\/(?:covers\.openlibrary\.org\/b\/id\/\d+-[SML]\.jpg|books\.google\.com\/|books\.googleusercontent\.com\/|lh3\.googleusercontent\.com\/|www\.gutenberg\.org\/|(?:www\.)?loc\.gov\/|(?:tile|cdn)\.loc\.gov\/|archive\.org\/services\/img\/[A-Za-z0-9._-]+$)/.test(item.image||"")){
    const img=el("img","wae-library-cover");
    img.src=item.image;
    img.alt="Portada de "+item.title;
    img.loading="lazy";
    img.decoding="async";
    img.referrerPolicy="no-referrer";
    img.addEventListener("error",()=>{
      img.remove();
      holder.classList.add("wae-library-cover-fallback");
      if(!holder.firstChild)holder.append(el("span","", "▤"));
    },{once:true});
    holder.append(img);
  }else{
    holder.classList.add("wae-library-cover-fallback");
    holder.append(el("span","", "▤"));
  }
  return holder;
}
export function renderBookCard(item,{workspace,onSaved,index=0}={}){
  if(!isBookWork(item))return null;
  const card=el("article","wae-library-book");
  card.style.setProperty("--wae-item-order",String(Math.min(index,12)));
  const open=()=>openBookDetail(item,{workspace,onSaved});
  const art=cover(item,open);
  const details=el("div","wae-library-book-copy");
  if(item.bookAccess){
    details.append(el("span","wae-library-access",item.bookAccess.includes("Vista previa")
      ?"Vista previa":"Consultar en origen"));
  }
  const title=action(item.title,open,"wae-library-title");
  details.append(title,el("p","wae-library-author",info(item)));
  if(item.date)details.append(el("p","wae-library-year",String(item.date).slice(0,4)));
  const foot=el("div","wae-library-book-foot");
  foot.append(el("span","wae-library-source","Fuente: "+item.source));
  const actions=el("div","wae-library-book-actions");
  actions.append(action("Descubrir →",open,"wae-library-open"));
  if(workspace?.has && workspace?.add){
    const saved=workspace.has(item.url);
    const save=action(saved?"◆ Guardado":"◇ Guardar",()=>{
      const result=workspace.add(item);
      if(result.ok){
        save.textContent="◆ Guardado";save.disabled=true;
        note.textContent=result.persisted===false
          ?"Guardado temporalmente en este navegador.":"Añadido a tu biblioteca.";
      }else note.textContent=result.reason||"No se pudo guardar.";
      onSaved?.(result);
    },"wae-library-save");
    save.disabled=saved;
    actions.append(save);
  }
  const note=el("p","wae-library-card-status","");
  note.setAttribute("role","status");
  details.append(foot,actions,note);
  card.append(art,details);
  return card;
}
