// RC18: operator-only digest verification. No image bytes, object keys or hashes in reports.
import { createHash, timingSafeEqual } from "node:crypto";
import { presignedMarketImage, MAX_MARKET_MEDIA_BYTES } from "./marketplace-media.mjs";

const DIGEST=/^[a-f0-9]{64}$/;
export const validImageDigest=value=>typeof value==="string"&&DIGEST.test(value);

export async function verifyMarketImageIntegrity(config,key,{
  checksum,size,transport=fetch,now=Date.now()
}={}) {
  // Historical S3 images did not store hashes. Never label these "verified".
  if(checksum==null&&size==null)return {state:"legacy_unverified"};
  if(!validImageDigest(checksum)||!Number.isSafeInteger(size)||
     size<8||size>MAX_MARKET_MEDIA_BYTES)return {state:"metadata_invalid"};
  const url=presignedMarketImage(config,key,now);
  let response;
  try{
    response=await transport(url,{method:"GET",redirect:"manual",
      signal:AbortSignal.timeout(12000)});
  }catch{return {state:"unavailable"};}
  if(response.status===404)return {state:"missing"};
  if(response.status===401||response.status===403)return {state:"denied"};
  if(response.status!==200)return {state:"unavailable"};
  if((response.headers?.get("content-type")||"").split(";")[0].trim().toLowerCase()!=="image/jpeg")
    return {state:"invalid_format"};
  const length=response.headers?.get("content-length");
  if(length!==null&&length!==undefined&&
      (!/^(?:0|[1-9]\d*)$/.test(length)||Number(length)>MAX_MARKET_MEDIA_BYTES||
       Number(length)<8))return {state:"invalid_size"};
  if(!response.body)return {state:"unavailable"};
  const chunks=[];
  let received=0;
  try{
    for await(const chunk of response.body){
      if(!(chunk instanceof Uint8Array))return {state:"unavailable"};
      received+=chunk.byteLength;
      if(received>MAX_MARKET_MEDIA_BYTES)return {state:"invalid_size"};
      chunks.push(Buffer.from(chunk));
    }
  }catch{return {state:"unavailable"};}
  const bytes=Buffer.concat(chunks,received);
  if(bytes.length<8||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||
      bytes.at(-2)!==255||bytes.at(-1)!==217)return {state:"invalid_format"};
  if(length!==null&&length!==undefined&&received!==Number(length))
    return {state:"invalid_size"};
  if(received!==size)return {state:"mismatch"};
  const digest=createHash("sha256").update(bytes).digest();
  const expected=Buffer.from(checksum,"hex");
  return {state:timingSafeEqual(digest,expected)?"verified":"mismatch"};
}
