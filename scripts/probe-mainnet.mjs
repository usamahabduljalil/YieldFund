// Read-only integration discovery. No signer, key access, or broadcast method.
import { writeFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
const account = process.argv[2];
if (!account || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account) || account.length > 64)
  throw new Error("Provide a public NEAR mainnet account ID.");
const endpoint = "https://rpc.mainnet.fastnear.com";
async function rpc(method, params) {
  if (!["status", "block", "query", "EXPERIMENTAL_protocol_config"].includes(method)) throw new Error("Read only");
  const r = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:"yieldfund-mainnet-probe",method,params}),signal:AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  if(body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
const status = await rpc("status", {});
if(status.chain_id !== "mainnet" || status.sync_info.syncing) throw new Error("Wrong network or syncing");
const {header} = await rpc("block", {finality:"final"});
const query = (params) => rpc("query", {...params,block_id:header.hash});
const view = async (account_id,method_name,args={}) => {
  const r=await query({request_type:"call_function",account_id,method_name,args_base64:Buffer.from(JSON.stringify(args)).toString("base64")});
  return JSON.parse(Buffer.from(r.result).toString());
};
const output = {checkedAt:new Date().toISOString(),network:"mainnet",endpoint,account,block:header,reads:{},errors:{},spendingCapNear:"5",signatures:0,broadcasts:0};
for (const [label,call] of [
  ["operator",()=>query({request_type:"view_account",account_id:account})],
  ["rheaContract",()=>query({request_type:"view_account",account_id:"contract.main.burrow.near"})],
  ["rheaConfig",()=>view("contract.main.burrow.near","get_config")],
  ["wrappedNearMetadata",()=>view("wrap.near","ft_metadata")],
  ["rheaWrappedNearAsset",()=>view("contract.main.burrow.near","get_asset",{token_id:"wrap.near"})],
  ["rheaOperatorPosition",()=>view("contract.main.burrow.near","get_account",{account_id:account})],
  ["protocol",()=>rpc("EXPERIMENTAL_protocol_config",{block_id:header.hash})],
]) { try {output.reads[label]=await call();} catch(e){output.errors[label]=e.message;} }
output.artifacts = {};
for(const name of ["yieldfund_vault.wasm","yieldfund_strategy_simulator.wasm","yieldfund_campaign_factory.wasm","sputnikdao2.wasm"]){
  try {output.artifacts[name]={bytes:(await stat(resolve("artifacts",name))).size};} catch {} }
const cost=output.reads.protocol?.runtime_config?.storage_amount_per_byte;
if(cost) for(const artifact of Object.values(output.artifacts)) artifact.codeStorageYocto=(BigInt(artifact.bytes)*BigInt(cost)).toString();
await writeFile("docs/evidence/mainnet-discovery.json",JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({network:output.network,block:header.height,successfulReads:Object.keys(output.reads),errors:output.errors,artifacts:output.artifacts},null,2));
