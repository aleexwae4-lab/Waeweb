"use strict";

// Native WAEWEB book details. Bibliographic discovery is separate from
// publishing, selling or hosting a third-party book.
const BOOK_PATTERNS = Object.freeze({
  "Open Library": /^https:\/\/openlibrary\.org\/works\/OL\d+W$/,
  "Google Books": /^https:\/\/books\.google\.com\/books\?id=[A-Za-z0-9_-]{2,80}$/,
  "Library of Congress": /^https:\/\/(?:www\.)?loc\.gov\//,
  "Project Gutenberg": /^https:\/\/www\.gutenberg\.org\/ebooks\/[1-9]\d*$/,
  "Internet Archive": /^https:\/\/archive\.org\/details\/[A-Za-z0-9][A-Za-z0-9._-]{1,99}$/
});
const COVER_PATTERNS = [
  /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-[SML]\.jpg$/,
  /^https:\/\/books\.google\.com\//,
  /^https:\/\/books\.googleusercontent\.com\//,
  /^https:\/\/lh3\.googleusercontent\.com\//,
  /^https:\/\/www\.gutenberg\.org\//,
  /^https:\/\/(?:www\.)?loc\.gov\//,
  /^https:\/\/(?:tile|cdn)\.loc\.gov\//,
  /^https:\/\/archive\.org\/services\/img\/[A-Za-z0-9._-]+$/
];
const text = (tag, css, value) => {
  const el = document.createElement(tag);
  if (css) el.className = css;
  if (value !== undefined) el.textContent = String(value ?? "");
  return el;
};
const action = (label, handler, css = "") => {
  const el = text("button", css, label);
  el.type = "button";
  el.addEventListener("click", handler);
  return el;
};
const link = (label, href, css = "") => {
  const el = text("a", css, label);
  el.href = href;
  el.target = "_blank";
  el.rel = "noopener noreferrer";
  return el;
};

export function isBookWork(item) {
  return Boolean(item && BOOK_PATTERNS[item.source]?.test(item.url || ""));
}

export function openBookDetail(item, { workspace, onSaved } = {}) {
  if (!isBookWork(item)) return false;
  document.querySelector(".wae-book-dialog")?.close();
  document.querySelector(".wae-book-dialog")?.remove();

  const dialog = text("dialog", "wae-book-dialog");
  dialog.setAttribute("aria-labelledby", "wae-book-detail-title");
  const heading = text("div", "wae-book-dialog-heading");
  const headingCopy = text("div");
  headingCopy.id = "wae-book-detail-title";
  headingCopy.append(text("span", "wae-book-eyebrow", "WAE WEB / BIBLIOTECA"),
    text("span", "wae-book-note", "Tu lectura empieza aquí"));
  const close = action("✕", () => dialog.close(), "wae-book-dialog-close");
  close.setAttribute("aria-label", "Cerrar ficha del libro");
  heading.append(headingCopy, close);
  const content = text("div", "wae-book-dialog-body");
  if (COVER_PATTERNS.some(pattern => pattern.test(item.image || ""))) {
    const cover = text("img", "wae-book-detail-cover");
    cover.src = item.image;
    cover.alt = "Portada registrada de " + item.title;
    cover.loading = "lazy";
    cover.referrerPolicy = "no-referrer";
    content.append(cover);
  } else {
    const placeholder = text("div", "wae-book-detail-cover wae-book-no-cover", "▤");
    placeholder.setAttribute("aria-label", "Portada no disponible");
    content.append(placeholder);
  }
  const details = text("div", "wae-book-detail-copy");
  details.append(text("h2", "", item.title || "Libro sin título"),
    text("p", "wae-book-detail-description", item.snippet || "Datos bibliográficos pendientes de confirmar."));
  if (item.date) details.append(text("p", "wae-book-detail-year", "Fecha bibliográfica registrada: " + item.date));
  if (item.bookAccess) details.append(text("p", "wae-book-detail-access", item.bookAccess));
  const rights = text("details", "wae-book-rights");
  rights.append(text("summary", "", "Disponibilidad y derechos"),
    text("p", "wae-book-detail-warning",
    "Esta ficha no acredita disponibilidad de lectura, descarga, préstamo o compra. Consulta las ediciones y sus derechos en el catálogo de origen."));
  details.append(rights);
  const actions = text("div", "wae-book-detail-actions");
  actions.append(link("↗ Ver en catálogo de origen", item.url, "wae-book-primary"));
  if (workspace?.add && workspace?.has) {
    const save = action(workspace.has(item.url) ? "◆ En mi biblioteca" : "◇ Guardar en mi biblioteca", () => {
      const outcome = workspace.add(item);
      if (outcome.ok) {
        save.textContent = "◆ En mi biblioteca";
        save.disabled = true;
      } else {
        status.textContent = outcome.reason || "No se pudo guardar la ficha.";
      }
      onSaved?.(outcome);
    }, "wae-book-secondary");
    save.disabled = workspace.has(item.url);
    actions.append(save);
  }
  const studio = text("a", "wae-book-studio-link", "✦ Crear mi propio libro con WAE →");
  studio.href = "/libros.html#publicar";
  details.append(actions, studio);
  const status = text("p", "wae-book-detail-status", "");
  status.setAttribute("role", "status");
  details.append(status, text("p", "wae-book-provenance",
    "Datos bibliográficos: " + item.source + " · WAE ofrece la experiencia de descubrimiento; la obra y la portada conservan sus derechos."));
  content.append(details);
  dialog.append(heading, content);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  return true;
}
