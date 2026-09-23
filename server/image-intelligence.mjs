// Metadata-based image discovery: source-backed results, never fabricated
// computer vision, image dimensions, licensing or publication dates.
const fold=value=>String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const tokens=value=>[...new Set(fold(value).match(/[\p{L}\p{N}]{3,}/gu)||[])].slice(0,16);
const intents=[
  ["productos",/\b(bolsa|bolso|monedero|producto|comprar|catalogo|tenis|zapato|reloj|celular|laptop|handbag|bag|product|fashion)\b/],
  ["lugares",/\b(museo|ciudad|paisaje|edificio|arquitectura|monumento|parque|catedral|playa|mapa|city|museum|landscape|building)\b/],
  ["personas",/\b(persona|rostro|retrato|modelo|actor|actriz|cantante|presidente|portrait|person|face)\b/],
  ["logotipos",/\b(logo|logotipo|isotipo|marca|emblema|icono|logotype|brand)\b/],
  ["diagramas",/\b(diagrama|infografia|esquema|mapa conceptual|grafica|chart|flowchart|diagram)\b/],
  ["arte",/\b(arte|ilustracion|pintura|acuarela|dibujo|estetica|poster|art|illustration|painting)\b/],
  ["vehiculos",/\b(auto|coche|motocicleta|moto|vehiculo|interior|car|motorcycle|vehicle)\b/],
  ["tecnologia",/\b(tecnologia|interfaz|software|ia|inteligencia artificial|computadora|robot|ui|tech)\b/]
];
export function imageIntent(query){
  const q=fold(query);
  return intents.find(([,pattern])=>pattern.test(q))?.[0]||"general";
}
export function imageOrientation(item){
  const width=Number(item.width),height=Number(item.height);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return "desconocida";
  if(Math.abs(width-height)/Math.max(width,height)<.12)return "cuadrada";
  return width>height?"horizontal":"vertical";
}
export function imageKind(item){
  const descriptor=fold([item.title,item.snippet,item.mime,item.visualType].join(" "));
  if(/\b(logo|logotipo|logotype|emblem)\b/.test(descriptor))return "logo";
  if(/\b(diagram|diagrama|infografia|infographic|chart|esquema)\b/.test(descriptor))return "diagrama";
  if(/\b(illustration|ilustracion|drawing|dibujo|vector|svg|painting)\b/.test(descriptor)||
    /image\/svg\+xml/.test(descriptor))return "ilustracion";
  if(item.visualType==="photo"||item.mime==="image/jpeg")return "foto";
  return "sin_clasificar";
}
export function imageCanonical(value){
  try{
    const u=new URL(value);
    if(!["https:","http:"].includes(u.protocol)||u.username||u.password)return null;
    u.hash="";
    for(const key of [...u.searchParams.keys()]){
      if(/^(utm_.+|fbclid|gclid|msclkid|width|height|w|h|size|quality|format|fit|crop|auto)$/i.test(key))
        u.searchParams.delete(key);
    }
    // Commons thumbnails: /thumb/a/ab/File.jpg/520px-File.jpg is the same
    // original asset as /a/ab/File.jpg. Do not collapse different filenames.
    if(/(?:^|\.)wikimedia\.org$/.test(u.hostname)){
      u.pathname=u.pathname.replace(/^\/wikipedia\/commons\/thumb\/(.+)\/\d+px-[^/]+$/,"/wikipedia/commons/$1");
    }
    return u.origin.toLowerCase()+u.pathname.replace(/\/$/,"")+u.search;
  }catch{return null;}
}
export function imageScore(item,query,intent=imageIntent(query)){
  const terms=tokens(query),title=fold(item.title),snippet=fold(item.snippet);
  let score=0;
  for(const term of terms){
    if(title.includes(term))score+=7;
    if(snippet.includes(term))score+=2;
  }
  if(terms.length&&terms.every(term=>title.includes(term)))score+=18;
  if(title.includes(fold(query).trim())&&query.trim())score+=12;
  const kind=imageKind(item);
  if(intent==="logotipos"&&kind==="logo")score+=16;
  if(intent==="diagramas"&&kind==="diagrama")score+=16;
  if(intent==="arte"&&kind==="ilustracion")score+=9;
  if(intent==="lugares"&&/\b(museo|arquitectura|landscape|paisaje|monumento)\b/.test(title))score+=6;
  if(intent==="productos"&&/\b(producto|bolsa|bolso|product|bag|zapato)\b/.test(title))score+=6;
  const w=Number(item.width),h=Number(item.height);
  if(w>=1200&&h>=800)score+=5;
  else if(w>=640&&h>=480)score+=3;
  else if(w>0&&h>0&&Math.min(w,h)<180)score-=8;
  if(item.image&&item.url)score+=2;
  return score;
}
// Similarity of URL assets is known; visual perceptual similarity requires
// downloading and hashing pixels, which this metadata-only module does not do.
export function rankImageResults(items,query){
  const intent=imageIntent(query);
  const chosen=[],keys=new Set(),counts=new Map();
  const sorted=items.filter(item=>item?.title&&imageCanonical(item.image)&&imageCanonical(item.url))
    .map((item,index)=>({item,index,score:imageScore(item,query,intent)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index);
  for(const {item} of sorted){
    const asset=imageCanonical(item.fullImage||item.image),url=imageCanonical(item.url);
    // Preserve separate images on the same source page when assets differ.
    const key=asset||url;
    if(keys.has(key))continue;
    keys.add(key);
    const host=new URL(item.url).hostname.toLowerCase();
    const seen=counts.get(host)||0;counts.set(host,seen+1);
    chosen.push({...item,orientation:imageOrientation(item),kind:imageKind(item)});
  }
  // Prefer variety among the first 18, but never drop a genuine result.
  const head=[],tail=[],perHost=new Map();
  for(const item of chosen){
    const host=new URL(item.url).hostname.toLowerCase();
    const count=perHost.get(host)||0;
    if(head.length<18&&count<6){head.push(item);perHost.set(host,count+1);}
    else tail.push(item);
  }
  return {intent,results:[...head,...tail],duplicatesRemoved:sorted.length-chosen.length};
}
