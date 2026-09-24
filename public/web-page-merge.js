// Merge federated web pages without turning duplicate URLs into new results.
// The server owns source truth; the browser only aggregates observed pages.
const providers=["Brave","Google","SearXNG"];
const uniqueNames=items=>[...new Set(items.filter(Boolean))];
function kind(item){
  if(item?.siteLink===true)return "named_site";
  let host="";
  try{host=new URL(item.url).hostname.toLowerCase().replace(/^www\./,"");}
  catch{return "web_page";}
  return host==="commons.wikimedia.org"||
    /(?:^|\.)(?:wikipedia|wikidata)\.org$/.test(host)||
    /^(?:wikipedia|wikidata|wikimedia commons)(?:\s|$)/i.test(item.source||"")
    ?"encyclopedia":"web_page";
}
function combineIndexDiagnosis(prior,extra){
  if(!prior)return extra||null;
  if(!extra)return prior;
  const previous=new Map((prior.providers||[]).map(row=>[row.name,row]));
  const later=new Map((extra.providers||[]).map(row=>[row.name,row]));
  const rows=providers.map(name=>{
    const a=previous.get(name)||{state:"not_queried",results:0};
    const b=later.get(name)||{state:"not_queried",results:0};
    const states=[a.state,b.state],count=Math.max(0,Number(a.results)||0)+
      Math.max(0,Number(b.results)||0);
    const state=count>0?"results":states.includes("empty")?"empty":
      states.includes("unavailable")?"unavailable":
      states.includes("unconfigured")?"unconfigured":"not_queried";
    return {name,state,results:count};
  });
  const states=rows.map(row=>row.state);
  const state=states.includes("results")?"results":
    states.includes("empty")?"empty":
    states.includes("unavailable")?"unavailable":
    states.every(value=>value==="not_queried")?"not_queried":"unconfigured";
  return {state,providers:rows,totalHits:rows.reduce((sum,row)=>sum+row.results,0)};
}
export function mergeWebPageResponse(prior,extra,unique){
  const results=[...(prior.results||[]),...unique];
  const former=prior.searchCoverage||{},later=extra.searchCoverage||{};
  const diagnosis=combineIndexDiagnosis(
    former.generalIndexDiagnosis,later.generalIndexDiagnosis);
  const generalIndexes=diagnosis?.providers
    .filter(row=>row.state==="results").map(row=>row.name)||
    uniqueNames([...(former.generalIndexes||[]),...(later.generalIndexes||[])]);
  const respondingGeneralIndexes=diagnosis?.providers
    .filter(row=>["results","empty"].includes(row.state)).map(row=>row.name)||
    uniqueNames([...(former.respondingGeneralIndexes||[]),
      ...(later.respondingGeneralIndexes||[])]);
  return {
    ...prior,
    page:extra.page||prior.page,
    fetchedAt:extra.fetchedAt||prior.fetchedAt,
    results,
    sources:uniqueNames([...(prior.sources||[]),...(extra.sources||[])]),
    failedSources:uniqueNames([...(prior.failedSources||[]),
      ...(extra.failedSources||[])]),
    // A page that contains only duplicates is not proof the index is
    // exhausted. Respect provider pagination, bounded by the API's 5 pages.
    hasMore:extra.hasMore===true&&Number(extra.page||0)<5,
    webCoverage:prior.webCoverage==="general-index"||
      extra.webCoverage==="general-index"?"general-index":
      prior.webCoverage==="specialized"||extra.webCoverage==="specialized"
        ?"specialized":"limited",
    searchCoverage:{
      ...former,
      generalIndexes,respondingGeneralIndexes,
      generalIndexDiagnosis:diagnosis,
      specialistSources:uniqueNames([...(former.specialistSources||[]),
        ...(later.specialistSources||[])]),
      unconfigured:uniqueNames([...(former.unconfigured||[]),
        ...(later.unconfigured||[])]),
      failed:uniqueNames([...(former.failed||[]),...(later.failed||[])]),
      navigationalSites:results.filter(item=>kind(item)==="named_site").length,
      webPages:results.filter(item=>kind(item)==="web_page").length,
      encyclopediaPages:results.filter(item=>kind(item)==="encyclopedia").length
    }
  };
}
