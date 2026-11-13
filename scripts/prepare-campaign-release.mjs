// Prepare public testnet calls only. No signing, key access or broadcast.
import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {canonical} from "../packages/near-client/src/chain.ts";
const base=JSON.parse(await readFile("deployments/testnet.json","utf8"));
const evidence=JSON.parse(await readFile("docs/evidence/milestone-15-accounts.json","utf8"));
const factory="yf-factory-261113.testnet",verifier="yf-verify-261113.testnet",creator="yf-creator-261113.testnet",operator="yf-operator-261105.testnet";
const sha=value=>createHash("sha256").update(value).digest("hex");
const call=(id,signerId,receiverId,methodName,args,deposit="0",gas="300000000000000")=>({id,signerId,receiverId,actions:[{type:"FunctionCall",methodName,args,deposit,gas}]});
const policy=structuredClone(base.daoPolicy);policy.roles[0].permissions=["call:AddProposal","call:VoteApprove","call:VoteReject","call:Finalize"];
const steps=[
 {...call("deploy-verifier",verifier,verifier,"new",{config:{name:"YieldFund campaign verification",purpose:"Approve campaign metadata attestations",metadata:""},policy},"0","100000000000000"),artifact:"sputnikdao2.wasm"},
 {...call("deploy-factory",factory,factory,"new",{verifier_id:verifier,token_id:base.config.token_id,token_decimals:6,token_storage:"1250000000000000000000"},"0","100000000000000"),artifact:"yieldfund_campaign_factory.wasm"},
 {id:"fund-second-creator",signerId:verifier,receiverId:operator,actions:[{type:"Transfer",deposit:"4500000000000000000000000"}]},
];
const cost="7235220000000000000000000";
const metadata=[];
for(const [id,name,actor] of [["garden","Community Garden",creator],["builders","Builder Commons",operator]]){
 const content={id,name,beneficiary_id:base.config.beneficiary_id,deposit_cap:"1000000000",token_id:base.config.token_id,disclosure_version:"factory-v1"};
 const metadataHash=sha(canonical(content));metadata.push({content,metadataHash});
 steps.push(call(`create-${id}`,actor,factory,"create_campaign",{id,name,beneficiary_id:content.beneficiary_id,metadata_hash:metadataHash,deposit_cap:content.deposit_cap},cost));
}
const attestation={id:"garden",metadata_hash:metadata[0].metadataHash,evidence_hash:sha(canonical({scope:"testnet funded simulator",repository:"https://github.com/usamahabduljalil/YieldFund",metadata:metadata[0]})),expires_at:String(BigInt(Date.parse("2026-12-01T00:00:00Z"))*1_000_000n)};
const kind={FunctionCall:{receiver_id:factory,actions:[{method_name:"verify_campaign",args:Buffer.from(JSON.stringify(attestation)).toString("base64"),deposit:"1",gas:"30000000000000"}]}};
steps.push(call("propose-verification",policy.roles[0].kind.Group[0],verifier,"add_proposal",{proposal:{description:"Verify Community Garden testnet metadata; funded simulation, no mainnet yield claim",kind}},policy.proposal_bond,"100000000000000"));
for(const [index,actor] of policy.roles[0].kind.Group.slice(0,2).entries())steps.push(call(`vote-${index+1}`,actor,verifier,"act_proposal",{id:0,action:"VoteApprove",proposal:kind},"0","250000000000000"));
const plan={schemaVersion:1,network:"testnet",rpcUrl:base.rpcUrl,factoryId:factory,verifierId:verifier,creationCost:cost,gasAllowance:"500000000000000000000000",accounts:evidence.accounts,artifacts:evidence.hashes,metadata,steps};
await writeFile("deployments/campaign-release.review.json",JSON.stringify(plan,null,2)+"\n");
console.log(JSON.stringify({steps:steps.length,sha256:sha(canonical(plan)),creationCost:cost,gasAllowance:plan.gasAllowance}));
