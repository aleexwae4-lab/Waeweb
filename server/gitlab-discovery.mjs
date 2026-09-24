// GitLab public project metadata, not a general web or code index.
// We query only explicit repository intent and verify the canonical
// gitlab.com project URL before offering an original-site link.
import {repositoryIntentTerms} from "./web-providers.mjs";
export const GITLAB_SOURCE="GitLab · repositorios públicos";
const pending=new Map();
export function gitlabRepositoryIntentTerms(query){
  const input=String(query??"").trim();
  if(/\bgithub\b/i.test(input))return null;
  const terms=repositoryIntentTerms(input);
  if(!terms)return null;
  const cleaned=terms.replace(/\bgitlab\b/gi,"").replace(/\s+/g," ").trim();
  return cleaned.length>=2?cleaned:null;
}
export function normalizeGitlabProject(project){
  if(!project||!Number.isInteger(project.id)||project.id<=0||
    project.visibility!=="public"||project.archived===true)return null;
  const path=String(project.path_with_namespace??"");
  if(!path||path.length>180||!/^([a-z0-9_][a-z0-9_.-]*\/)+[a-z0-9_][a-z0-9_.-]*$/i.test(path)||
    path.split("/").some(segment=>segment==="."||segment===".."))return null;
  const claimed=project.web_url;
  if(typeof claimed!=="string")return null;
  let url;
  try{
    const parsed=new URL(claimed);
    if(parsed.protocol!=="https:"||parsed.hostname!=="gitlab.com"||
      parsed.username||parsed.password||parsed.port||parsed.search||parsed.hash||
      parsed.pathname!=="/"+path)return null;
    url=parsed.href;
  }catch{return null;}
  const clean=value=>String(value??"").replace(/<[^>]*>/g," ")
    .replace(/\s+/g," ").trim();
  const stars=Number.isInteger(project.star_count)&&project.star_count>=0
    ?project.star_count:null;
  const description=[clean(project.description).slice(0,570),
    stars!==null?"Estrellas públicas: "+stars:null].filter(Boolean).join(" · ");
  return {title:path,url,snippet:description.slice(0,700),
    source:GITLAB_SOURCE,date:null,image:null,
    updatedAt:typeof project.last_activity_at==="string"?
      project.last_activity_at:null,
    indexedScope:"repository_metadata_only"};
}
export function gitlabPublicRepositories(query){
  const normalized=String(query??"").trim();
  if(normalized.length<2||normalized.length>140)return Promise.resolve([]);
  if(pending.has(normalized))return pending.get(normalized);
  const promise=loadProjects(normalized);
  pending.set(normalized,promise);
  void promise.then(()=>{if(pending.get(normalized)===promise)pending.delete(normalized);},
    ()=>{if(pending.get(normalized)===promise)pending.delete(normalized);});
  return promise;
}
async function loadProjects(query){
  const endpoint=new URL("https://gitlab.com/api/v4/projects");
  endpoint.search=new URLSearchParams({search:query,visibility:"public",
    archived:"false",simple:"true",per_page:"12",page:"1",
    order_by:"last_activity_at",sort:"desc"}).toString();
  const response=await fetch(endpoint,{headers:{accept:"application/json",
    "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"},
    redirect:"error",signal:AbortSignal.timeout(5600)});
  if(!response.ok)throw Error("gitlab_public_status_"+response.status);
  const body=await response.text();
  if(body.length>1100000)throw Error("gitlab_public_too_large");
  const data=JSON.parse(body);
  if(!Array.isArray(data))throw Error("gitlab_public_invalid_response");
  return data.slice(0,12).map(normalizeGitlabProject).filter(Boolean).slice(0,8);
}
