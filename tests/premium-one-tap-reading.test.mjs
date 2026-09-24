import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {extractHtml} from "../server/reader.mjs";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const section=app.slice(app.indexOf("function createWebSourceReader(item,url)"),
  app.indexOf("function renderResult(item, index)"));

test("one click expands and requests a real result's original excerpt",()=>{
  assert.match(section,/let recover=null/);
  assert.match(section,/recover=button\("▤ Recuperar texto original",async\(\)=>/);
  assert.match(section,/if\(open&&!recovered&&recover&&!recover.disabled\)recover\.click\(\)/);
  assert.match(section,/getJSON\("\/api\/web\/preview\?url="\+encodeURIComponent\(url\)/);
  assert.match(section,/data\?\.kind!=="source_excerpt"/);
  assert.match(section,/data\.url!==canonical\.href/);
  assert.match(section,/recovered=data\.excerpt/);
  assert.match(section,/Se conserva el fragmento inicial y el enlace original/);
  assert.match(section,/external\(url,"↗ Fuente original"/);
  assert.doesNotMatch(section,/document\.createElement\("iframe"\)/);
});

test("article extraction suppresses site chrome but keeps the real source text",()=>{
  const html='<html><head><title>Investigación &amp; tecnología</title></head>'+
    '<body><header>Suscríbete al boletín urgente</header>'+
    '<nav>Portada Contacto Noticias</nav><main>'+
    '<aside>Publicidad para todos</aside>'+
    '<article><h1>Resultados verificables</h1>'+
    '<p>Primer párrafo original del informe, con contexto de la investigación.</p>'+
    '<p>Segundo párrafo original con cifras y referencias al documento.</p>'+
    '<button>Comprar suscripción ahora</button></article>'+
    '<footer>Menú y cookies</footer></main></body></html>';
  const data=extractHtml(html);
  assert.equal(data.title,"Investigación & tecnología");
  assert.match(data.text,/Resultados verificables/);
  assert.match(data.text,/investigación\.\n\nSegundo párrafo original/);
  assert.doesNotMatch(data.text,/Suscríbete|Portada Contacto|Publicidad|Comprar suscripción|Menú y cookies/);
});

test("short article teaser falls back to main, not fabricated full article",()=>{
  const html='<title>Noticias</title><main><article>Vista breve</article>'+
    '<p>Este es el contenido del sitio con información original y contexto adicional publicado en la página.</p></main>';
  const {text}=extractHtml(html);
  assert.match(text,/Vista breve/);
  assert.match(text,/contenido del sitio/);
  assert.doesNotMatch(text,/Noticias/);
});

test("generic HTML without article or main remains readable and bounded",()=>{
  const {title,text}=extractHtml('<head><title>Informe</title></head>'+
    '<nav>Fuera</nav><div><p>Texto público verificable</p>'+
    '<p>Con otra sección legible.</p></div>');
  assert.equal(title,"Informe");
  assert.equal(text,"Texto público verificable\n\nCon otra sección legible.");
  assert.ok(text.length<=18000);
});
