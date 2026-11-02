
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { DbClient } from "./client.js";
const ALPHABET="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function randomBase62(n:number){ let s=""; for(let i=0;i<n;i++) s+=ALPHABET[randomInt(ALPHABET.length)]; return s; }
export function hashApiKey(fullKey:string, pepper:string){ return createHmac("sha256", pepper).update(fullKey).digest("hex"); }
export function parseApiKey(key:string){ const m=/^am_live_([A-Za-z0-9]{8})_([A-Za-z0-9]{32})$/.exec(key); return m?{prefix:m[1]!, secret:m[2]!}:null; }
export function verifyApiKey(fullKey:string, pepper:string, storedHash:string){ const a=Buffer.from(hashApiKey(fullKey,pepper)); const b=Buffer.from(storedHash); return a.length===b.length && timingSafeEqual(a,b); }
export interface IssuedKey { id:string|null; fullKey:string; prefix:string; }
export function generateApiKey(pepper:string){ const prefix=randomBase62(8); const secret=randomBase62(32); const fullKey=`am_live_${prefix}_${secret}`; return { fullKey, prefix, keyHash: hashApiKey(fullKey, pepper) }; }
export async function createOperator(db:DbClient, type="person"){ const r=await db.query(`INSERT INTO operator(type) VALUES($1) RETURNING *`,[type]); return r.rows[0]; }
export async function createAgent(db:DbClient, operatorId:string, opts:{declared_model?:string;declared_model_version?:string;tier?:string}={}){ const r=await db.query(`INSERT INTO agent(operator_id,declared_model,declared_model_version,tier) VALUES($1,$2,$3,$4) RETURNING *`,[operatorId,opts.declared_model??null,opts.declared_model_version??null,opts.tier??"free"]); return r.rows[0]; }
export async function issueApiKey(db:DbClient, agentId:string, pepper:string):Promise<IssuedKey & {keyHash:string}>{ const g=generateApiKey(pepper); const r=await db.query(`INSERT INTO api_key(agent_id,key_hash,key_prefix) VALUES($1,$2,$3) RETURNING id`,[agentId,g.keyHash,g.prefix]); return { id:r.rows[0]?.id??null, fullKey:g.fullKey, prefix:g.prefix, keyHash:g.keyHash }; }
export async function revokeApiKey(db:DbClient, keyId:string){ const r=await db.query(`UPDATE api_key SET revoked_at=now() WHERE id=$1 RETURNING *`,[keyId]); return r.rows[0]??null; }
export async function findKeysByPrefix(db:DbClient, prefix:string){ const r=await db.query(`SELECT k.id AS key_id,k.agent_id,k.key_hash,k.key_prefix,k.scopes,k.revoked_at,k.last_used_at,a.operator_id,a.tier,a.verified,a.declared_model FROM api_key k JOIN agent a ON a.id=k.agent_id WHERE k.key_prefix=$1`,[prefix]); return r.rows; }
export async function touchApiKey(db:DbClient, keyId:string){ await db.query(`UPDATE api_key SET last_used_at=now() WHERE id=$1`,[keyId]); }
