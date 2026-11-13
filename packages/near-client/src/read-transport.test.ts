import { describe, expect, it, vi } from "vitest";
import { pacedReadTransport } from "./read-transport";

describe("paced read transport", () => {
  it("uses archival history for saved receipts and their blocks only", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    const read = pacedReadTransport(fetcher, 0);
    const cases = [
      [
        "https://test.rpc.fastnear.com",
        "tx",
        {},
        "https://archival-rpc.testnet.fastnear.com",
      ],
      [
        "https://rpc.testnet.fastnear.com/",
        "block",
        { block_id: "old-hash" },
        "https://archival-rpc.testnet.fastnear.com",
      ],
      [
        "https://rpc.testnet.fastnear.com",
        "block",
        { finality: "final" },
        "https://rpc.testnet.fastnear.com",
      ],
      [
        "https://rpc.testnet.fastnear.com",
        "query",
        { block_id: "current-hash" },
        "https://rpc.testnet.fastnear.com",
      ],
      [
        "https://rpc.testnet.fastnear.com.example",
        "tx",
        {},
        "https://rpc.testnet.fastnear.com.example",
      ],
      ["http://127.0.0.1:3030", "tx", {}, "http://127.0.0.1:3030"],
    ] as const;
    for (const [url, method, params, target] of cases) {
      const body = JSON.stringify({ method, params });
      await read(url, { body });
      expect(fetcher).toHaveBeenLastCalledWith(
        target,
        expect.objectContaining({ body }),
      );
    }
  });
  it("routes legacy FASTNEAR reads without mutating the deployment URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    const read = pacedReadTransport(fetcher, 0);
    const options = { body: JSON.stringify({ method: "query" }) };
    await read("https://test.rpc.fastnear.com", options);
    expect(fetcher.mock.calls[0][0]).toBe("https://rpc.testnet.fastnear.com");
    await read("https://test.rpc.fastnear.com/", options);
    expect(fetcher.mock.calls[1][0]).toBe("https://rpc.testnet.fastnear.com");
    await read("https://test.rpc.fastnear.com.example", options);
    expect(fetcher.mock.calls[2][0]).toBe(
      "https://test.rpc.fastnear.com.example",
    );
    await expect(
      read("https://test.rpc.fastnear.com", {
        body: JSON.stringify({ method: "broadcast_tx_commit" }),
      }),
    ).rejects.toThrow("cannot broadcast");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("bounds retries of interrupted read connections", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
      const pending = expect(
        pacedReadTransport(fetcher, 0)("https://test.example", {
          body: JSON.stringify({ method: "query" }),
        }),
      ).rejects.toThrow("fetch failed");
      await vi.runAllTimersAsync();
      await pending;
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("bounds concurrent reads even when responses are slow", async () => {
    vi.useFakeTimers();
    try {
      const finish: Array<(r: Response) => void> = [];
      const fetcher = vi.fn(
        () => new Promise<Response>((resolve) => finish.push(resolve)),
      );
      const read = pacedReadTransport(fetcher, 10, 2);
      const requests = [1, 2, 3].map(() =>
        read("https://test.example", {
          body: JSON.stringify({ method: "query" }),
        }),
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(fetcher).toHaveBeenCalledTimes(2);
      finish[0](new Response("{}"));
      await vi.advanceTimersByTimeAsync(10);
      expect(fetcher).toHaveBeenCalledTimes(3);
      finish[1](new Response("{}"));
      finish[2](new Response("{}"));
      await Promise.all(requests);
    } finally {
      vi.useRealTimers();
    }
  });
  it("serializes reads and retries only rate limited responses", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 429 }))
        .mockResolvedValue(new Response("{}"));
      const read = pacedReadTransport(fetcher, 600, 1);
      const options = { body: JSON.stringify({ method: "query" }) };
      const first = read("https://test.example", options);
      const second = read("https://test.example", options);
      await vi.advanceTimersByTimeAsync(599);
      expect(fetcher).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2600);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(600);
      expect((await first).ok).toBe(true);
      expect((await second).ok).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects writes before calling the network", async () => {
    const fetcher = vi.fn();
    await expect(
      pacedReadTransport(fetcher)("https://test.example", {
        body: JSON.stringify({ method: "send_tx" }),
      }),
    ).rejects.toThrow("cannot broadcast");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns other failures without retry and allows the next read", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValue(new Response("{}"));
    const read = pacedReadTransport(fetcher, 0),
      options = { body: JSON.stringify({ method: "tx" }) };
    expect((await read("https://test.example", options)).status).toBe(503);
    expect((await read("https://test.example", options)).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
