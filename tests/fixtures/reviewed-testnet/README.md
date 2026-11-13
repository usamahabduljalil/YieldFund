# Historical deployment artifacts

These four public Wasm files are the exact binaries reviewed and deployed for the original November 2026 testnet rehearsal. They are test fixtures, not the current source build. The factory-compatible vault and simulator have different code hashes.

`scripts/deployment.mjs` checks their pinned SHA-256 values on every artifact/preflight test. Tests always run against this directory, including clean CI checkouts. To reproduce the download from the currently deployed public contracts:

```sh
node --experimental-strip-types scripts/fetch-reviewed-artifacts.mjs
```

The download fails if deployed code differs from the historical reviewed hashes. No keys or signed transaction payloads are included. Sputnik is the unmodified upstream artifact described in `docs/contracts/strategy-and-dao.md`; see the upstream license and attribution there.
