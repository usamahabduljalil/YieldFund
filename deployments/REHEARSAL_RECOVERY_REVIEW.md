# Interrupted deposit recovery review

Prepared 9 November 2026. **Approved by the user on 9 November 2026: “Approve the recovery exception.”**

The original eleven-call rehearsal was approved. Call 1, position registration, finalized as `8gviMwprxgvhhjVjhJDwWiCMUW4UCLoxky6PhwxSBKvd`. Its attachment was 0.00512 testnet NEAR and its full receipt-tree fee was 0.000205723921758 NEAR. No tUSD moved.

The browser persisted call 2 before opening the CLI wallet, then the session was interrupted. It now shows Unknown with no hash. No deposit signing command, signed payload or broadcast was produced by the rehearsal runner. The latest [public observations](../docs/evidence/milestone-9-interruption.json), block 276897367, confirm unchanged token balances and operator nonce `276321233000013`. These observations do not prove the absence of a hypothetical externally signed pending transaction.

The original [review](REHEARSAL_REVIEW.md) says: “Stop on … unknown outcome” and “no fresh-transaction retry … is included.” Therefore the runner stopped; the saved Activity entry remains intact.

## Proposed exception

Complete the existing deposit intent once, through the existing Windows keychain, then attach its independently verified finalized hash to the existing Unknown Activity entry. Do not clear browser history, create a second deposit entry, repeat registration, or change any recipient or amount.

Exact call:

```json
{
  "signerId": "yf-operator-261105.testnet",
  "publicKey": "ed25519:f7h5tvUvj7pz8e8hT8SEY7udNTxpRXpi3JVPcVCri1b",
  "receiverId": "token.yf-operator-261105.testnet",
  "methodName": "ft_transfer_call",
  "args": {
    "receiver_id": "vault.yf-operator-261105.testnet",
    "amount": "1000000000",
    "msg": "deposit"
  },
  "deposit": "1",
  "gas": "300000000000000",
  "requiredNonce": "276321233000014"
}
```

Before signing, repeat exact contract, key, accounting, token-balance and funding checks. The confirmed operator nonce must still be `276321233000013`. Decode and verify the signed payload; refuse broadcast unless its nonce is exactly `276321233000014`. Using the same next nonce prevents this candidate and another candidate at that nonce from both executing. Any changed state, unexpected nonce, failed receipt or unknown broadcast stops execution again.

After receipt verification, recover the existing Activity entry by its exact hash. Continue original steps 3–11 only after the deposit is confirmed to have accepted exactly 1,000 tUSD and credited exactly 1,000 nominal units.

The original ceilings remain unchanged: 0.188 testnet NEAR attachments and 1.25 testnet NEAR total gas for the entire rehearsal, including registration already spent. This is an exception for the interrupted deposit handoff, not authorization for extra transactions, a second deposit, new keys, deployment, mainnet or publication. Record this deposit as browser-initiated with manual CLI/hash recovery, not a normal wallet return.
