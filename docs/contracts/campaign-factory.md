# Campaign factory and DAO attestations

The factory embeds the normal vault and funded simulator Wasm. Build with `bash scripts/build-factory.sh`; source template changes produce a new factory code hash. It does not embed fault-injection or loss-control artifacts and does not support real Rhea strategies yet.

## Initialization and costs

Initialize atomically with deployment, from the factory account:

```json
{"verifier_id":"verification-dao.testnet","token_id":"token.testnet","token_decimals":6,"token_storage":"1250000000000000000000"}
```

These IDs are examples, not public deployments. `verifier_id` must be the selected governance DAO. Deployment preparation must independently inspect its code, policy and authority; the factory authenticates the predecessor account, not whether it is a DAO. A single council member calling directly is rejected even when the originating transaction signer is a member.

Read `get_config` and `creation_cost`. Creation funding covers each child template's code storage, 4,096 state bytes, a 0.5 NEAR operating buffer, three configured token registration deposits, and 4,096 bytes for the registry/attestation. Code storage and balances are not gas fees. Token storage bounds must be checked before factory deployment. Excess token registration refunds remain in the factory.

## Public methods

| Method | Deposit/access | Result |
| --- | --- | --- |
| `create_campaign({id,name,beneficiary_id,metadata_hash,deposit_cap})` | Anyone; exact creation cost; at least 250 Tgas | Creates keyless `v-ID.FACTORY` and `s-ID.FACTORY` children, registers token storage |
| `get_config()` | View | Fixed token/verifier, template hashes, creation cost and count |
| `get_campaign({id})` | View | Immutable identity, creator, child accounts, status and optional attestation |
| `get_creation_progress({id})` | View, v2 | Child/registration proofs, version and last update |
| `recover_campaign({id,version})` | Anyone, v2; 1 yoctoNEAR; 300 Tgas; five-minute cooldown | Proves existing work and resumes the immutable setup without another creation deposit |
| `list_campaigns({from_index,limit})` | View | At most 50 records; decimal-string u64 offset |
| `is_verified({id})` | View | Ready, unrevoked, matching metadata and not expired |
| `verify_campaign({id,metadata_hash,evidence_hash,expires_at})` | Configured DAO only; exactly 1 yoctoNEAR | Records expiring attestation for ready campaign |
| `revoke_verification({id})` | Configured DAO only; exactly 1 yoctoNEAR | Revokes existing attestation |

IDs are 1–24 lowercase letters/digits/hyphens with no edge hyphens; resulting account IDs must fit NEAR's account bound. Name is nonblank and at most 80 UTF-8 bytes. Hashes are 64 lowercase hex characters. Cap is a positive u128 token-base-unit string. `expires_at` is a u64 string in nanoseconds, after the chain timestamp.

## Governance

The verification DAO uses a Sputnik `FunctionCall` proposal targeting the factory. Its action carries `method_name: verify_campaign`, base64 JSON arguments, `deposit: "1"` and sufficient gas. DAO members vote on the exact proposal kind. The factory only receives the call once the DAO executes the approved proposal. Revocation uses the same process with `revoke_verification`.

Beneficiary DAO payment permissions and verification DAO function-call permissions are separate. Do not broaden the historically deployed transfer-only treasury policy or treat token deposits as voting rights. Creators may publish unverified campaigns; verification cannot change custody, destination, metadata or capital claims.

## Failure and trust boundaries

`creating` → `registering` → `ready` requires successful child initialization and all three registrations. A failed callback result records `failed`; stale callbacks are rejected. The current first callback schedules registrations asynchronously, so a successful outer result is not sufficient: inspect final receipts and the registry's ready state.

The historical v1 deployment has no partial-creation recovery. New v2 source preserves per-child/registration proofs, fences stale callbacks and resumes setup using protected native reserves. It never redeploys an existing child or accepts a second creation deposit. Pending native refunds can delay a retry; setup remains incomplete until all proofs succeed. IDs cannot be reused, and recovery is completion of the original setup, not a cancellation/refund promise. See [Recovery v2](recovery-v2.md). New state layouts require fresh deployments; these changes do not upgrade the historical public factory.

Child accounts have no access keys, but factory deployment authority is a separate trust decision. An upgradeable factory can change future template behavior or registry data. Inspect and disclose keys/code hashes. Historical testnet contracts retain their original keys and are not factory children.
