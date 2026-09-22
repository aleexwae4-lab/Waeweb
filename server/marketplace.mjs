// Marketplace catalog rules, isolated from transport and storage.
import { randomUUID } from "node:crypto";
import { imageUrl } from "./marketplace-media.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LISTINGS = 16; // Inline-file compatibility and legacy envelope bound.
const MAX_OBJECT_LISTINGS = 40; // Only with configured durable PostgreSQL + offloaded photos.
const MAX_IMAGE = 48 * 1024; // Encoded JPEG/PNG/WebP. No SVG or remote proxy.
export class MarketplaceError extends Error {
  constructor(code, message, status = 422) {
    super(message); this.name = "MarketplaceError"; this.code = code; this.status = status;
  }
}
const reject = (code, message, status) => { throw new MarketplaceError(code, message, status); };
export function validMarketId(id) { return typeof id === "string" && UUID.test(id); }
function field(value, label, min, max, optional = false) {
  if (optional && (value == null || value === "")) return "";
  if (typeof value !== "string" || value !== value.trim() ||
      value.length < min || value.length > max ||
      /[\u0000-\u001f\u007f]/.test(value))
    reject("invalid_listing", label + " no válido.");
  return value;
}
function image(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_IMAGE * 1.4 + 100)
    reject("invalid_image", "Imagen inválida o demasiado grande.");
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) reject("invalid_image", "Solo se admiten imágenes JPEG, PNG o WebP.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE || bytes.toString("base64") !== match[2])
    reject("invalid_image", "Imagen fuera del límite permitido (48 KB).");
  const isJpeg = bytes.length > 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff,0xd8,0xff]));
  const isPng = bytes.length > 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const isWebp = bytes.length > 12 && bytes.toString("ascii",0,4) === "RIFF" &&
    bytes.toString("ascii",8,12) === "WEBP";
  if (!(match[1] === "jpeg" && isJpeg || match[1] === "png" && isPng ||
      match[1] === "webp" && isWebp))
    reject("invalid_image", "El formato de la fotografía no coincide con el archivo.");
  return value;
}
export function validateListing(data, previous) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    reject("invalid_listing", "Publicación inválida.");
  const kind = data.kind;
  if (!["product", "service"].includes(kind))
    reject("invalid_listing", "Selecciona producto o servicio.");
  const availability = data.availability;
  if (!["available","unavailable"].includes(availability))
    reject("invalid_listing", "Disponibilidad inválida.");
  let priceCents = null;
  if (data.price !== "" && data.price != null) {
    const raw = typeof data.price === "number" ? String(data.price) : data.price;
    if (typeof raw !== "string" || !/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(raw))
      reject("invalid_price", "Indica precio MXN válido (máximo dos decimales).");
    const [whole, fraction = ""] = raw.split(".");
    priceCents = Number(whole)*100 + Number(fraction.padEnd(2,"0"));
    if (!Number.isSafeInteger(priceCents) || priceCents > 999999999)
      reject("invalid_price", "Precio fuera del límite permitido.");
  }
  // Existing photo survives edits unless the owner explicitly removes it.
  const picture = Object.hasOwn(data,"imageDataUrl") ?
    image(data.imageDataUrl) : previous?.imageDataUrl || null;
  return {
    kind, title: field(data.title,"Nombre",2,110),
    category: field(data.category,"Categoría",2,60),
    description: field(data.description,"Descripción",2,1100),
    priceCents, currency: "MXN", availability,
    imageDataUrl: picture
  };
}
export function createListing(data) {
  return { id: randomUUID(), ...validateListing(data),
    visibility: "owner_only", createdAt: new Date().toISOString() };
}
export function publicListing(business, listing) {
  return {
    id: listing.id, businessId: business.id, businessName: business.name,
    city: business.city, kind: listing.kind, title: listing.title,
    category: listing.category, description: listing.description,
    priceCents: listing.priceCents, currency: "MXN",
    availability: listing.availability, imageDataUrl: listing.imageKey ? null : listing.imageDataUrl,
    imageUrl: listing.imageKey ? imageUrl(business.id, listing.id) : null,
    verification: "self_declared"
  };
}
export function publicCatalog(business) {
  if (business?.visibility !== "public") return [];
  return (Array.isArray(business.listings) ? business.listings : [])
    .filter(item => item.visibility === "public" && item.moderation !== "blocked")
    .map(item => publicListing(business,item));
}
const fold = value => String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function searchMarketplace(users, { q = "", kind = "all", city = "", page = 1 } = {}) {
  if (typeof q !== "string" || q.length > 100 || typeof city !== "string" || city.length > 80 ||
      !["all","product","service"].includes(kind) || !Number.isSafeInteger(page) || page < 1 || page > 30)
    reject("invalid_marketplace_query", "Filtros no válidos.", 400);
  const terms = [...new Set(fold(q).match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0,12);
  const results = [];
  for (const user of users) for (const business of user.businesses || []) {
    if (business.visibility !== "public" ||
        city && !fold(business.city).includes(fold(city))) continue;
    for (const item of business.listings || []) {
      if (item.visibility !== "public" || item.moderation === "blocked" ||
          kind !== "all" && item.kind !== kind) continue;
      const title = fold(item.title), category = fold(item.category),
        company = fold(business.name), description = fold(item.description);
      if (!terms.every(term => [title,category,company,description].some(x=>x.includes(term)))) continue;
      const score = terms.reduce((sum,term)=>sum+
        (title.includes(term)?5:0)+(category.includes(term)?3:0)+
        (company.includes(term)?2:0)+(description.includes(term)?1:0),0);
      results.push({ item, business, score });
    }
  }
  results.sort((a,b) => b.score - a.score ||
    b.item.createdAt.localeCompare(a.item.createdAt) || a.item.id.localeCompare(b.item.id));
  return { items: results.slice((page-1)*20,page*20).map(({business,item})=>
    publicListing(business,item)), page, pageSize:20, total:results.length,
    hasMore: results.length>page*20,
    disclaimer:"Anuncios comerciales autodeclarados. WAEWEB no verifica identidad, disponibilidad ni precios." };
}
export { MAX_LISTINGS, MAX_OBJECT_LISTINGS };
