# Testnet release funding correction

The first four approved steps finalized: verifier deployment, factory deployment, 4.5 NEAR transfer and Garden creation. Builders creation was rejected as `InvalidTxError.NotEnoughBalance` before execution. Submitted hash: `ASCxHHN2zmYiz8yMwnBY8mjdeF5NarQSurQc2Mys2bct`, nonce `276321233000021`.

The operator had 7.367383505767004599999993 testnet NEAR; protocol transaction admission required 7.5361403853842935, including 7.23522 attached creation funding and prepaid gas reserve. The original preflight underestimated admission funding; actual burned fees are much smaller than this temporary reserve.

Proposed correction: **one transfer of exactly 0.2 testnet NEAR** from `yf-creator-261113.testnet` to `yf-operator-261105.testnet`, using the creator's existing keychain key. No new faucet or mainnet funds. Keep the aggregate **0.5 testnet NEAR burned-fee cap**, including this additional transfer. Original creation funding and DAO bond are unchanged.

Then broadcast the existing reviewed Builders signed bytes once, only after a fresh query confirms its hash is unknown, its nonce remains unused, and `get_campaign({id:"builders"})` is null. If the block reference has expired, stop; do not silently create a replacement transaction. Save the rejection, correction receipt, nonce/state checks and original hash before any resend. Finish the remaining approved proposal and two votes after the Builders receipt and ready-state audit pass.

The user explicitly approved this correction. Transfer `8fqy8GXrMhBtca9Atzch7fNmehXFGdZBt1SqEzpNHht4` finalized, then the existing Builders hash finalized once. All remaining approved steps completed. Total fees including correction: 0.0584708461110246 testnet NEAR. This approval is exhausted; do not replay it. See docs/evidence/milestone-15-execution.json.
