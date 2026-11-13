/** Current hostname for the same testnet provider, without changing manifest scope. */
export function currentRpcUrl(url: string): string {
  return url.replace(/\/$/, "") === "https://test.rpc.fastnear.com"
    ? "https://rpc.testnet.fastnear.com"
    : url;
}

// Pace public RPC reads. Never retry a broadcast or a signing request.
export function pacedReadTransport(
  transport: typeof fetch = (...args) => fetch(...args),
  intervalMs = 600,
  concurrency = 2,
): typeof fetch {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8 ||
    !Number.isFinite(intervalMs) ||
    intervalMs < 0
  )
    throw new Error("Invalid read transport limits");
  const tails: Promise<unknown>[] = Array.from({ length: concurrency }, () =>
    Promise.resolve(),
  );
  let next = 0;
  return (input, init) => {
    // FASTNEAR's current testnet hostname. Keep the reviewed deployment and
    // its persisted Activity scope intact; this only routes allowlisted reads.
    let target =
      typeof input === "string" || input instanceof URL
        ? currentRpcUrl(String(input))
        : input;
    const { method, params } = JSON.parse(String(init?.body));
    if (
      ![
        "status",
        "block",
        "query",
        "gas_price",
        "EXPERIMENTAL_protocol_config",
        "tx",
      ].includes(method)
    )
      return Promise.reject(
        new Error("Read transport cannot broadcast transactions"),
      );
    // Saved submissions can outlive regular-node history. Keep current state
    // on the regular endpoint and resolve receipts and their blocks archivally.
    if (
      typeof target === "string" &&
      target.replace(/\/$/, "") === "https://rpc.testnet.fastnear.com" &&
      (method === "tx" ||
        (method === "block" && params?.block_id !== undefined))
    )
      target = "https://archival-rpc.testnet.fastnear.com";
    const slot = next++ % tails.length;
    const run = tails[slot].then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        try {
          const response = await transport(target, {
            ...init,
            signal: AbortSignal.timeout(15000),
          });
          if (response.status !== 429 || attempt === 2) return response;
        } catch (error) {
          if (attempt === 2) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("RPC read retries exhausted");
    });
    tails[slot] = run.catch(() => undefined);
    return run;
  };
}

// Registry panels and the selected vault share one browser-wide read budget.
// Separate per-client queues multiplied concurrency when browsing campaigns.
export const publicReadTransport = pacedReadTransport();
