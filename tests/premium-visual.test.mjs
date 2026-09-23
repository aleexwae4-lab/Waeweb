import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/premium.css', import.meta.url), 'utf8');

test('premium stylesheet loads after the existing application styles', () => {
  const base = html.indexOf('href="/styles.css"');
  const premium = html.indexOf('href="/premium.css"');
  assert.ok(base >= 0, 'existing stylesheet remains');
  assert.ok(premium > base, 'premium layer must override visual rules only');
  assert.match(html, /<meta name="theme-color" content="#07101e">/);
});

test('premium visual system preserves accessible motion and hidden states', () => {
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
  assert.match(css, /forced-colors\s*:\s*active/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\[hidden\]\s*\{display:none!important;\}/);
});

test('premium visual system covers navigation, search, results and business', () => {
  for (const selector of [
    '.topbar', '.hero', '.search-shell', '.tab.active',
    '.result-card.web-result', '.browser-chrome',
    '.hero-business', '.market-card', '.map-explorer'
  ]) assert.ok(css.includes(selector), 'missing '+selector);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i,
    'premium paint must not block loading on external assets');
});
