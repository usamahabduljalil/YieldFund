import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { ArrowUpRight, ArrowsClockwise } from "@phosphor-icons/react";
import { formatAmount, parseAmount } from "@yieldfund/domain";
import type {
  Intent,
  Submission,
} from "../../../packages/near-client/src/actions";
import {
  recoveryKind,
  recoveryReadyAt,
} from "../../../packages/near-client/src/actions";
import type {
  Operation,
  Proposal,
} from "../../../packages/near-client/src/chain";
import { useChain, type Review } from "./chain-store";
import { useWallet } from "./wallet";
import { Badge, Empty, Metric, Modal, Money, Notice } from "./components";
import { NotFound } from "./public-pages";
const label = (text: string) => text.replaceAll("_", " ");
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Could not complete this action.";
function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">
          {useChain().deployment.displayName ?? "The Commons"} / ON-CHAIN
        </span>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  );
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <div className="chain-panel-body">{children}</div>
    </section>
  );
}
function Data({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="chain-data">
      {items.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        ["completed", "finalized"].includes(value)
          ? "success"
          : ["needs_reconciliation", "unknown", "Failed", "attention"].includes(
                value,
              )
            ? "danger"
            : "neutral"
      }
    >
      {label(value)}
    </Badge>
  );
}
function TransactionReview({
  review,
  onClose,
}: {
  review: Review;
  onClose: () => void;
}) {
  const c = useChain();
  const [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const args = review.call.args;
  const recovery =
    review.intent.kind === "recover" ? review.intent.operation : undefined;
  const payment =
    review.intent.kind === "propose"
      ? { amount: review.intent.amount, receiver_id: review.intent.recipient }
      : review.intent.kind === "vote"
        ? review.intent.proposal.kind.Transfer
        : undefined;
  const tokenAmount =
    payment?.amount ??
    recovery?.units ??
    args.amount ??
    args.units ??
    args.max_amount;
  async function sign() {
    setBusy(true);
    setError("");
    try {
      await c.submit(review);
      onClose();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  // Native modal dialogs occupy the browser's top layer. Release that layer
  // while the connector opens its iframe, or the wallet cannot be interacted with.
  if (busy)
    return (
      <div role="status" className="transaction-form">
        <p>Checking transaction and waiting for wallet.</p>
        <Link to="/app/activity">Follow transaction status</Link>
      </div>
    );
  return (
    <Modal
      title="Review transaction"
      contextLabel="YIELDFUND / NEAR TESTNET"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="transaction-form">
        <Data
          items={[
            ["Action", label(review.call.methodName)],
            ["Account", review.account],
            ["Contract", review.call.receiverId],
            ["Token", c.deployment.config.token_id],
            ["DAO", c.deployment.config.beneficiary_id],
            ...(recovery
              ? [
                  ["Original recipient / owner", recovery.owner_id] as [
                    string,
                    ReactNode,
                  ],
                  [
                    "Minimum payout",
                    `${formatAmount(BigInt(recovery.minimum))} tUSD`,
                  ] as [string, ReactNode],
                ]
              : []),
            ...(payment
              ? [["Recipient", payment.receiver_id] as [string, ReactNode]]
              : []),
            ...(tokenAmount
              ? [
                  [
                    "Amount",
                    `${formatAmount(BigInt(String(tokenAmount)))} tUSD`,
                  ] as [string, ReactNode],
                ]
              : []),
            ...(review.intent.kind === "withdraw"
              ? [
                  [
                    "Minimum payout",
                    `${formatAmount(BigInt(review.intent.minimum))} tUSD`,
                  ] as [string, ReactNode],
                ]
              : []),
            ["Attached NEAR", `${review.call.deposit} yoctoNEAR`],
            [
              "Gas limit",
              `${BigInt(review.call.gas) / 1_000_000_000_000n} Tgas`,
            ],
          ]}
        />
        {review.intent.kind === "withdraw" && (
          <Notice>
            Withdrawals may be delayed. Losses reduce your payout; redeemed
            units give up future recovery.
          </Notice>
        )}
        {review.intent.kind === "deposit" && (
          <Notice>
            Test tokens enter vault custody. Capital can lose value, and
            withdrawals may be delayed. Strategy profit is simulated.
          </Notice>
        )}
        {recovery && (
          <Notice>
            {recoveryKind(recovery) === "balance"
              ? "Restarts the balance check and may complete the original payment. Losses and your original minimum still apply."
              : "Checks the strategy's completed return. This does not resend the redemption or credit funds twice."}
          </Notice>
        )}
        <details>
          <summary>Transaction parameters</summary>
          <pre className="chain-json">
            {JSON.stringify(review.call, null, 2)}
          </pre>
        </details>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          I reviewed the network, recipient and transaction.
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button
          className="button full-width"
          disabled={!ack || busy}
          onClick={() => void sign()}
        >
          {busy ? "Waiting for wallet / receipts…" : "Confirm in wallet"}
        </button>
        <Link to="/app/activity" onClick={onClose}>
          Follow transaction status
        </Link>
      </div>
    </Modal>
  );
}
function ActionButton({
  intent,
  children,
}: {
  intent: Intent;
  children: ReactNode;
}) {
  const c = useChain(),
    w = useWallet();
  const [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function act() {
    setBusy(true);
    setError("");
    try {
      setReview(await c.prepare(intent));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="button secondary small"
        disabled={
          busy || !w.account || !c.deployment.transactionsEnabled || !!c.error
        }
        onClick={() => void act()}
      >
        {busy ? "Checking…" : children}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {review && (
        <TransactionReview review={review} onClose={() => setReview(null)} />
      )}
    </>
  );
}
function AmountForm({
  kind,
}: {
  kind: "deposit" | "withdraw" | "allocate" | "donate";
}) {
  const c = useChain(),
    w = useWallet();
  const [value, setValue] = useState(""),
    [min, setMin] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState<Review | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const amount = parseAmount(value).toString();
      setReview(
        await c.prepare(
          kind === "withdraw"
            ? { kind, amount, minimum: parseAmount(min).toString() }
            : { kind, amount },
        ),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="chain-form" onSubmit={(e) => void submit(e)}>
      <label>
        {kind === "withdraw" ? "Nominal units" : "Amount · tUSD"}
        <input
          required
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      {kind === "withdraw" && (
        <label>
          Minimum payout · tUSD
          <input
            required
            inputMode="decimal"
            placeholder="Set your minimum"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button"
        disabled={
          busy || !w.account || !c.deployment.transactionsEnabled || !!c.error
        }
      >
        {busy
          ? "Checking…"
          : `Review ${kind === "donate" ? "yield donation" : kind}`}
      </button>
      {review && (
        <TransactionReview review={review} onClose={() => setReview(null)} />
      )}
    </form>
  );
}
function Operations({ rows }: { rows: Operation[] }) {
  return rows.length ? (
    <div className="chain-table-wrap">
      <table className="chain-table">
        <thead>
          <tr>
            <th>Operation</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>
                #{o.id} · {label(o.kind)}
              </td>
              <td>
                <Money amount={BigInt(o.units)} />
              </td>
              <td>
                <Status value={o.stage} />
              </td>
              <td>
                <Link
                  to={`/app/operations/${o.id}`}
                  aria-label={`Open operation ${o.id}`}
                >
                  View <ArrowUpRight />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="No operations yet" />
  );
}
function Overview() {
  const { snapshot: s, deployment: d } = useChain();
  if (!s) return null;
  const a = s.accounting;
  return (
    <>
      <Heading title="Grow a shared future.">
        <Link className="button" to={`/app/campaigns/${d.config.campaign_id}`}>
          Support campaign <ArrowUpRight />
        </Link>
      </Heading>
      <div className="metric-grid">
        <Metric label="Outstanding capital units" amount={BigInt(a.nominal)} />
        <Metric label="Recognized idle cash" amount={BigInt(a.cash)} />
        <Metric label="Eligible yield" amount={BigInt(a.eligible_yield)} />
        <Metric label="Confirmed DAO funding" amount={BigInt(a.donated)} />
      </div>
      {!a.settled && (
        <Notice>
          Strategy settlement pending. Book values are not withdrawal quotes.
        </Notice>
      )}
      {a.shortfall !== "0" && a.settled && (
        <Notice>
          Capital is impaired. Deposits and yield donations are unavailable.
        </Notice>
      )}
      <div className="chain-columns">
        <Panel title={d.displayName ?? "The Commons"}>
          <p>Community funding through eligible surplus.</p>
          <Data
            items={[
              ["Strategy", "Funded simulator"],
              ["Vault", d.vaultId],
              ["Treasury", d.config.beneficiary_id],
              ["Capital status", a.settled ? "Settled" : "Unsettled"],
              ["Strategy book", <Money amount={BigInt(a.strategy_book)} />],
            ]}
          />
        </Panel>
        <Panel title="Capital flow">
          <Data
            items={[
              [
                "Strategy position",
                <Money amount={BigInt(s.strategy.position)} />,
              ],
              ["Excluded funds", <Money amount={BigInt(a.excluded)} />],
              [
                "Outbound reservation",
                <Money amount={BigInt(a.reserved_outbound)} />,
              ],
              [
                "Treasury balance",
                <Money amount={BigInt(s.treasuryBalance)} />,
              ],
            ]}
          />
          <Link className="text-link" to="/app/treasury">
            Open treasury <ArrowUpRight />
          </Link>
        </Panel>
      </div>
      <Panel title="Campaign operations">
        <Operations rows={s.operations} />
      </Panel>
    </>
  );
}
function Campaign() {
  const { snapshot: s, deployment: d } = useChain();
  const w = useWallet();
  if (!s) return null;
  return (
    <>
      <Heading title={`Support ${d.displayName ?? "The Commons"}`} />
      <div className="chain-columns">
        <Panel title="Your contribution">
          <Badge tone="blue">Simulated strategy</Badge>
          <Data
            items={[
              ["Token", d.config.token_id],
              ["Treasury", d.config.beneficiary_id],
              ["Campaign cap", <Money amount={BigInt(d.config.deposit_cap)} />],
              [
                "Wallet balance",
                w.account ? (
                  <Money amount={BigInt(s.tokenBalance)} />
                ) : (
                  "Connect wallet"
                ),
              ],
            ]}
          />
          <Link to="/risks">Risks & disclosures</Link>
        </Panel>
        <Panel title="Deposit test tokens">
          {!w.account ? (
            <Notice>Connect your testnet wallet to continue.</Notice>
          ) : (
            <>
              <div className="chain-actions">
                {!s.tokenRegistered && (
                  <ActionButton intent={{ kind: "register-token" }}>
                    Register token storage
                  </ActionButton>
                )}
                {!s.position && (
                  <ActionButton intent={{ kind: "register-position" }}>
                    Register position
                  </ActionButton>
                )}
              </div>
              <AmountForm kind="deposit" />
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
function Positions() {
  const { snapshot: s } = useChain(),
    w = useWallet();
  if (!s) return null;
  const p = s.position;
  return (
    <>
      <Heading title="Your capital, clearly." />
      {!w.account ? (
        <Empty title="Connect your wallet to see your position" />
      ) : !p ? (
        <Empty title="No position registered">
          <Link to="/app/campaigns">Browse campaigns</Link>
        </Empty>
      ) : (
        <>
          <div className="metric-grid three">
            <Metric label="Nominal units" amount={BigInt(p.nominal)} />
            <Metric label="Reserved units" amount={BigInt(p.reserved)} />
            <Metric label="Paid withdrawals" amount={BigInt(p.withdrawn)} />
          </div>
          <div className="chain-columns">
            <Panel title="Request a withdrawal">
              <AmountForm kind="withdraw" />
            </Panel>
            <Panel title="Settlement">
              <Data
                items={[
                  [
                    "Status",
                    s.accounting.settled ? "Settled" : "Redeem strategy first",
                  ],
                  [
                    "Available units",
                    <Money amount={BigInt(p.nominal) - BigInt(p.reserved)} />,
                  ],
                ]}
              />
              <Notice>
                A request reserves units. Payment happens after strategy
                redemption and a fresh balance check.
              </Notice>
            </Panel>
          </div>
          <Panel title="Your requests">
            <Operations
              rows={s.operations.filter(
                (o) => o.owner_id === w.account && o.kind === "withdrawal",
              )}
            />
          </Panel>
        </>
      )}
    </>
  );
}
function ProposalForm() {
  const c = useChain(),
    w = useWallet();
  const [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState(""),
    [description, setDescription] = useState(""),
    [error, setError] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setReview(
        await c.prepare({
          kind: "propose",
          recipient,
          amount: parseAmount(amount).toString(),
          description,
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="chain-form" onSubmit={(e) => void submit(e)}>
      <label>
        Recipient
        <input
          required
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="contributor.testnet"
        />
      </label>
      <label>
        Amount · tUSD
        <input
          required
          value={amount}
          inputMode="decimal"
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      </label>
      <label>
        Purpose
        <input
          required
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button"
        disabled={
          busy || !w.account || !c.deployment.transactionsEnabled || !!c.error
        }
      >
        {busy ? "Checking…" : "Review proposal"}
      </button>
      {review && (
        <TransactionReview review={review} onClose={() => setReview(null)} />
      )}
    </form>
  );
}
function Treasury() {
  const { snapshot: s, deployment: d } = useChain();
  if (!s) return null;
  return (
    <>
      <Heading title="A budget built together." />
      <div className="metric-grid three">
        <Metric label="Treasury balance" amount={BigInt(s.treasuryBalance)} />
        <Metric
          label="Vault funding confirmed"
          amount={BigInt(s.accounting.donated)}
        />
        <div className="metric">
          <span className="metric-label">Approval policy</span>
          <strong>
            {typeof s.policy.default_vote_policy.threshold === "string"
              ? s.policy.default_vote_policy.threshold
              : "Policy ratio"}
          </strong>
          <span className="metric-note">Required council votes</span>
        </div>
      </div>
      <div className="chain-columns">
        <Panel title="Payment proposals">
          {s.proposals.length ? (
            <ul className="chain-list">
              {s.proposals.map((p) => (
                <li key={p.id}>
                  <Link to={`/app/treasury/proposals/${p.id}`}>
                    <strong>{p.description}</strong>
                    <span>
                      #{p.id} · {p.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No proposals yet" />
          )}
          <small>
            Latest {s.proposals.length} of {s.proposalCount} proposals.
          </small>
        </Panel>
        <Panel title="Propose a payment">
          <ProposalForm />
        </Panel>
      </div>
      <Panel title="Governance">
        <Data
          items={[
            ["DAO", d.config.beneficiary_id],
            ["Token", d.config.token_id],
            [
              "Members",
              s.policy.roles
                .flatMap((r) =>
                  typeof r.kind === "object" && "Group" in r.kind
                    ? r.kind.Group
                    : [],
                )
                .join(", "),
            ],
            ["Bond", `${s.policy.proposal_bond} yoctoNEAR`],
          ]}
        />
        <p>
          Deposits do not grant voting rights. Payment needs a successful token
          receipt.
        </p>
      </Panel>
    </>
  );
}
function ProposalDetail() {
  const { proposalId } = useParams();
  const c = useChain();
  const [p, setP] = useState<Proposal | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setP(null);
    setError("");
  }, [c.client, proposalId]);
  useEffect(() => {
    let alive = true;
    void c.client
      .proposal(Number(proposalId))
      .then((v) => {
        if (alive) setP(v);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [c.client, proposalId, c.snapshot?.height]);
  return (
    <>
      <Heading title={`Proposal #${proposalId}`} />
      {error && <Notice>{error}</Notice>}
      {p && (
        <Panel title={p.description}>
          <Status value={p.status} />
          {p.kind.Transfer?.token_id === c.deployment.config.token_id &&
          p.kind.Transfer.msg === null ? (
            <>
              <Data
                items={[
                  ["Recipient", p.kind.Transfer.receiver_id],
                  ["Amount", <Money amount={BigInt(p.kind.Transfer.amount)} />],
                  ["Token", p.kind.Transfer.token_id],
                  [
                    "Votes",
                    Object.entries(p.votes)
                      .map(([a, v]) => `${a}: ${v}`)
                      .join(", ") || "No votes",
                  ],
                ]}
              />
              <div className="chain-actions">
                {p.status === "InProgress" && (
                  <>
                    <ActionButton
                      intent={{
                        kind: "vote",
                        proposal: p,
                        action: "VoteApprove",
                      }}
                    >
                      Approve
                    </ActionButton>
                    <ActionButton
                      intent={{
                        kind: "vote",
                        proposal: p,
                        action: "VoteReject",
                      }}
                    >
                      Reject
                    </ActionButton>
                  </>
                )}
                {p.status === "Failed" && (
                  <ActionButton
                    intent={{ kind: "vote", proposal: p, action: "Finalize" }}
                  >
                    Retry failed payment
                  </ActionButton>
                )}
              </div>
            </>
          ) : (
            <Notice>
              This proposal type is not supported in this interface.
            </Notice>
          )}
          {p.status === "Approved" && (
            <Notice>
              {c.submissions.some(
                (r) =>
                  r.paymentConfirmed &&
                  r.call.methodName === "act_proposal" &&
                  r.call.args.id === p.id,
              )
                ? "Payment receipt verified in this browser."
                : "Approved by the DAO. Confirm the recipient token receipt in Activity before treating this as paid."}
            </Notice>
          )}
          <Link to="/app/activity">Inspect transaction receipts</Link>
        </Panel>
      )}
    </>
  );
}
function SubmissionRow({ row }: { row: Submission }) {
  const c = useChain();
  const [hash, setHash] = useState(row.hash ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    setError("");
    try {
      await c.track(row.id, hash || undefined);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chain-submission">
      <div className="chain-actions">
        <strong>{label(row.call.methodName)}</strong>
        <Status value={row.state} />
      </div>
      <small>
        {row.accountId} · {new Date(row.createdAt).toLocaleString()}
      </small>
      <strong>{row.summary}</strong>
      <p className="chain-hash">{row.hash || "No transaction hash received"}</p>
      {row.error && <Notice>{row.error}</Notice>}
      {["unknown", "submitted", "awaiting-wallet"].includes(row.state) && (
        <div className="chain-form">
          <label>
            Transaction hash
            <input
              value={hash}
              onChange={(e) => setHash(e.target.value)}
              placeholder="Copy from wallet history"
            />
          </label>
          <button
            className="button secondary small"
            disabled={busy || !hash}
            onClick={() => void check()}
          >
            {busy ? "Checking…" : "Check finalized receipts"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="chain-actions">
        {row.operationIds.map((id) => (
          <Link key={id} to={`/app/operations/${id}`}>
            Operation #{id}
          </Link>
        ))}
        {row.hash && c.deployment.network === "testnet" && (
          <a
            href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(row.hash)}`}
            target="_blank"
            rel="noreferrer"
          >
            Transaction explorer <ArrowUpRight />
          </a>
        )}
      </div>
      {row.receiptIds.length > 0 && (
        <details>
          <summary>{row.receiptIds.length} finalized outcome IDs</summary>
          <ul className="chain-hash">
            {row.receiptIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
function Activity() {
  const c = useChain();
  return (
    <>
      <Heading title="Every step, accounted for." />
      <Panel title="Wallet submissions">
        {c.submissions.length ? (
          [...c.submissions]
            .reverse()
            .map((r) => <SubmissionRow key={r.id} row={r} />)
        ) : (
          <Empty title="No wallet submissions in this browser" />
        )}
        <p>
          Finalized means the receipts were checked. Contract operations
          determine whether funds were accepted or paid.
        </p>
      </Panel>
      <Panel title="Campaign journal">
        <Operations rows={c.snapshot?.operations ?? []} />
        <small>First 50 operations. Open any operation by its ID below.</small>
        <OperationLookup />
      </Panel>
    </>
  );
}
function OperationLookup() {
  const [id, setId] = useState("");
  return (
    <div className="chain-actions">
      <label>
        Operation ID
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          inputMode="numeric"
        />
      </label>
      {/^[1-9]\d*$/.test(id) && (
        <Link className="button secondary small" to={`/app/operations/${id}`}>
          Open operation
        </Link>
      )}
    </div>
  );
}
function OperationDetail() {
  const { operationId } = useParams();
  const c = useChain();
  const w = useWallet();
  const [o, setO] = useState<Operation | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setO(null);
    setError("");
  }, [c.client, operationId]);
  useEffect(() => {
    let alive = true;
    void c.client
      .operation(operationId ?? "")
      .then((v) => {
        if (alive) {
          setO(v);
          setError(v ? "" : "Operation not found");
        }
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [c.client, operationId, c.snapshot?.height]);
  return (
    <>
      <Heading title={`Operation #${operationId}`} />
      {error && <Notice>{error}</Notice>}
      {o && (
        <Panel title={label(o.kind)}>
          <Status value={o.stage} />
          <Data
            items={[
              ["Owner / recipient", o.owner_id],
              ["Requested", <Money amount={BigInt(o.units)} />],
              ["Payout / returned", <Money amount={BigInt(o.payout)} />],
              ["Minimum", <Money amount={BigInt(o.minimum)} />],
              ["Version", o.version],
              [
                "Updated",
                new Date(
                  Number(BigInt(o.updated_at) / 1_000_000n),
                ).toLocaleString(),
              ],
            ]}
          />
          {o.error && <Notice>{label(o.error)}</Notice>}
          <div className="chain-actions">
            {recoveryKind(o) &&
              c.snapshot?.accounting.active_operation === o.id &&
              (c.snapshot.timestamp >= recoveryReadyAt(o) ? (
                <ActionButton intent={{ kind: "recover", operation: o }}>
                  {recoveryKind(o) === "balance"
                    ? "Resume balance check"
                    : "Verify strategy return"}
                </ActionButton>
              ) : (
                <small>
                  Recovery available after{" "}
                  {new Date(recoveryReadyAt(o)).toLocaleTimeString()}.
                </small>
              ))}
            {["requested", "retryable_failure"].includes(o.stage) && (
              <ActionButton intent={{ kind: "advance", operation: o }}>
                Advance operation
              </ActionButton>
            )}
            {o.kind === "withdrawal" &&
              o.owner_id === w.account &&
              ["requested", "retryable_failure"].includes(o.stage) && (
                <ActionButton intent={{ kind: "cancel", operation: o }}>
                  Cancel request
                </ActionButton>
              )}
          </div>
          {[
            "needs_reconciliation",
            "transfer_pending",
            "allocating",
            "redeeming",
          ].includes(o.stage) && (
            <Notice>
              Outcome unresolved. Do not replay the transfer. Refresh and
              inspect the finalized receipts.
            </Notice>
          )}
          {c.submissions
            .filter((r) => r.operationIds.includes(o.id))
            .map((r) => (
              <SubmissionRow key={r.id} row={r} />
            ))}
        </Panel>
      )}
    </>
  );
}
function Manage() {
  const c = useChain(),
    w = useWallet();
  const s = c.snapshot;
  if (!s) return null;
  const guardian = w.account === c.deployment.config.guardian_id;
  return (
    <>
      <Heading title="Campaign operations" />
      <Panel title="Deployment">
        <Data
          items={[
            ["Network", c.deployment.network],
            ["Guardian", c.deployment.config.guardian_id],
            ["Strategy", c.deployment.config.strategy_id],
            ["Authority", c.deployment.authority],
            [
              "Write access",
              c.deployment.transactionsEnabled
                ? "Wallet confirmation required"
                : "Read-only",
            ],
          ]}
        />
        <details>
          <summary>Verified code hashes</summary>
          <pre className="chain-json">
            {JSON.stringify(c.deployment.codeHashes, null, 2)}
          </pre>
        </details>
      </Panel>
      <div className="chain-columns">
        <Panel title="Redeem & reconcile">
          <div className="chain-actions">
            <ActionButton intent={{ kind: "redeem" }}>
              Redeem full strategy
            </ActionButton>
            {s.accounting.queued_redemption && (
              <Link to={`/app/operations/${s.accounting.queued_redemption}`}>
                Queued redemption #{s.accounting.queued_redemption}
              </Link>
            )}
            {guardian && (
              <ActionButton intent={{ kind: "checkpoint" }}>
                Reconcile cash
              </ActionButton>
            )}
          </div>
        </Panel>
        <Panel title="New risk">
          {guardian ? (
            <ActionButton
              intent={{ kind: "pause", paused: !s.accounting.paused }}
            >
              {s.accounting.paused ? "Resume new risk" : "Pause new risk"}
            </ActionButton>
          ) : (
            <p>Guardian controls require the configured account.</p>
          )}
        </Panel>
      </div>
      {guardian && (
        <div className="chain-columns">
          <Panel title="Allocate idle capital">
            <AmountForm kind="allocate" />
          </Panel>
          <Panel title="Donate eligible yield">
            <AmountForm kind="donate" />
          </Panel>
        </div>
      )}
    </>
  );
}
export function ChainBanner() {
  const c = useChain();
  return (
    <div className="preview-banner">
      <span>
        <span className="preview-label">
          {c.deployment.network === "sandbox"
            ? "LOCAL SANDBOX"
            : "NEAR TESTNET"}
        </span>
        Simulated strategy{!c.deployment.transactionsEnabled && " · Read only"}{" "}
        ·{" "}
        {c.snapshot
          ? `Final block ${c.snapshot.height}`
          : "Checking deployment…"}
      </span>
      <button disabled={c.loading} onClick={() => void c.refresh()}>
        <ArrowsClockwise size={16} />
        {c.loading ? "Checking…" : "Refresh"}
      </button>
    </div>
  );
}
function SelectedCampaign() {
  const { campaignId } = useParams();
  const { deployment } = useChain();
  return campaignId === deployment.config.campaign_id ? (
    <Campaign />
  ) : (
    <Empty title="Select this campaign from the directory">
      <Link to="/app/campaigns">Browse campaigns</Link>
    </Empty>
  );
}
export function ChainRoutes() {
  const c = useChain();
  return (
    <>
      {c.error && (
        <Notice>
          Reads unavailable: {c.error}. Signing is disabled until checks pass.
        </Notice>
      )}
      {!c.snapshot ? (
        <Empty
          title={c.loading ? "Checking contracts…" : "Cannot load deployment"}
        >
          <button className="button secondary" onClick={() => void c.refresh()}>
            Retry
          </button>
        </Empty>
      ) : (
        <>
          <div className="chain-read-status">
            <Badge tone="blue">
              {c.deployment.transactionsEnabled ? "Contract mode" : "Read-only"}
            </Badge>
            <span>
              Data as of {new Date(c.snapshot.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <Routes>
            <Route index element={<Overview />} />
            <Route
              path="campaigns/:campaignId"
              element={<SelectedCampaign />}
            />
            <Route path="positions" element={<Positions />} />
            <Route path="treasury" element={<Treasury />} />
            <Route
              path="treasury/proposals/:proposalId"
              element={<ProposalDetail />}
            />
            <Route path="activity" element={<Activity />} />
            <Route
              path="operations/:operationId"
              element={<OperationDetail />}
            />
            <Route path="manage" element={<Manage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </>
      )}
    </>
  );
}
