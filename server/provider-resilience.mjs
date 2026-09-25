// Passive resilience fabric for optional/open infrastructure.
// It never probes providers in the background and never exposes configured URLs
// or secrets. State is process-local and is updated only by real user requests.
const circuits=new Map();
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function stateFor(name){
  if(!circuits.has(name))circuits.set(name,{
    consecutiveFailures:0,openUntil:0,lastSuccessAt:null,lastFailureAt:null,
    lastLatencyMs:null,lastErrorCode:null
  });
  return circuits.get(name);
}
const safeCode=error=>{
  const raw=String(error?.code||error?.name||"provider_error")
    .toLowerCase().replace(/[^a-z0-9_-]/g,"_");
  return raw.slice(0,80)||"provider_error";
};

export class ProviderCircuitOpenError extends Error{
  constructor(name,retryAfterSeconds){
    super("Provider circuit is temporarily open.");
    this.name="ProviderCircuitOpenError";
    this.code="provider_circuit_open";
    this.provider=name;
    this.retryAfterSeconds=retryAfterSeconds;
  }
}

export function resetProviderResilience(name=null){
  if(name)circuits.delete(name);else circuits.clear();
}

export function providerCircuitSnapshot(name,{configured=true}={}){
  if(!configured)return {state:"unconfigured",consecutiveFailures:0,retryAfterSeconds:0,
    lastSuccessAt:null,lastFailureAt:null,lastLatencyMs:null};
  const item=stateFor(name),now=Date.now();
  const retryAfterSeconds=item.openUntil>now?
    Math.max(1,Math.ceil((item.openUntil-now)/1000)):0;
  const state=retryAfterSeconds?"circuit_open":
    item.consecutiveFailures>0?"degraded":
    item.lastSuccessAt?"healthy":"idle";
  return {state,consecutiveFailures:item.consecutiveFailures,retryAfterSeconds,
    lastSuccessAt:item.lastSuccessAt,lastFailureAt:item.lastFailureAt,
    lastLatencyMs:item.lastLatencyMs};
}

export async function guardedProvider(name,run,{
  threshold=3,cooldownMs=45_000,retryable=()=>true
}={}){
  const item=stateFor(name),now=Date.now();
  if(item.openUntil>now)throw new ProviderCircuitOpenError(name,
    Math.max(1,Math.ceil((item.openUntil-now)/1000)));
  const started=Date.now();
  try{
    const result=await run();
    item.consecutiveFailures=0;
    item.openUntil=0;
    item.lastSuccessAt=new Date().toISOString();
    item.lastLatencyMs=Date.now()-started;
    item.lastErrorCode=null;
    return result;
  }catch(error){
    item.lastFailureAt=new Date().toISOString();
    item.lastLatencyMs=Date.now()-started;
    item.lastErrorCode=safeCode(error);
    if(retryable(error)){
      item.consecutiveFailures++;
      if(item.consecutiveFailures>=clamp(Number(threshold)||3,1,10)){
        item.openUntil=Date.now()+clamp(Number(cooldownMs)||45_000,5_000,10*60_000);
      }
    }
    throw error;
  }
}
