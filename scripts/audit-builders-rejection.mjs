import {readFile,writeFile} from 'node:fs/promises';
const journal=JSON.parse(await readFile('artifacts/campaign-release-signing/create-builders.journal.json','utf8'));
async function rpc(method,params){const r=await fetch('https://archival-rpc.testnet.fastnear.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'rejection-audit',method,params}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
const block=(await rpc('block',{finality:'final'})).result,block_id=block.header.hash;
const tx=await rpc('tx',{tx_hash:journal.hash,sender_account_id:journal.signerId,wait_until:'NONE'});
const key=await rpc('query',{request_type:'view_access_key',account_id:journal.signerId,public_key:journal.publicKey,block_id});
const campaign=await rpc('query',{request_type:'call_function',account_id:journal.receiverId,method_name:'get_campaign',args_base64:Buffer.from('{"id":"builders"}').toString('base64'),block_id});
const result={recordedAt:new Date().toISOString(),blockHeight:block.header.height,blockHash:block_id,journal,tx,key,campaign,admissionRejection:{reason:'NotEnoughBalance',balance:'7367383505767004599999993',cost:'7536140385384293500000000'}};
await writeFile('docs/evidence/milestone-15-builders-rejection.json',JSON.stringify(result,null,2)+'\n');
if(tx.error?.cause?.name!=='UNKNOWN_TRANSACTION'||String(key.result?.nonce)!=='276321233000020'||JSON.parse(Buffer.from(campaign.result?.result??[]).toString())!==null)throw Error('Rejection state requires investigation');
console.log(JSON.stringify({hash:journal.hash,status:'unknown',nonce:key.result.nonce,campaign:null,blockHeight:block.header.height}));
