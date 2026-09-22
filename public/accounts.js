const $ = id => document.getElementById(id);
const view = $("account-view");
const alertBox = $("account-alert");
let enabled = false;
let objectMedia = false;
let session = null; // Deliberately not stored in localStorage, cookies, URLs or HTML.
let profile = null;
let editingBusiness = null;
let selectedBusiness = "";
let editingListing = null;
let photoData = undefined;
let ownerRequest = 0;
const text = (node, value) => { node.textContent = String(value ?? ""); return node; };
function make(tag, className = "", value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) text(node, value);
  return node;
}
function say(message, success = false) {
  alertBox.textContent = message || "";
  alertBox.classList.toggle("success", success);
}
function showAccount() {
  $("hero").hidden = true;
  $("results-view").hidden = true;
  $("marketplace-view").hidden = true;
  $("business-profile-view").hidden = true;
  $("browser-view").hidden = true;
  view.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("account-auth").hidden = !enabled;
  $("account-unavailable").hidden = enabled;
  if (!enabled) say("Vista previa: registro y datos comerciales reales desactivados.");
  else if (session) refreshBusinesses().catch(error => say(error.message));
  else say("Puedes crear tu cuenta o iniciar sesión. Esta etapa no publica negocios automáticamente.");
}
function goBack() {
  view.hidden = true;
  $("results-view").hidden = true;
  $("hero").hidden = false;
}
function setAuthMode(mode) {
  $("register-form").hidden = mode !== "register";
  $("login-form").hidden = mode !== "login";
  $("show-register").classList.toggle("active", mode === "register");
  $("show-login").classList.toggle("active", mode === "login");
  say("");
}
function setSignedIn(result) {
  session = result.token;
  profile = result.user;
  $("account-auth").hidden = true;
  $("business-dashboard").hidden = false;
  text($("business-greeting"), "¡Hola, " + profile.name + "!");
  text($("business-email"), profile.email);
  say("Sesión iniciada. Tú decides qué negocios permanecen privados y cuáles se muestran públicamente como no verificados.", true);
}
function resetBusinessForm() {
  editingBusiness = null;
  $("business-form").reset();
  $("business-form-title").textContent = "Registrar un negocio";
  $("business-form-hint").textContent = "Será privado a menos que marques la publicación voluntaria. Es una ficha declarada por su propietario, no una verificación oficial.";
  $("business-save").textContent = "+ Guardar mi negocio";
  $("business-cancel-edit").hidden = true;
  $("business-publish").closest("label").hidden = false;
}
function signedOut() {
  session = null; profile = null;
  $("account-auth").hidden = false;
  $("business-dashboard").hidden = true;
  $("business-list").replaceChildren();
  resetOwnerMarketplace();
  text($("business-count"), 0);
  $("register-form").reset(); $("login-form").reset(); resetBusinessForm();
  setAuthMode("login");
}
async function api(path, { method = "GET", payload, auth = false } = {}) {
  const headers = { accept: "application/json" };
  if (payload) headers["content-type"] = "application/json";
  if (auth) {
    if (!session) throw Error("Inicia sesión para continuar.");
    headers.authorization = "Bearer " + session;
  }
  let response;
  try {
    response = await fetch(path, {
      method, headers, body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store", credentials: "omit"
    });
  } catch { throw Error("No se pudo conectar con WAE WEB. Comprueba el servidor."); }
  let data;
  try { data = await response.json(); } catch { throw Error("El servidor respondió sin datos válidos."); }
  if (!response.ok) {
    if (response.status === 401 && auth) signedOut();
    throw Error(data.error || "No se pudo completar la operación.");
  }
  return data;
}
function busy(form, value) {
  for (const element of form.querySelectorAll("button,input,textarea,select")) element.disabled = value;
}
async function submitForm(form, action) {
  if (!enabled) { say("Registro desactivado en este servidor."); return; }
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  busy(form, true);
  try {
    const result = await api("/api/account/" + action, { method: "POST", payload: data });
    form.reset();
    setSignedIn(result);
    await refreshBusinesses();
  } catch (error) { say(error.message); }
  finally { busy(form, false); }
}
function businessCard(business) {
  const article = make("article", "business-entry");
  const heading = make("div", "business-entry-heading");
  heading.append(make("h3", "", business.name), make("span", "tag", "Declarado por el usuario"));
  article.append(heading, make("p", "business-meta", business.category + " · " + business.city));
  article.append(make("p", "business-meta", business.visibility === "public"
    ? "Visible públicamente · No verificado" : "Ficha privada · Solo tú"));
  if (business.description) article.append(make("p", "business-desc", business.description));
  if (business.website) {
    const a = make("a", "link-button", "↗ Sitio del negocio");
    a.href = business.website;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    article.append(a);
  }
  const visibility = make("button", "small-action",
    business.visibility === "public" ? "Ocultar de la búsqueda" : "Publicar en WAE WEB");
  visibility.type = "button";
  visibility.addEventListener("click", async () => {
    const published = business.visibility !== "public";
    if (published && !window.confirm("¿Publicar esta ficha en la búsqueda pública de WAE WEB como negocio NO verificado?")) return;
    visibility.disabled = true;
    try {
      await api("/api/businesses/" + encodeURIComponent(business.id), {
        method: "PATCH", auth: true, payload: { published }
      });
      await refreshBusinesses();
      say(published ? "Negocio visible públicamente como no verificado." : "La ficha vuelve a ser privada.", true);
    } catch (error) { say(error.message); visibility.disabled = false; }
  });
  article.append(visibility);
  const edit = make("button", "small-action", "Editar ficha");
  edit.type = "button";
  edit.addEventListener("click", () => {
    editingBusiness = business.id;
    for (const field of ["name", "category", "city", "description", "website", "whatsapp"]) {
      const input = $("business-" + field);
      input.value = business[field] || "";
    }
    $("business-form-title").textContent = "Editar: " + business.name;
    $("business-form-hint").textContent =
      "Editar los datos NO cambiará la visibilidad. Usa Publicar u Ocultar para controlarla.";
    $("business-save").textContent = "Guardar cambios";
    $("business-cancel-edit").hidden = false;
    $("business-publish").closest("label").hidden = true;
    $("business-form").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  article.append(edit);
  if (business.visibility === "public") {
    const link = make("a", "small-action", "↗ Ver perfil público");
    link.href = "/?business=" + encodeURIComponent(business.id);
    link.rel = "noopener noreferrer";
    article.append(link);
    const copy = make("button", "small-action", "⧉ Copiar enlace");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      const url = new URL(link.href);
      try {
        await navigator.clipboard.writeText(url.href);
        say("Enlace de perfil copiado.", true);
      } catch { say("No se pudo copiar. Abre el perfil para copiar la dirección."); }
    });
    article.append(copy);
  }
  const catalog = make("button","small-action","▦ Gestionar catálogo");
  catalog.type="button";
  catalog.addEventListener("click",()=>{
    selectedBusiness=business.id;
    $("marketplace-business-select").value=business.id;
    resetListingForm();
    refreshOwnerListings();
    $("owner-marketplace").scrollIntoView({behavior:"smooth",block:"start"});
  });
  article.append(catalog);
  const remove = make("button", "small-action", "Eliminar ficha");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    if (!window.confirm("¿Eliminar esta ficha de negocio de tu cuenta?")) return;
    remove.disabled = true;
    try {
      await api("/api/businesses/" + encodeURIComponent(business.id), { method: "DELETE", auth: true });
      if (editingBusiness === business.id) resetBusinessForm();
      await refreshBusinesses();
      say("Ficha eliminada de tu cuenta.", true);
    } catch (error) { say(error.message); remove.disabled = false; }
  });
  article.append(remove);
  return article;
}
async function refreshBusinesses() {
  const { businesses } = await api("/api/businesses", { auth: true });
  const list = $("business-list");
  list.replaceChildren();
  text($("business-count"), businesses.length);
  if (!businesses.length) list.append(make("p", "business-empty",
    "Todavía no has registrado negocios. Utiliza el formulario para crear tu primera ficha."));
  for (const business of businesses) list.append(businessCard(business));
  const selection=$("marketplace-business-select");
  selection.replaceChildren(make("option","","Elige un negocio registrado"));
  selection.firstChild.value="";
  for (const business of businesses) {
    const option=make("option","",business.name);
    option.value=business.id;
    selection.append(option);
  }
  if (selectedBusiness && !businesses.some(b=>b.id===selectedBusiness)) selectedBusiness="";
  if (!selectedBusiness && businesses.length) selectedBusiness=businesses[0].id;
  selection.value=selectedBusiness;
  await refreshOwnerListings();

}
async function loadCapability() {
  try {
    const result = await api("/api/capabilities");
    enabled = result.accountsEnabled === true;
    objectMedia = result.marketplaceObjectMedia === true;
  } catch { enabled = false; objectMedia = false; }
  $("account-auth").hidden = !enabled;
  $("account-unavailable").hidden = enabled;
  if (!enabled) say("Vista previa: registro, pagos y publicaciones desactivados.");
}
$("account-button").addEventListener("click", showAccount);
$("hero-account-button").addEventListener("click", showAccount);
$("account-back").addEventListener("click", goBack);
$("account-unavailable-back").addEventListener("click", goBack);
$("home-button").addEventListener("click", () => { view.hidden = true; });
$("hero-form").addEventListener("submit", () => { view.hidden = true; });
$("results-form").addEventListener("submit", () => { view.hidden = true; });
$("show-register").addEventListener("click", () => setAuthMode("register"));
$("show-login").addEventListener("click", () => setAuthMode("login"));
$("register-form").addEventListener("submit", event => {
  event.preventDefault(); submitForm(event.currentTarget, "register");
});
$("login-form").addEventListener("submit", event => {
  event.preventDefault(); submitForm(event.currentTarget, "login");
});
$("business-logout").addEventListener("click", async () => {
  try { if (session) await api("/api/account/logout", { method: "POST", auth: true }); }
  catch (error) { say(error.message); }
  finally { signedOut(); say("Sesión cerrada en esta pestaña.", true); }
});
$("business-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const body = Object.fromEntries(new FormData(form).entries());
  body.publish = body.publish === "on";
  busy(form, true);
  try {
    if (editingBusiness) {
      await api("/api/businesses/" + encodeURIComponent(editingBusiness) + "/profile", {
        method: "PATCH", payload: body, auth: true
      });
      resetBusinessForm();
      await refreshBusinesses();
      say("Ficha actualizada. La visibilidad del negocio no cambió.", true);
    } else {
      await api("/api/businesses", { method: "POST", payload: body, auth: true });
      resetBusinessForm();
      await refreshBusinesses();
      say("Negocio registrado en tu panel. Comparte solo si decides publicarlo.", true);
    }
  } catch (error) { say(error.message); }
  finally { busy(form, false); }
});
$("business-cancel-edit").addEventListener("click", resetBusinessForm);
loadCapability();

function ownerSay(message,success=false) {
  const node=$("marketplace-owner-status");
  node.textContent=message || "";
  node.classList.toggle("success",success);
}
function resetListingForm() {
  editingListing=null;
  photoData=undefined;
  $("listing-form").reset();
  $("listing-form-title").textContent="Nuevo producto o servicio";
  $("listing-save").textContent="Guardar publicación privada";
  $("listing-cancel-edit").hidden=true;
  $("listing-preview").replaceChildren();
  $("listing-preview").hidden=true;
  $("listing-photo-remove").hidden=true;
}
function resetOwnerMarketplace() {
  selectedBusiness="";
  ownerRequest++;
  resetListingForm();
  $("marketplace-business-select").replaceChildren();
  $("listing-form").hidden=true;
  $("listing-owner-list").replaceChildren();
  text($("listing-count"),0);
  ownerSay("");
  $("market-inquiry-list").replaceChildren();
  text($("market-inquiry-count"),0);
}
function picture(item) {
  const wrapper=make("div","market-photo-preview");
  if(item.imageKey || item.imageDataUrl?.startsWith("data:image/")) {
    const image=make("img","market-photo");
    image.alt="Fotografía de "+item.title;
    image.referrerPolicy="no-referrer";
    if(item.imageKey && session) {
      const owner=selectedBusiness, token=session;
      api("/api/businesses/"+encodeURIComponent(owner)+"/listings/"+
        encodeURIComponent(item.id)+"/image",{auth:true})
        .then(data=>{if(session===token&&selectedBusiness===owner&&wrapper.isConnected)
          image.src=data.url;})
        .catch(()=>{});
    } else image.src=item.imageDataUrl;
    wrapper.append(image);
  } else wrapper.append(make("span","market-placeholder","▦"));
  return wrapper;
}
function priceLabel(item) {
  return item.priceCents==null?"Consultar precio":
    new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN"}).format(item.priceCents/100);
}
function renderOwnerListing(item) {
  const card=make("article","business-entry market-owner-card");
  card.append(picture(item),make("h3","",item.title),
    make("p","business-meta",(item.kind==="service"?"Servicio":"Producto")+
      " · "+item.category+" · "+priceLabel(item)),
    make("p","business-desc",item.description));
  card.append(make("p","business-fineprint",item.visibility==="public"
    ?"Visible públicamente":"Privado · Solo tú"));
  const edit=make("button","small-action","Editar");
  edit.type="button";
  edit.addEventListener("click",()=>{
    editingListing=item.id;
    const form=$("listing-form");
    for(const field of ["kind","title","category","description","availability"])
      form.elements.namedItem(field).value=item[field]||"";
    form.elements.namedItem("price").value=item.priceCents==null?"":String(item.priceCents/100);
    photoData=undefined;
    showPhoto(item.imageDataUrl);
    if(item.imageKey) {
      const owner=selectedBusiness, token=session, editing=item.id;
      api("/api/businesses/"+encodeURIComponent(owner)+"/listings/"+
        encodeURIComponent(editing)+"/image",{auth:true})
        .then(data=>{if(session===token&&selectedBusiness===owner&&editingListing===editing)
          showPhoto(data.url);})
        .catch(()=>ownerSay("La vista previa de la fotografía no está disponible."));
    }
    $("listing-form-title").textContent="Editar publicación";
    $("listing-save").textContent="Guardar cambios";
    $("listing-cancel-edit").hidden=false;
    form.scrollIntoView({behavior:"smooth",block:"start"});
  });
  const visibility=make("button","small-action",
    item.visibility==="public"?"Ocultar":"Publicar");
  visibility.type="button";
  visibility.addEventListener("click",async()=>{
    const published=item.visibility!=="public";
    if(published&&!window.confirm("¿Publicar este anuncio en Marketplace como información no verificada?"))return;
    visibility.disabled=true;
    try {
      await api("/api/businesses/"+selectedBusiness+"/listings/"+item.id+"/visibility",{
        method:"PATCH",auth:true,payload:{published}});
      await refreshOwnerListings();
      ownerSay(published?"Anuncio publicado.":"El anuncio vuelve a ser privado.",true);
    }catch(e){ownerSay(e.message);visibility.disabled=false;}
  });
  const remove=make("button","small-action","Eliminar");
  remove.type="button";
  remove.addEventListener("click",async()=>{
    if(!window.confirm("¿Eliminar esta publicación? Esta acción no se puede deshacer."))return;
    remove.disabled=true;
    try {
      await api("/api/businesses/"+selectedBusiness+"/listings/"+item.id,{
        method:"DELETE",auth:true});
      if(editingListing===item.id)resetListingForm();
      await refreshOwnerListings();
      ownerSay("Publicación eliminada.",true);
    }catch(e){ownerSay(e.message);remove.disabled=false;}
  });
  card.append(edit,visibility,remove);
  return card;
}
async function refreshOwnerListings() {
  const serial=++ownerRequest;
  $("listing-form").hidden=!selectedBusiness;
  const list=$("listing-owner-list");
  list.replaceChildren();
  text($("listing-count"),0);
  if(!selectedBusiness) {
    list.append(make("p","business-empty","Registra o selecciona una empresa para crear su catálogo."));
    return;
  }
  try {
    const result=await api("/api/businesses/"+selectedBusiness+"/listings",{auth:true});
    if(serial!==ownerRequest || !session)return;
    text($("listing-count"),result.items.length+" / "+result.limit);
    if(!result.items.length)
      list.append(make("p","business-empty","Empieza agregando tu primer producto o servicio. Se guarda privado."));
    for(const item of result.items)list.append(renderOwnerListing(item));
    await refreshMarketInquiries();
  }catch(e){if(serial===ownerRequest)ownerSay(e.message);}
}
function showPhoto(data) {
  const preview=$("listing-preview");
  preview.replaceChildren();
  preview.hidden=!data;
  $("listing-photo-remove").hidden=!data;
  if(data) {
    const img=make("img","market-photo");
    img.src=data;
    img.alt="Vista previa de fotografía";
    preview.append(img);
  }
}
async function resizePhoto(file) {
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>5*1024*1024)
    throw Error("Selecciona JPEG, PNG o WebP de hasta 5 MB.");
  const bitmap=await createImageBitmap(file);
  try {
    for(const max of [720,600,480,360,260]) {
      const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));
      canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#ffffff";
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const quality of [.78,.64,.5]) {
        const output=canvas.toDataURL("image/jpeg",quality);
        if(output.length<(objectMedia ? 310*1024 : 64*1024)) return output;
      }
    }
    throw Error("La fotografía sigue siendo demasiado grande: prueba otra.");
  } finally {bitmap.close?.();}
}
$("marketplace-business-select").addEventListener("change",event=>{
  selectedBusiness=event.target.value;
  resetListingForm();
  ownerSay("");
  refreshOwnerListings();
});
$("listing-photo").addEventListener("change",async event=>{
  const input=event.currentTarget,file=input.files?.[0];
  if(!file)return;
  input.disabled=true;
  try {
    photoData=await resizePhoto(file);
    showPhoto(photoData);
    ownerSay("Fotografía preparada. Guarda la publicación para conservarla.",true);
  }catch(e){ownerSay(e.message);}
  finally{input.disabled=false;input.value="";}
});
$("listing-photo-remove").addEventListener("click",()=>{
  photoData=null;
  showPhoto(null);
  ownerSay("La fotografía se quitará al guardar.",true);
});
$("listing-cancel-edit").addEventListener("click",resetListingForm);
$("listing-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;
  if(!selectedBusiness||!form.reportValidity())return;
  const businessId=selectedBusiness;
  const body=Object.fromEntries(new FormData(form).entries());
  if(!objectMedia&&photoData!==undefined)body.imageDataUrl=photoData;
  if(objectMedia)delete body.imageDataUrl;
  const editing=editingListing;
  busy(form,true);
  try{
    const result=await api("/api/businesses/"+businessId+"/listings"+
      (editing?"/"+editing:""),{
      method:editing?"PATCH":"POST",auth:true,payload:body});
    const itemId=editing||result.item.id;
    if(objectMedia&&photoData!==undefined){
      const imageEndpoint="/api/businesses/"+encodeURIComponent(businessId)+
        "/listings/"+encodeURIComponent(itemId)+"/image";
      try{
        if(photoData===null)await api(imageEndpoint,{method:"DELETE",auth:true});
        else await api(imageEndpoint,{method:"POST",auth:true,payload:{imageDataUrl:photoData}});
      }catch(error){
        editingListing=itemId;
        $("listing-form-title").textContent="Editar publicación guardada";
        $("listing-save").textContent="Volver a guardar la fotografía";
        $("listing-cancel-edit").hidden=false;
        await refreshOwnerListings();
        ownerSay("Producto guardado, pero no se pudo guardar la fotografía: "+error.message+
          " Conserva el formulario y vuelve a intentarlo.");
        return;
      }
    }
    resetListingForm();
    await refreshOwnerListings();
    ownerSay("Publicación guardada. Pulsa Publicar cuando quieras hacerla visible.",true);
  }catch(e){ownerSay(e.message);}
  finally{busy(form,false);}
});

const marketDialogs={
  inquiry: $("market-inquiry-dialog"), report: $("market-report-dialog")
};
let marketTarget=null;
const marketId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function refreshMarketInquiries() {
  const list=$("market-inquiry-list");
  list.replaceChildren();text($("market-inquiry-count"),0);
  if(!session||!selectedBusiness)return;
  const selected=selectedBusiness;
  try{
    const result=await api("/api/businesses/"+encodeURIComponent(selected)+"/inquiries",{auth:true});
    if(selectedBusiness!==selected||!session)return;
    text($("market-inquiry-count"),result.items.length);
    if(!result.items.length)list.append(make("p","business-empty","Todavía no recibes consultas."));
    for(const item of result.items.slice().reverse()){
      const card=make("article","business-entry");
      card.append(make("h4","",item.listingTitle),
        make("p","business-meta",item.buyerName+" · "+item.buyerEmail),
        make("p","business-desc",item.message),
        make("p","business-fineprint",new Date(item.createdAt).toLocaleString("es-MX")));
      list.append(card);
    }
  }catch(e){ownerSay("No se pudieron cargar las consultas: "+e.message);}
}
$("market-inquiry-refresh").addEventListener("click",refreshMarketInquiries);
window.addEventListener("wae-market-action",event=>{
  const {action,businessId,listingId,title}=event.detail||{};
  if(!["inquiry","report"].includes(action)||
    !marketId.test(businessId||"")||!marketId.test(listingId||""))return;
  if(!session){
    showAccount();
    say("Inicia sesión para enviar una consulta o reportar un anuncio.");
    return;
  }
  marketTarget={action,businessId,listingId};
  const dialog=marketDialogs[action];
  dialog.querySelector("form").reset();
  text($(action==="inquiry"?"market-inquiry-item":"market-report-item"),title||"Publicación");
  text($(action==="inquiry"?"market-inquiry-status":"market-report-status"),"");
  dialog.showModal();
});
for(const [action,dialog] of Object.entries(marketDialogs)){
  $(action==="inquiry"?"market-inquiry-cancel":"market-report-cancel")
    .addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{marketTarget=null;});
  dialog.querySelector("form").addEventListener("submit",async e=>{
    e.preventDefault();
    const target=marketTarget;
    if(!target||target.action!==action||!session)return;
    const form=e.currentTarget,body=Object.fromEntries(new FormData(form).entries());
    if(action==="inquiry")body.consent=form.elements.namedItem("consent").checked;
    const status=$(action==="inquiry"?"market-inquiry-status":"market-report-status");
    busy(form,true);text(status,"Enviando…");
    try {
      await api("/api/marketplace/"+encodeURIComponent(target.businessId)+"/"+
        encodeURIComponent(target.listingId)+"/"+(action==="inquiry"?"inquiries":"reports"),
        {method:"POST",auth:true,payload:body});
      text(status,action==="inquiry"?"Consulta guardada en el panel del negocio.":"Reporte recibido para revisión.");
      form.reset();
      // Keep the confirmation visible until the person closes the dialog.
    }catch(error){text(status,error.message);}
    finally{busy(form,false);}
  });
}
