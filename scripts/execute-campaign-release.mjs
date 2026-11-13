// Exact testnet release executor. Invoke only after the expanded plan is approved.
// Keys stay in the CLI keychain. Signed files/journal are written before broadcast.
import {readFile,writeFile,mkdir,access} from "node:fs/promises";
import {resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash,createPublicKey,verify} from "node:crypto";
import {canonical,base58HashHex} from "../packages/near-client/src/chain.ts";
const REVIEW="4ae0e4e31e1bd86a94bd1e2a6f0283e67eaa0e96afd25f2cf0151a40fb84c7ad";
const assert=(v,m)=>{if(!v)throw Error(m)};
const sha=b=>createHash("sha256").update(b).digest();
const json=async p=>JSON.parse(await readFile(p,"utf8"));
const exists=async p=>{try{await access(p);return true}catch{return false}};
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+"\n",{flag:"wx"});
const plan=await json("deployments/campaign-release.review.json");
assert(sha(canonical(plan)).toString("hex")===REVIEW,"Plan changed");
const [id,approval,resend]=process.argv.slice(2);
const correction=id==="fund-correction";
assert(approval===(correction?"--approved-funding-correction":"--approved-testnet-release"),"Explicit approved release flag required");
const index=correction?4:plan.steps.findIndex(s=>s.id===id);assert(index>=0,"Unknown release step");
const step=correction?{id,signerId:"yf-creator-261113.testnet",receiverId:"yf-operator-261105.testnet",actions:[{type:"Transfer",deposit:"200000000000000000000000"}]}:plan.steps[index],dir="artifacts/campaign-release-signing",out="docs/evidence/milestone-15-receipts";
await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true});
const path=resolve(dir,id),receiptPath=`${out}/${id}.json`;
const recovering=await exists(`${path}.journal.json`);
assert(!await exists(receiptPath),"Already finalized; do not replay");
let spent=0n;
for(const prior of plan.steps.slice(0,index)){const r=await json(`${out}/${prior.id}.json`);assert(r.verification==="finalized-success"&&r.reviewSha256===REVIEW,"Previous release step unresolved");spent+=BigInt(r.tokensBurnt);}
if(index>=4&&!correction){const extra=await json(`${out}/fund-correction.json`);assert(extra.verification==="finalized-success","Funding correction unresolved");spent+=BigInt(extra.tokensBurnt);}
if(index>0&&!recovering)assert(await exists(`${out}/${plan.steps[index-1].id}.audit.json`),"Previous step state audit required");
async function rpc(method,params,url=plan.rpcUrl){
 const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"yieldfund-campaign-release",method,params}),signal:AbortSignal.timeout(45000)});
 assert(response.ok,`RPC HTTP ${response.status}`);const body=await response.json();if(body.error)throw Error(JSON.stringify(body.error));return body.result;
}
async function view(account_id,method_name,args,block_id){const r=await rpc("query",{request_type:"call_function",account_id,method_name,args_base64:Buffer.from(JSON.stringify(args)).toString("base64"),block_id});return JSON.parse(Buffer.from(r.result).toString());}
assert((await rpc("status",{})).chain_id==="testnet","Wrong network");
const block=await rpc("block",{finality:"final"});
assert(Date.now()-Number(BigInt(block.header.timestamp_nanosec)/1000000n)<120000,"Stale network");
const query=(request_type,account_id)=>rpc("query",{request_type,account_id,block_id:block.header.hash});
const expected=plan.accounts[step.signerId].keys.keys;
const keys=await query("view_access_key_list",step.signerId);
if(!recovering)assert(canonical(keys.keys.map(k=>({public_key:k.public_key,permission:k.access_key.permission})))===canonical(expected.map(k=>({public_key:k.public_key,permission:k.access_key.permission}))),"Signer authority changed");
const price=BigInt((await rpc("gas_price",{block_id:block.header.hash})).gas_price);
const allowance=305000000000000n*price*2n;
if(!recovering)assert(spent+allowance*BigInt(plan.steps.length-index)<=BigInt(plan.gasAllowance),"Remaining fee cap insufficient");
const account=await query("view_account",step.signerId);
const storageByteCost=BigInt((await rpc("EXPERIMENTAL_protocol_config",{block_id:block.header.hash})).runtime_config.storage_amount_per_byte);
const deposit=step.actions.reduce((n,a)=>n+BigInt(a.deposit),0n);
if(!recovering)assert(BigInt(account.amount)>=BigInt(account.storage_usage)*storageByteCost+deposit+305000000000000n*price*10n,"Insufficient available testnet NEAR for admission reserve");
if(index>=2&&!recovering){for(const [id,file] of [[plan.factoryId,"yieldfund_campaign_factory.wasm"],[plan.verifierId,"sputnikdao2.wasm"]])assert(base58HashHex((await query("view_account",id)).code_hash)===plan.artifacts[file].sha256,"Deployed code changed");}
if(step.artifact){
 const bytes=await readFile(resolve("artifacts",step.artifact));assert(sha(bytes).toString("hex")===plan.artifacts[step.artifact].sha256,"Artifact changed");
 if(!await exists(`${path}.journal.json`))assert(account.code_hash==="11111111111111111111111111111111","Deployment target already contains code");
 if(!recovering)assert(BigInt(account.amount)>(BigInt(bytes.length)+65536n)*storageByteCost+allowance,"Insufficient deployment storage reserve");
}
if(step.actions[0].methodName==="create_campaign"&&!await exists(`${path}.journal.json`)){
 assert(await view(plan.factoryId,"creation_cost",{},block.header.hash)===plan.creationCost,"Creation cost changed");
 assert(await view(plan.factoryId,"get_campaign",{id:step.actions[0].args.id},block.header.hash)===null,"Campaign already exists");
}
if(step.actions[0].methodName==="act_proposal"&&!recovering){
 const proposal=await view(plan.verifierId,"get_proposal",{id:0},block.header.hash);
 assert(proposal.status==="InProgress"&&canonical(proposal.kind)===canonical(step.actions[0].args.proposal),"Verification proposal changed");
 assert(Object.keys(proposal.votes).length===index-6&&!proposal.votes[step.signerId],"Unexpected prior votes");
}
if(step.actions[0].methodName==="add_proposal"&&!recovering)assert(await view(plan.verifierId,"get_last_proposal_id",{},block.header.hash)===0,"Verification DAO already has proposals");
if(!await exists(`${path}.signed.json`)){
 assert(!await exists(`${path}.journal.json`),"Missing signed payload; recover journal hash");
 const a=step.actions[0];let args;
 if(a.type==="Transfer")args=["tokens",step.signerId,"send-near",step.receiverId,`${a.deposit} yoctoNEAR`];
 else {
  await writeFile(`${path}.args.json`,JSON.stringify(a.args));
  args=step.artifact?["contract","deploy",step.receiverId,"use-file",resolve("artifacts",step.artifact),"with-init-call",a.methodName,"file-args",`${path}.args.json`]:["contract","call-function","as-transaction",step.receiverId,a.methodName,"file-args",`${path}.args.json`];
  args.push("prepaid-gas",`${BigInt(a.gas)/1000000000000n} Tgas`,"attached-deposit",`${a.deposit} yoctoNEAR`);
  if(!step.artifact)args.push("sign-as",step.signerId);
 }
 args.push("network-config","testnet","sign-with-keychain","--signer-public-key",expected[0].public_key,"save-to-file",`${path}.signed.json`);
 const cli=process.env.YIELDFUND_NEAR_CLI??"near";
 try{await promisify(execFile)(cli,args,{windowsHide:true,timeout:50000,maxBuffer:2000000});}catch{assert(await exists(`${path}.signed.json`),"CLI did not save a signed transaction");}
}
const signed=await json(`${path}.signed.json`),b=Buffer.from(signed.signed_transaction_as_base64,"base64");let p=0;
const take=n=>{assert(p+n<=b.length,"Truncated payload");const x=b.subarray(p,p+n);p+=n;return x;};
const u8=()=>take(1)[0],u32=()=>take(4).readUInt32LE(),u64=()=>take(8).readBigUInt64LE(),str=()=>take(u32()).toString();
const u128=()=>{const x=take(16);return x.readBigUInt64LE()+(x.readBigUInt64LE(8)<<64n)};
function base58(bytes){const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let n=BigInt("0x"+bytes.toString("hex")),s="";while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const x of bytes){if(x!==0)break;s="1"+s;}return s;}
const signerId=str();assert(u8()===0,"Only reviewed ed25519 keys supported");const publicBytes=take(32),publicKey="ed25519:"+base58(publicBytes),nonce=String(u64()),receiverId=str(),blockHash=base58(take(32)),count=u32(),actions=[];
for(let i=0;i<count;i++){const kind=u8();if(kind===1){actions.push({type:"DeployContract",sha256:sha(take(u32())).toString("hex")});}else if(kind===2){actions.push({type:"FunctionCall",methodName:str(),args:JSON.parse(str()),gas:String(u64()),deposit:String(u128())});}else if(kind===3){actions.push({type:"Transfer",deposit:String(u128())});}else throw Error("Unreviewed signed action");}
const unsigned=b.subarray(0,p),hash=base58(sha(unsigned));assert(u8()===0,"Signature type");const signature=take(64);assert(p===b.length,"Trailing bytes");
assert(verify(null,sha(unsigned),createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),publicBytes]),format:"der",type:"spki"}),signature),"Signature invalid");
const expectedActions=[...(step.artifact?[{type:"DeployContract",sha256:plan.artifacts[step.artifact].sha256}]:[]),...step.actions];
assert(signerId===step.signerId&&receiverId===step.receiverId&&publicKey===expected[0].public_key&&canonical(actions)===canonical(expectedActions),"Signed bytes differ from reviewed calls");
const journal={id,hash,signerId,receiverId,publicKey,nonce,blockHash,actions,reviewSha256:REVIEW,savedAt:new Date().toISOString()};
if(!await exists(`${path}.journal.json`)){
 await save(`${path}.journal.json`,journal);
 const url="https://archival-rpc.testnet.fastnear.com";
 assert((await rpc("status",{},url)).chain_id==="testnet","Broadcast network changed");
 await rpc("broadcast_tx_commit",[signed.signed_transaction_as_base64],url);
}else {
 assert((await json(`${path}.journal.json`)).hash===hash,"Journal mismatch");
 if(id==="create-builders"&&resend==="--approved-rejected-resend"&&!await exists(`${path}.resend.json`)){
  assert(hash==="ASCxHHN2zmYiz8yMwnBY8mjdeF5NarQSurQc2Mys2bct","Correction covers only the rejected hash");
  const key=await rpc("query",{request_type:"view_access_key",account_id:signerId,public_key:publicKey,block_id:block.header.hash});
  assert(BigInt(key.nonce)+1n===BigInt(nonce),"Rejected transaction nonce is no longer unused");
  assert(await view(plan.factoryId,"get_campaign",{id:"builders"},block.header.hash)===null,"Builders already exists");
  let unknown=false;
  try{await rpc("tx",{tx_hash:hash,sender_account_id:signerId,wait_until:"NONE"},"https://archival-rpc.testnet.fastnear.com");}catch(e){try{unknown=JSON.parse(e.message).cause?.name==="UNKNOWN_TRANSACTION";}catch{}}
  assert(unknown,"Rejected transaction status is not conclusively unknown");
  assert(BigInt(account.amount)>=BigInt(account.storage_usage)*storageByteCost+deposit+305000000000000n*price*10n,"Correction insufficient for admission reserve");
  await save(`${path}.resend.json`,{hash,approvedCorrection:"deployments/CAMPAIGN_FUNDING_CORRECTION.md",block:block.header.hash,nonce,savedAt:new Date().toISOString()});
  await rpc("broadcast_tx_commit",[signed.signed_transaction_as_base64],"https://archival-rpc.testnet.fastnear.com");
 }
}
const result=await rpc("tx",{tx_hash:hash,sender_account_id:signerId,wait_until:"FINAL"});
assert(result.final_execution_status==="FINAL"&&result.transaction.hash===hash,"Transaction not finalized");
const outcomes=[result.transaction_outcome,...result.receipts_outcome],success=s=>s&&(Object.hasOwn(s,"SuccessValue")||Object.hasOwn(s,"SuccessReceiptId"));
assert(success(result.status)&&outcomes.every(o=>success(o.outcome.status)),"Receipt failed; stop and reconcile");
const map=new Map(outcomes.map(o=>[o.id,o])),seen=new Set();
function visit(o){if(seen.has(o.id))return;seen.add(o.id);for(const id of o.outcome.receipt_ids){assert(map.has(id),"Missing receipt");visit(map.get(id));}}visit(result.transaction_outcome);
assert(seen.size===outcomes.length,"Detached or duplicated receipts");
const tokensBurnt=String(outcomes.reduce((n,o)=>n+BigInt(o.outcome.tokens_burnt),0n));assert(spent+BigInt(tokensBurnt)<=BigInt(plan.gasAllowance),"Fee cap exceeded");
await save(receiptPath,{...journal,verification:"finalized-success",tokensBurnt,result});
console.log(JSON.stringify({id,hash,tokensBurnt,verification:"finalized-success"}));
