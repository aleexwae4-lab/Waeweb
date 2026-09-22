import {royaltyQuote,formatMXN} from "/royalties.js";

const $ = id=>document.getElementById(id);
const LOCAL_DRAFT_KEY="waeweb.books.draft.v1";
const $text=(id,value)=>{$(id).textContent=String(value??"");};
let accountsReady=false,authorSession=null,authorProfile=null,authMode="register";
let manuscript=null,cover=null,manuscriptUrl=null,coverUrl=null;
let lastDraft=null;

function tell(id,message){$text(id,message);}
function revoke(url){if(url)URL.revokeObjectURL(url);}
function previewAuthor(){
  const name=$("draft-author").value.trim()||authorProfile?.name||"tu nombre de autor";
  $text("book-preview-author","Por "+name);
}
function pricePreview(){
  const raw=$("draft-price").value;
  try{
    const quote=royaltyQuote(raw);
    $text("book-preview-price-value",formatMXN(quote.priceCents));
    $text("book-preview-author-amount",formatMXN(quote.authorCents));
    $text("book-preview-platform-amount",formatMXN(quote.platformCents));
  }catch{
    $text("book-preview-price-value","Precio por definir");
    $text("book-preview-author-amount","—");
    $text("book-preview-platform-amount","—");
  }
}
function updatePreview(){
  const title=$("draft-title").value.trim();
  const description=$("draft-description").value.trim();
  $text("book-preview-title",title||"El título de tu libro");
  $text("book-preview-cover-title",title||"TU PRÓXIMA HISTORIA");
  $text("book-preview-genre",$("draft-genre").value||"Categoría pendiente");
  $text("book-preview-description",description||"Aquí aparecerá tu sinopsis. No se ha publicado ningún libro.");
  previewAuthor();pricePreview();
}
function quoteCalculator(){
  const raw=$("royalty-price").value;
  try{
    const quote=royaltyQuote(raw);
    $text("royalty-gross",formatMXN(quote.priceCents));
    $text("royalty-author",formatMXN(quote.authorCents));
    $text("royalty-platform",formatMXN(quote.platformCents));
    tell("royalty-message","Cálculo orientativo antes de impuestos, reembolsos y posibles gastos de cobro; no es una liquidación real.");
  }catch(error){
    for(const id of ["royalty-gross","royalty-author","royalty-platform"])$text(id,"—");
    tell("royalty-message",error.message);
  }
}
function defaultDraft(){
  return {title:"",author:authorProfile?.name||"",genre:"",description:"",price:"199"};
}
function validDraft(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const title=typeof value.title==="string"?value.title.trim().slice(0,120):"";
  const author=typeof value.author==="string"?value.author.trim().slice(0,100):"";
  const description=typeof value.description==="string"?value.description.trim().slice(0,1800):"";
  const genre=typeof value.genre==="string"?value.genre.slice(0,60):"";
  const genres=[...$("draft-genre").options].map(o=>o.value);
  const price=typeof value.price==="string"||typeof value.price==="number"?String(value.price):"";
  if(title.length<3||author.length<2||description.length<40||!genres.includes(genre)||!genre)return null;
  try{royaltyQuote(price);}catch{return null;}
  return {title,author,genre,description,price};
}
function setDraft(draft){
  for(const field of ["title","author","genre","description","price"])
    $("draft-"+field).value=String(draft[field]??"");
  updatePreview();
}
function loadDraft(){
  try{
    const raw=localStorage.getItem(LOCAL_DRAFT_KEY);
    if(!raw)return;
    const data=validDraft(JSON.parse(raw));
    if(!data)return;
    lastDraft=data;setDraft(data);
    tell("book-draft-message","Borrador local recuperado. Vuelve a seleccionar PDF/EPUB y portada: los archivos no se guardan.");
  }catch{tell("book-draft-message","Almacenamiento local no disponible. Puedes completar la ficha, pero no se guardará aquí.");}
}
function saveDraft(event){
  event.preventDefault();
  const form=$("book-draft-form");
  if(!form.reportValidity())return;
  const data=validDraft({
    title:$("draft-title").value,
    author:$("draft-author").value,
    genre:$("draft-genre").value,
    description:$("draft-description").value,
    price:$("draft-price").value
  });
  if(!data){tell("book-draft-message","Revisa título, autor, categoría, sinopsis de mínimo 40 caracteres y precio MXN válido.");return;}
  try{
    localStorage.setItem(LOCAL_DRAFT_KEY,JSON.stringify(data));
    lastDraft=data;
    tell("book-draft-message","Ficha guardada solo en este dispositivo. Tu libro NO está publicado; conserva PDF/EPUB y portada por separado.");
  }catch{
    tell("book-draft-message","No se pudo guardar la ficha en este dispositivo. Comprueba el almacenamiento del navegador.");
  }
  updatePreview();
}
function forgetFileUrls(){revoke(manuscriptUrl);revoke(coverUrl);manuscriptUrl=null;coverUrl=null;}
function resetDraft(){
  const hasDraft=Boolean(lastDraft||$("draft-title").value||$("draft-description").value);
  if(hasDraft&&!confirm("¿Crear un borrador nuevo y borrar la ficha local guardada en este navegador?"))return;
  try{localStorage.removeItem(LOCAL_DRAFT_KEY);}catch{}
  lastDraft=null;
  $("book-draft-form").reset();
  setDraft(defaultDraft());
  $("book-manuscript").value="";$("book-cover").value="";
  manuscript=null;cover=null;forgetFileUrls();
  $("book-cover-preview").style.backgroundImage="";
  $("book-cover-preview").classList.remove("has-cover");
  $("book-preview-file").disabled=true;$("book-preview-cover").disabled=true;
  tell("manuscript-state","No hay ningún archivo seleccionado.");
  tell("cover-state","Puedes utilizar una portada propia.");
  $("book-rights").checked=false;
  tell("book-draft-message","Nuevo borrador local. Los campos y los archivos anteriores se han descartado de esta página.");
}
async function validateSelectedFile(file,kind){
  const isBook=kind==="manuscript";
  const allowed=isBook?/\.(pdf|epub)$/i:/\.(jpe?g|png|webp)$/i;
  const max=isBook?40*1024*1024:5*1024*1024;
  if(!file||!allowed.test(file.name)||file.size===0||file.size>max)
    throw Error(isBook?"Selecciona un PDF/EPUB válido de hasta 40 MB.":"Selecciona una portada JPG/PNG/WebP de hasta 5 MB.");
  const head=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const bytes=Array.from(head).map(n=>String.fromCharCode(n)).join("");
  const lower=file.name.toLowerCase();
  if(isBook){
    if(lower.endsWith(".pdf")&&!bytes.startsWith("%PDF-"))throw Error("El archivo no parece ser un PDF válido.");
    if(lower.endsWith(".epub")&&!(head[0]===80&&head[1]===75))throw Error("El archivo no parece ser un EPUB válido.");
  }else{
    const jpeg=head[0]===255&&head[1]===216&&head[2]===255;
    const png=head.slice(0,8).every((n,i)=>n===[137,80,78,71,13,10,26,10][i]);
    const webp=bytes.slice(0,4)==="RIFF"&&bytes.slice(8,12)==="WEBP";
    if(!((/\.(jpg|jpeg)$/i.test(lower)&&jpeg)||(/\.png$/i.test(lower)&&png)||(/\.webp$/i.test(lower)&&webp)))
      throw Error("La cabecera del archivo no corresponde a JPG, PNG o WebP.");
  }
  return file;
}
async function pickFile(kind){
  const isBook=kind==="manuscript",input=$(isBook?"book-manuscript":"book-cover");
  const status=isBook?"manuscript-state":"cover-state";
  const file=input.files?.[0];
  if(!file){
    if(isBook){manuscript=null;revoke(manuscriptUrl);manuscriptUrl=null;$("book-preview-file").disabled=true;}
    else{cover=null;revoke(coverUrl);coverUrl=null;$("book-preview-cover").disabled=true;
      $("book-cover-preview").style.backgroundImage="";
      $("book-cover-preview").classList.remove("has-cover");}
    tell(status,"Archivo no seleccionado.");return;
  }
  try{
    const valid=await validateSelectedFile(file,kind);
    if(input.files?.[0]!==file)return;
    if(isBook){
      revoke(manuscriptUrl);manuscript=valid;manuscriptUrl=URL.createObjectURL(valid);
      $("book-preview-file").disabled=false;
    }else{
      revoke(coverUrl);cover=valid;coverUrl=URL.createObjectURL(valid);
      $("book-preview-cover").disabled=false;
      $("book-cover-preview").style.backgroundImage="url("+JSON.stringify(coverUrl)+")";
      $("book-cover-preview").classList.add("has-cover");
    }
    tell(status,valid.name+" · "+(valid.size/1024/1024).toFixed(2)+" MB · solo en este navegador, sin subir.");
  }catch(error){
    input.value="";
    if(isBook){manuscript=null;revoke(manuscriptUrl);manuscriptUrl=null;$("book-preview-file").disabled=true;}
    else{cover=null;revoke(coverUrl);coverUrl=null;$("book-preview-cover").disabled=true;
      $("book-cover-preview").style.backgroundImage="";
      $("book-cover-preview").classList.remove("has-cover");}
    tell(status,error.message);
  }
}
function openLocalPreview(kind){
  const url=kind==="manuscript"?manuscriptUrl:coverUrl;
  const file=kind==="manuscript"?manuscript:cover;
  if(!url||!file)return;
  const link=document.createElement("a");
  link.href=url;link.target="_blank";link.rel="noopener noreferrer";
  if(kind==="manuscript"&&file.name.toLowerCase().endsWith(".epub"))link.download=file.name;
  link.click();
}
async function accountRequest(path,payload,token){
  const headers={accept:"application/json","content-type":"application/json"};
  if(token)headers.authorization="Bearer "+token;
  const response=await fetch(path,{method:"POST",headers,body:JSON.stringify(payload),
    cache:"no-store",credentials:"omit"});
  let result;
  try{result=await response.json();}catch{throw Error("La API de cuentas no devolvió una respuesta válida.");}
  if(!response.ok)throw Error(result.error||"No se pudo completar el acceso a la cuenta.");
  return result;
}
function selectAuthMode(mode){
  authMode=mode;
  $("author-mode-register").classList.toggle("is-active",mode==="register");
  $("author-mode-login").classList.toggle("is-active",mode==="login");
  $("author-name-wrap").hidden=mode!=="register";
  $("author-name").required=mode==="register";
  $("author-password").autocomplete=mode==="register"?"new-password":"current-password";
  $text("author-auth-submit",mode==="register"?"Crear cuenta gratis":"Iniciar sesión");
  tell("author-account-status","");
}
function authorSignedIn(result){
  authorSession=result.token;authorProfile=result.user;
  $("author-account-fields").hidden=true;$("author-signed-in").hidden=false;
  $text("author-greeting","Hola, "+authorProfile.name+". Tu cuenta está disponible, pero la venta de libros todavía no está habilitada.");
  if(!$("draft-author").value)$("draft-author").value=authorProfile.name;
  updatePreview();tell("author-account-status","Cuenta iniciada. Continúa preparando el borrador.");
  $("author-auth-form").reset();
}
function signOut(){
  const token=authorSession;
  authorSession=null;authorProfile=null;
  $("author-account-fields").hidden=false;$("author-signed-in").hidden=true;
  $("author-auth-form").reset();
  tell("author-account-status","Sesión cerrada en esta página.");
  if(token)void accountRequest("/api/account/logout",{},token).catch(()=>{});
}
async function submitAuthor(event){
  event.preventDefault();
  if(!accountsReady){tell("author-account-status","Registro no habilitado en esta vista. Puedes preparar tu borrador local igualmente.");return;}
  const form=$("author-auth-form");
  if(!form.reportValidity())return;
  const button=$("author-auth-submit");button.disabled=true;
  tell("author-account-status","Conectando con el servicio de cuentas…");
  try{
    const payload={email:$("author-email").value.trim(),password:$("author-password").value};
    if(authMode==="register")payload.name=$("author-name").value.trim();
    const response=await accountRequest(authMode==="register"?"/api/account/register":"/api/account/login",payload);
    if(typeof response.token!=="string"||!response.user)throw Error("La API de cuentas no confirmó una sesión válida.");
    authorSignedIn(response);
  }catch(error){tell("author-account-status",error.message);}
  finally{button.disabled=!accountsReady;}
}
async function loadCapabilities(){
  try{
    const response=await fetch("/api/capabilities",{headers:{accept:"application/json"},cache:"no-store",credentials:"omit"});
    if(!response.ok)throw Error("API no disponible");
    const data=await response.json();
    accountsReady=data.accountsEnabled===true&&data.previewMode!==true;
    $("author-auth-submit").disabled=!accountsReady;
    $("author-account-fields").hidden=false;
    $("author-signed-in").hidden=true;
    $("author-account-status").textContent=accountsReady?
      "El registro está habilitado. La venta de libros sigue desactivada.":"Registro no disponible en esta vista. Puedes guardar un borrador local sin cuenta.";
    $("book-live-status").dataset.kind=accountsReady?"ready":"hold";
    tell("book-live-status",accountsReady?
      "Estudio de autor: registro de cuentas disponible. Publicación, venta y pagos editoriales pendientes.":
      "Vista previa editorial: puedes preparar y guardar una ficha local; registro, publicación y pagos reales no están habilitados.");
  }catch{
    accountsReady=false;$("author-auth-submit").disabled=true;
    $("book-live-status").dataset.kind="hold";
    tell("book-live-status","No se pudo verificar la API. Puedes preparar una ficha local, pero no crear cuentas, publicar ni cobrar.");
    tell("author-account-status","La API de cuentas no respondió. No se intentará crear una cuenta sin confirmar disponibilidad.");
  }
}
function updateCatalogMessage(){
  const q=$("book-query").value.trim(),genre=$("book-genre").value;
  const detail=q||genre?"No hay libros reales publicados que coincidan con estos filtros.":"Aún no hay libros verificados a la venta.";
  const p=$("book-catalog-result").querySelector("p");
  if(p)p.textContent=detail+" No mostramos portadas ni reseñas ficticias.";
}
$("royalty-price").addEventListener("input",quoteCalculator);
$("book-draft-form").addEventListener("input",updatePreview);
$("book-draft-form").addEventListener("change",updatePreview);
$("book-draft-form").addEventListener("submit",saveDraft);
$("book-reset-draft").addEventListener("click",resetDraft);
$("book-manuscript").addEventListener("change",()=>void pickFile("manuscript"));
$("book-cover").addEventListener("change",()=>void pickFile("cover"));
$("book-preview-file").addEventListener("click",()=>openLocalPreview("manuscript"));
$("book-preview-cover").addEventListener("click",()=>openLocalPreview("cover"));
$("author-mode-register").addEventListener("click",()=>selectAuthMode("register"));
$("author-mode-login").addEventListener("click",()=>selectAuthMode("login"));
$("author-auth-form").addEventListener("submit",event=>void submitAuthor(event));
$("author-logout").addEventListener("click",signOut);
$("book-query").addEventListener("input",updateCatalogMessage);
$("book-genre").addEventListener("change",updateCatalogMessage);
$("book-publish-action").addEventListener("click",()=>tell("book-publish-status","No se puede publicar ni cobrar hasta tener almacenamiento de manuscritos, derechos y pasarela de pagos verificados."));
window.addEventListener("pagehide",forgetFileUrls);
selectAuthMode("register");
quoteCalculator();updatePreview();loadDraft();void loadCapabilities();
