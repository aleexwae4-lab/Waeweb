import { listingCard } from "./marketplace.js";
const $ = id => document.getElementById(id);
const section = $("business-profile-view");
const target = $("business-profile-content");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function textNode(tag, css, value) {
  const node = document.createElement(tag);
  if (css) node.className = css;
  node.textContent = String(value ?? "");
  return node;
}
function profileAddress(id) {
  const url = new URL("/", location.origin);
  url.searchParams.set("business", id);
  return url.href;
}
function hideProfile() { section.hidden = true; target.replaceChildren(); }
async function showProfile(id) {
  $("hero").hidden = true;
  $("results-view").hidden = true;
  $("account-view").hidden = true;
  section.hidden = false;
  target.replaceChildren(textNode("p", "business-fineprint", "Consultando ficha publicada…"));
  if (!uuid.test(id)) {
    target.replaceChildren(textNode("p", "account-alert", "El enlace de negocio no es válido."));
    return;
  }
  let data;
  try {
    const response = await fetch("/api/businesses/public/" + encodeURIComponent(id), {
      headers: { accept: "application/json" }, cache: "no-store", credentials: "omit"
    });
    data = await response.json();
    if (!response.ok) throw Error(response.status === 404
      ? "Este negocio no está publicado, fue ocultado o se eliminó."
      : data.error || "No fue posible recuperar el perfil.");
  } catch (error) {
    target.replaceChildren(textNode("p", "account-alert", error.message || "Perfil no disponible."));
    return;
  }
  if (new URLSearchParams(location.search).get("business") !== id) return;
  const b = data.business;
  const card = textNode("article", "business-profile-card");
  card.append(
    textNode("p", "tag", "WAE WEB · Perfil público autodeclarado"),
    textNode("h2", "business-profile-name", b.name),
    textNode("p", "business-profile-meta", b.category + " · " + b.city),
    textNode("p", "business-fineprint", data.disclaimer)
  );
  if (b.description) card.append(textNode("p", "business-desc", b.description));
  const actions = textNode("div", "business-profile-actions");
  if (b.website) {
    try {
      const url = new URL(b.website);
      if (url.protocol === "https:" && !url.username && !url.password) {
        const link = textNode("a", "link-button", "↗ Visitar sitio declarado");
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
      }
    } catch { /* A malformed optional URL is never rendered as an active link. */ }
  }
  if (typeof b.whatsapp === "string" && /^\\+[1-9]\\d{7,14}$/.test(b.whatsapp)) {
    const contact=textNode("a","business-primary","WhatsApp comercial ↗");
    contact.href="https://wa.me/"+b.whatsapp.slice(1);
    contact.target="_blank";
    contact.rel="noopener noreferrer";
    contact.referrerPolicy="no-referrer";
    actions.append(contact);
  }
  const copy = textNode("button", "business-primary", "⧉ Compartir este perfil");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(profileAddress(id));
      copy.textContent = "✓ Enlace copiado";
    } catch {
      copy.textContent = "Copia la dirección de esta página";
    }
  });
  actions.append(copy);
  card.append(actions);
  target.replaceChildren(card);
  // Only public listings for an explicitly published business are exposed.
  const catalog = textNode("section","market-profile-catalog");
  catalog.append(textNode("h2","","Productos y servicios de esta empresa"));
  try {
    const response=await fetch("/api/businesses/public/"+encodeURIComponent(id)+"/listings",{
      headers:{accept:"application/json"},cache:"no-store",credentials:"omit"
    });
    if(!response.ok)throw Error("Catálogo no disponible.");
    const data=await response.json();
    if(new URLSearchParams(location.search).get("business")!==id)return;
    const gallery=textNode("div","market-grid");
    for(const listing of data.items)gallery.append(listingCard(listing));
    if(!data.items.length)gallery.append(textNode("p","business-fineprint",
      "Esta empresa todavía no tiene productos o servicios públicos."));
    catalog.append(gallery,textNode("p","business-fineprint",data.disclaimer));
  } catch {
    catalog.append(textNode("p","business-fineprint",
      "El catálogo no está disponible en este momento."));
  }
  if(new URLSearchParams(location.search).get("business")===id)target.append(catalog);
}
function route() {
  const id = new URLSearchParams(location.search).get("business");
  if (id) showProfile(id);
  else hideProfile();
}
$("home-button").addEventListener("click", hideProfile);
$("account-button").addEventListener("click", hideProfile);
$("hero-account-button").addEventListener("click", hideProfile);
$("hero-form").addEventListener("submit", hideProfile);
$("results-form").addEventListener("submit", hideProfile);
window.addEventListener("popstate", route);
route();
