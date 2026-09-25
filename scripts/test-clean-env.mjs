import {spawnSync} from "node:child_process";
import {readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";

// Render injects production runtime variables into the build process. The test
// suite must start from a neutral environment so tests do not accidentally use
// live storage, billing, deployment-channel or provider configuration.
// Individual tests remain free to set the exact variables they exercise.
const env={...process.env};
const sensitivePrefixes=[
  "WAE_","VERCEL","RENDER","STRIPE_","SUPABASE_","BRAVE_","GOOGLE_",
  "YOUTUBE_","OPENROUTE_","MAPBOX_","DATABASE_","PG"
];
for(const key of Object.keys(env)){
  if(key==="DATABASE_URL"||sensitivePrefixes.some(prefix=>key.startsWith(prefix))){
    delete env[key];
  }
}
env.NODE_ENV="test";

const testsDir=new URL("../tests/",import.meta.url);
const testFiles=readdirSync(testsDir)
  .filter(name=>name.endsWith(".test.mjs"))
  .sort()
  .map(name=>fileURLToPath(new URL(name,testsDir)));

const result=spawnSync(process.execPath,["--test",...testFiles],{
  env,
  stdio:"inherit"
});
if(result.error){
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status??1);
