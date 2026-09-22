import {handler} from "../../server/index.mjs";
export default async function waewebDirectionsCapabilities(req,res){
  try{await handler(req,res);}
  catch{
    if(res.headersSent){res.destroy?.();return;}
    res.writeHead(500,{"content-type":"application/json; charset=utf-8",
      "cache-control":"no-store","x-content-type-options":"nosniff","x-waeweb-api":"1"});
    res.end(JSON.stringify({error:"No se pudo comprobar el motor de rutas."}));
  }
}
