import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, rename, symlink, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { exportPortableRecovery, readPortableRecovery } from "../server/portable-recovery.mjs";

const sha="a".repeat(64);
const pg={version:1,type:"test-verified-synthetic-pg",checksum:sha,
  accounts:{envelope:"synthetic-only-ciphertext"},vaults:[]};
const archive={version:1,ciphertext:"synthetic-ci-only-ciphertext",
  manifestFingerprint:"b".repeat(64)};
async function temp(){
  const base=await mkdtemp(join(tmpdir(),"wae-rc23-portable-"));
  return {base,root:join(base,"portable"),source:join(base,"source")};
}
test("RC23 produces portable private package and verifies it without source files",async()=>{
  const {base,root,source}=await temp();
  try{
    const exported=await exportPortableRecovery(pg,[archive],{
      root,sourceRoots:[source]});
    assert.equal(exported.status,"package_created");
    assert.equal(exported.independentFailureDomainVerified,false);
    assert.equal(exported.restoreCertified,false);
    const raw=await readFile(join(root,exported.packageName,
      "postgres.backup.json"),"utf8");
    assert.equal(raw.includes("synthetic-only-ciphertext"),true);
    const result=await readPortableRecovery(exported.packageName,{
      root,sourceRoots:[source]});
    assert.deepEqual(result.snapshot,pg);
    assert.deepEqual(result.archives,[archive]);
    assert.equal(result.manifest.mediaCount,1);
    assert.equal(result.manifest.files.length,2);
    assert.ok(!JSON.stringify(exported).includes(archive.ciphertext));
  }finally{await rm(base,{recursive:true,force:true});}
});
test("RC23 rejects unsafe or collocated destinations before creating exports",async()=>{
  const {base,root,source}=await temp();
  try{
    await assert.rejects(()=>exportPortableRecovery(pg,[archive],{
      root:process.cwd()}),{code:"portable_directory_unsafe"});
    await assert.rejects(()=>exportPortableRecovery(pg,[archive],{
      root:"relative/offline"}),{code:"portable_directory_required"});
    await assert.rejects(()=>exportPortableRecovery(pg,[archive],{
      root:source,sourceRoots:[source]}),{code:"portable_directory_unsafe"});
    await assert.rejects(()=>exportPortableRecovery(pg,[],{
      root}),{code:"portable_package_options"});
  }finally{await rm(base,{recursive:true,force:true});}
});
test("RC23 detects missing ciphertext, byte corruption, injected files and symlinks",async()=>{
  const {base,root}=await temp();
  try{
    const a=await exportPortableRecovery(pg,[archive],{root});
    const path=join(root,a.packageName);
    const media=join(path,"media-000.backup.json");
    const original=await readFile(media);
    await writeFile(media,Buffer.from(original.toString()+" "));
    await assert.rejects(()=>readPortableRecovery(a.packageName,{root}),
      {code:"portable_checksum_mismatch"});
    await writeFile(media,original);
    await writeFile(join(path,"extra.txt"),"x");
    await assert.rejects(()=>readPortableRecovery(a.packageName,{root}),
      {code:"portable_unexpected_file"});
    await rm(join(path,"extra.txt"));
    await rename(media,join(base,"held.media"));
    await assert.rejects(()=>readPortableRecovery(a.packageName,{root}),
      {code:"portable_unexpected_file"});
    await symlink(join(base,"held.media"),media);
    await assert.rejects(()=>readPortableRecovery(a.packageName,{root}),
      {code:"portable_file_unsafe"});
  }finally{await rm(base,{recursive:true,force:true});}
});
test("RC23 refuses traversal names and public repo export even on empty package",async()=>{
  const {base,root}=await temp();
  try{
    await assert.rejects(()=>readPortableRecovery("../secret",{root}),
      {code:"portable_package_name"});
    await assert.rejects(()=>readPortableRecovery(
      "waeweb-recovery-0000000000000-11111111-1111-4111-8111-111111111111",
      {root}),{code:"portable_directory_missing"});
  }finally{await rm(base,{recursive:true,force:true});}
});
