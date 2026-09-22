// RC14 Marketplace trust contracts. No public report text and no payment collection.
import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(["fraud", "prohibited", "misleading", "spam", "other"]);
export class MarketplaceTrustError extends Error {
  constructor(code, message, status = 422) {
    super(message); this.name = "MarketplaceTrustError"; this.code = code; this.status = status;
  }
}
const reject = (code, message, status) => { throw new MarketplaceTrustError(code, message, status); };
export const validId = id => typeof id === "string" && UUID.test(id);
export function validateInquiry(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || data.consent !== true)
    reject("consent_required", "Confirma que deseas compartir tu nombre, correo y mensaje con el negocio.");
  const message = data.message;
  if (typeof message !== "string" || message !== message.trim() ||
      message.length < 10 || message.length > 500 || /[\u0000-\u001f\u007f]/.test(message))
    reject("invalid_inquiry", "Escribe un mensaje de 10 a 500 caracteres, sin saltos de línea.");
  return message;
}
export function validateReport(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !REASONS.has(data.reason)) reject("invalid_report", "Selecciona un motivo válido.");
  return data.reason;
}
export function newInquiry({ buyer, listing, message, now = Date.now() }) {
  return {
    id: randomUUID(), buyerId: buyer.id, buyerName: buyer.name,
    buyerEmail: buyer.email, listingId: listing.id, listingTitle: listing.title,
    message, createdAt: new Date(now).toISOString(), status: "new"
  };
}
export function newReport({ reporterId, businessId, listingId, reason, now = Date.now() }) {
  return { id: randomUUID(), reporterId, businessId, listingId,
    reason, status: "pending_review", createdAt: new Date(now).toISOString() };
}
export function publicInquiryReceipt() {
  return { received: true, message: "La solicitud se guardó en el panel privado del negocio. WAEWEB no garantiza respuesta ni realiza pagos." };
}
