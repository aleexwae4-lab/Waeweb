// Exact integer-cents illustrative royalty split, not a settled payment.
export const AUTHOR_BPS=7000;
export const PLATFORM_BPS=3000;
export const CURRENCY="MXN";
export function priceToCents(raw) {
  const text=String(raw??"").trim();
  if(!/^(?:[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(text))throw new TypeError("Precio MXN inválido.");
  const [whole,fraction=""]=text.split(".");
  const cents=Number(whole)*100+Number(fraction.padEnd(2,"0"));
  if(!Number.isSafeInteger(cents)||cents<2000||cents>1000000)
    throw new RangeError("El precio debe estar entre $20 y $10,000 MXN.");
  return cents;
}
export function royaltyQuote(price) {
  const priceCents=priceToCents(price);
  // Remainder is assigned to author so the split is exact to one cent.
  const platformCents=Math.floor(priceCents*PLATFORM_BPS/10000);
  const authorCents=priceCents-platformCents;
  return {priceCents,authorCents,platformCents,currency:CURRENCY,
    authorPercent:70,platformPercent:30};
}
export function formatMXN(cents) {
  return new Intl.NumberFormat("es-MX",{style:"currency",currency:CURRENCY}).format(cents/100);
}
