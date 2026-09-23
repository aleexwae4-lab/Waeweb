import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
test("primary voice controls remain while voice and speed occupy an optional panel",()=>{
  assert.match(app,/const settings=element\("details","wae-voice-settings"\)/);
  assert.match(app,/settings\.append\(element\("summary","","⚙ Ajustes"\)\)/);
  assert.match(app,/settingsContent\.append\(rateLabel,voiceLabel\)/);
  assert.match(app,/actions\.append\(pause,stop,settings\)/);
  assert.match(app,/voiceReader\.setRate\(rate\.value\)/);
  assert.match(app,/voiceReader\.setVoice\(voice\.value\)/);
  assert.match(app,/voiceReader\.resume\(\)/);
  assert.match(app,/voiceReader\.pause\(\)/);
  assert.match(app,/voiceReader\.stop\(\)/);
});
test("mobile dock is compact with hidden optional settings and readable touch targets",()=>{
  const compact=css.slice(css.lastIndexOf("/* RC · Compact reading controls"));
  assert.match(compact,/\.wae-voice-dock\{width:min\(550px,calc\(100vw - 18px\)\);padding:8px 10px;gap:5px/);
  assert.match(compact,/\.wae-voice-actions button,\.wae-voice-actions select,\.wae-voice-settings summary\{height:36px;min-height:36px/);
  assert.match(compact,/\.wae-voice-settings-content\{display:flex/);
  assert.match(compact,/\.wae-voice-actions:has\(\.wae-voice-settings\[open\]\)\{flex-wrap:wrap\}/);
  assert.match(compact,/\.wae-voice-heading\{flex-direction:row;align-items:center/);
  assert.match(compact,/\.wae-information-actions>button\{flex:0 1 auto\}/);
  assert.match(compact,/\.news-window,\.news-refresh,\.news-bulletin\{min-height:36px/);
  assert.match(compact,/\.knowledge-reading-actions \.link-button\{min-height:36px/);
});
