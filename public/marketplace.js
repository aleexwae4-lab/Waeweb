// Public read-only WAEWEB Marketplace; textContent only for user-provided text.
const byId = id => document.getElementById(id);
const pane = byId("marketplace-view"), results = byId("marketplace-results");
let page = 1, more = false, requestNumber = 0;
const el = (tag, css, content) => {
  const node = document.createElement(tag);
  if (css) node.className = css;
  if (content != null) node.textContent = String(content);
  return node;
};
function formatPrice(item) {
  return item.priceCents == null ? "Consultar precio" :
    new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" })
      .format(item.priceCents / 100);
}
export function listingCard(item) {
  const card = el("article","market-card");
  if (item.imageDataUrl?.startsWith("data:image/")) {
    const img = el("img","market-photo");
    img.src = item.imageDataUrl;
    img.alt = "Fotografía de " + item.title;
    img.loading = "lazy";
    card.append(img);
  } else card.append(el("div","market-photo market-placeholder","▦"));
  const body = el("div","market-card-body");
  body.append(
    el("p","tag",item.kind === "service" ? "SERVICIO" : "PRODUCTO"),
    el("h3","",item.title),
    el("p","market-price",formatPrice(item)),
    el("p","business-meta",item.category + " · " + item.city),
    el("p","business-desc",item.description),
    el("p","business-fineprint",
      item.availability === "available" ? "Disponible (declarado)" : "No disponible")
  );
  const a = el("a","business-primary market-profile-link","Ver perfil de empresa →");
  a.href = "/?business=" + encodeURIComponent(item.businessId);
  body.append(a); card.append(body);
  return card;
}
function show() {
  for (const id of ["hero","results-view","account-view","business-profile-view","browser-view"]) {
    const section = byId(id); if(section) section.hidden = true;
  }
  pane.hidden = false;
  window.scrollTo({top:0,behavior:"smooth"});
  search(true);
}
function close() { pane.hidden = true; byId("hero").hidden = false; }
async function search(reset=false) {
  if (reset) page=1;
  const serial=++requestNumber;
  const params=new URLSearchParams(new FormData(byId("marketplace-search")));
  params.set("page",String(page));
  byId("marketplace-status").textContent="Buscando publicaciones…";
  byId("marketplace-prev").hidden=true;
  byId("marketplace-next").hidden=true;
  try {
    const response=await fetch("/api/marketplace?"+params.toString(),{
      headers:{accept:"application/json"},cache:"no-store",credentials:"omit"});
    const data=await response.json();
    if (!response.ok) throw Error(data.error || "Marketplace no disponible.");
    if (serial!==requestNumber || pane.hidden) return;
    results.replaceChildren();
    for(const item of data.items) results.append(listingCard(item));
    if(!data.items.length) results.append(el("p","business-empty",
      "No hay publicaciones que coincidan. Prueba otra búsqueda o ciudad."));
    more=data.hasMore===true;
    byId("marketplace-prev").hidden=page===1;
    byId("marketplace-next").hidden=!more;
    byId("marketplace-page").textContent="Página "+page;
    byId("marketplace-status").textContent=data.total+" publicaciones encontradas. "+
      "Anuncios autodeclarados; consulta directamente a la empresa.";
  } catch(e) {
    if(serial!==requestNumber) return;
    results.replaceChildren();
    byId("marketplace-status").textContent=e.message || "No se pudo consultar Marketplace.";
  }
}
byId("marketplace-button").addEventListener("click",show);
byId("hero-marketplace").addEventListener("click",show);
byId("marketplace-explore-owner").addEventListener("click",show);
byId("marketplace-back").addEventListener("click",close);
byId("marketplace-search").addEventListener("submit",e=>{e.preventDefault();search(true);});
byId("marketplace-prev").addEventListener("click",()=>{if(page>1){page--;search();}});
byId("marketplace-next").addEventListener("click",()=>{if(more&&page<30){page++;search();}});
for (const id of ["home-button","account-button","hero-account-button","browser-open","hero-browser"])
  byId(id)?.addEventListener("click",()=>{pane.hidden=true;requestNumber++;});
for(const id of ["hero-form","results-form"])
  byId(id)?.addEventListener("submit",()=>{pane.hidden=true;requestNumber++;});
