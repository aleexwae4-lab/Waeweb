import { premiumCategories, matchesPremiumAction, isPremiumTypingTarget } from "/premium-core.js";

// Progressive enhancement: delegates to existing WAEWEB controls.
// It never calls a search provider, account endpoint or browser API itself.
const byId = id => document.getElementById(id);
const dialog = byId("premium-command-dialog");
const commandSearch = byId("premium-command-search");
const items = [...dialog.querySelectorAll(".premium-command-item")];
const empty = byId("premium-command-empty");
const hero = byId("hero");
const results = byId("results-view");

function visibleSearchInput() {
  return !hero.hidden ? byId("hero-input") :
    !results.hidden ? byId("results-input") : null;
}
function focusSearch() {
  if (!visibleSearchInput()) byId("home-button").click();
  const input = visibleSearchInput();
  input?.focus();
  input?.select();
}
function submitText(query) {
  if (!query.trim()) return focusSearch();
  if (!visibleSearchInput()) byId("home-button").click();
  const input = visibleSearchInput();
  if (!input) return;
  input.value = query;
  input.form?.requestSubmit();
}
function closePalette() {
  if (dialog.open) dialog.close();
}
function filterItems() {
  let count = 0;
  for (const item of items) {
    const match = matchesPremiumAction(commandSearch.value, item.dataset.premiumLabel);
    item.hidden = !match;
    if (match) count++;
  }
  empty.hidden = count !== 0;
}
function openPalette() {
  if (dialog.open) return;
  // Native modal focus and escape behavior: never stack it over account/vault dialogs.
  if (document.querySelector("dialog[open]")) return;
  commandSearch.value = "";
  filterItems();
  dialog.showModal();
  commandSearch.focus();
}
function invokeAction(action) {
  // Close before activating source controls, some of which open a dialog.
  closePalette();
  if (action === "search") return focusSearch();
  if (action === "home") return byId("home-button").click();
  if (action === "marketplace") return byId("marketplace-button").click();
  if (action === "library") return byId("library-button").click();
  if (action === "account") return byId("account-button").click();
  const type = action === "web" ? "all" : action;
  if (premiumCategories.includes(type)) {
    const tab = [...document.querySelectorAll("#tabs [data-type]")]
      .find(node => node.dataset.type === type && !node.disabled && !node.hidden);
    tab?.click();
    if (type !== "translate") byId("results-input")?.focus();
  }
}
byId("premium-launch").addEventListener("click", openPalette);
byId("premium-command-close").addEventListener("click", closePalette);
document.querySelectorAll("[data-premium-action]").forEach(button => {
  button.addEventListener("click", () => invokeAction(button.dataset.premiumAction));
});
commandSearch.addEventListener("input", filterItems);
commandSearch.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    const query = commandSearch.value.trim();
    closePalette();
    submitText(query);
  } else if (event.key === "ArrowDown") {
    const next = items.find(item => !item.hidden);
    if (next) { event.preventDefault(); next.focus(); }
  }
});
dialog.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (event.target === commandSearch) return;
    const available = items.filter(item => !item.hidden);
    const current = available.indexOf(document.activeElement);
    if (current === -1 || available.length === 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    available[(current + delta + available.length) % available.length].focus();
  }
});
document.addEventListener("keydown", event => {
  if (event.defaultPrevented || event.altKey || event.repeat) return;
  const ctrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
  const slash = event.key === "/" && !event.ctrlKey && !event.metaKey &&
    !isPremiumTypingTarget(event.target);
  if (!ctrlK && !slash) return;
  // Do not redirect keyboard focus behind an open native dialog.
  if (dialog.open) {
    if (ctrlK) { event.preventDefault(); commandSearch.focus(); }
    return;
  }
  if (document.querySelector("dialog[open]")) return;
  event.preventDefault();
  if (ctrlK) openPalette();
  else focusSearch();
});
