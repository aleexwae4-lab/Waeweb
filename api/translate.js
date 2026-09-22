// Named public translator API; shared Node handler applies preview, limits and
// input validation. No vendor API key is exposed to public assets.
import {handler} from "../server/index.mjs";
export default async function waewebTranslate(req,res){
  try{await handler(req,res);}
  catch{
    if(res.headersSent){res.destroy?.();return;}
    res.writeHead(500,{"content-type":"application/json; charset=utf-8",
      "cache-control":"no-store","x-content-type-options":"nosniff","x-waeweb-api":"1"});
    res.end(JSON.stringify({error:"Error interno del traductor WAEWEB."}));
  }
}
