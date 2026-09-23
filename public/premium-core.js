// Pure helpers shared by the no-dependency Premium 3.0 client and its tests.
export const premiumCategories = Object.freeze(["all","images","videos","maps","books","translate"]);
export function normalizePremiumTerm(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}
export function matchesPremiumAction(query, label) {
  const term = normalizePremiumTerm(query);
  return !term || normalizePremiumTerm(label).includes(term);
}
export function isPremiumTypingTarget(target) {
  const tag = String(target?.tagName || "").toLowerCase();
  return Boolean(target?.isContentEditable || ["input","textarea","select"].includes(tag));
}
