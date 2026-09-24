// Per-query diagnosis. Configuration is inferred ONLY from providers actually
// called; API responses must never expose tokens, URLs or provider error bodies.
const NAMES=["Brave","Google","SearXNG"];
export function diagnoseWebIndexes(sources,settled){
  const providers=NAMES.map(name=>{
    const index=sources.findIndex(source=>source[0]===name);
    if(index<0)return {name,state:"not_queried",results:0};
    const outcome=settled[index];
    if(!outcome||outcome.status==="rejected")
      return {name,state:"unavailable",results:0};
    const items=outcome.value?.items;
    if(items===null)return {name,state:"unconfigured",results:0};
    if(!Array.isArray(items))return {name,state:"unavailable",results:0};
    return {name,state:items.length?"results":"empty",results:items.length};
  });
  const states=providers.map(item=>item.state);
  const state=states.includes("results")?"results":
    states.includes("empty")?"empty":
    states.includes("unavailable")?"unavailable":
    states.every(item=>item==="not_queried")?"not_queried":"unconfigured";
  return {state,providers,totalHits:providers.reduce((sum,item)=>sum+item.results,0)};
}
