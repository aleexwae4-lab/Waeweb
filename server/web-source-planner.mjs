// Query-scoped planning for the three actual general-web indexes.
// Specialist source: filters must not contact unrelated engines or pretend
// that an intentionally skipped engine is unconfigured or broken.
const GENERAL=new Map([["Brave","brave"],["Google","google"],["SearXNG","searxng"]]);
export function generalWebIndexAllowed(source,name){
  if(!GENERAL.has(name))return false;
  return !source||source===GENERAL.get(name);
}
