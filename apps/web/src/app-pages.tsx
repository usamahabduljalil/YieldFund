import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDownLeft,
  ArrowDown,
  ArrowLeft,
  Plus,
  Check,
  Clock,
  Code,
  Bank,
  Plant,
  ShieldCheck,
  SlidersHorizontal,
  WarningCircle,
  FunnelSimple,
  ArrowsClockwise,
  Wallet,
} from "@phosphor-icons/react";
import {
  accounting,
  availableUnits,
  formatAmount,
  inputAmount,
  parseAmount,
  quoteWithdrawal,
  PREVIEW_ACCOUNT,
  SCALE,
  MEMBERS,
  type Operation,
  type Action,
} from "@yieldfund/domain";
import { usePreview } from "./preview-store";
import {
  Badge,
  Money,
  Metric,
  Empty,
  Notice,
  TextLink,
  Modal,
} from "./components";

function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
function PanelHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
function Status({ status }: { status: string }) {
  const label = status.replaceAll("-", " ");
  return (
    <Badge
      tone={
        ["completed", "paid"].includes(status)
          ? "success"
          : ["failed", "needs-reconciliation"].includes(status)
            ? "danger"
            : status === "approved"
              ? "blue"
              : "neutral"
      }
    >
      {label}
    </Badge>
  );
}
function DateLabel({ time }: { time: string }) {
  return (
    <span>
      {time === "Example history"
        ? time
        : new Date(time).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
    </span>
  );
}
function useAction() {
  const { act } = usePreview();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function run(action: Action, success = "Preview updated.") {
    try {
      act(action);
      setError("");
      setMessage(success);
      return true;
    } catch (e) {
      setMessage("");
      setError(
        e instanceof Error ? e.message : "Could not complete this action.",
      );
      return false;
    }
  }
  return { run, error, message, setError };
}
function Feedback({ error, message }: { error?: string; message?: string }) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          <Check size={16} />
          {message}
        </p>
      )}
    </>
  );
}

function TransactionModal({
  kind,
  onClose,
}: {
  kind: "deposit" | "withdraw";
  onClose: () => void;
}) {
  const { state, act } = usePreview();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [minimum, setMinimum] = useState("0");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const a = accounting(state),
    limit =
      kind === "deposit"
        ? state.wallet
        : availableUnits(state, PREVIEW_ACCOUNT);
  let parsed = 0n,
    estimate = 0n;
  try {
    parsed = parseAmount(amount || "0");
    estimate = kind === "withdraw" ? quoteWithdrawal(state, parsed) : parsed;
  } catch {
    /* Invalid input is reported on submit. */
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (!ack)
        throw new Error("Please acknowledge the risk before continuing.");
      if (kind === "deposit")
        act({
          type: "deposit",
          amount: parseAmount(amount),
          owner: PREVIEW_ACCOUNT,
        });
      else
        act({
          type: "request-withdrawal",
          owner: PREVIEW_ACCOUNT,
          units: parseAmount(amount),
          minimum: parseAmount(minimum),
        });
      setDone(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      title={
        done
          ? kind === "deposit"
            ? "Deposit accepted."
            : "Request queued."
          : kind === "deposit"
            ? "Support The Commons"
            : "Request withdrawal"
      }
      onClose={onClose}
    >
      {done ? (
        <div className="transaction-success">
          <Check size={42} />
          <h3>
            {kind === "deposit"
              ? "Your preview position is ready."
              : "Your units are reserved."}
          </h3>
          <p>
            {kind === "deposit"
              ? "The deposit is idle capital, ready for allocation."
              : "Settlement follows full strategy redemption."}
          </p>
          <Notice>Local preview only. No tokens were transferred.</Notice>
          <button
            className="button full"
            onClick={() => {
              onClose();
              navigate("/app/positions");
            }}
          >
            View my position <ArrowRight size={18} />
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="transaction-form">
          <div className="form-context">
            <span>The Commons</span>
            <Badge>Example tUSD</Badge>
          </div>
          <label htmlFor="transaction-amount">
            {kind === "deposit" ? "Deposit amount" : "Nominal units"}
          </label>
          <div className="amount-field">
            <input
              autoFocus
              id="transaction-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <span>tUSD</span>
            <button type="button" onClick={() => setAmount(inputAmount(limit))}>
              MAX
            </button>
          </div>
          <p className="balance-hint">
            {kind === "deposit" ? "Preview balance" : "Available units"}:{" "}
            {formatAmount(limit)}
          </p>
          {kind === "withdraw" && (
            <>
              <label htmlFor="minimum">Minimum payout</label>
              <div className="regular-input">
                <input
                  id="minimum"
                  inputMode="decimal"
                  value={minimum}
                  onChange={(e) => setMinimum(e.target.value)}
                  required
                />
                <span>tUSD</span>
              </div>
            </>
          )}
          <dl className="review-lines">
            <div>
              <dt>
                {kind === "deposit" ? "New nominal units" : "Estimated payout"}
              </dt>
              <dd>
                <Money amount={estimate} />
              </dd>
            </div>
            {kind === "withdraw" && (
              <div>
                <dt>Estimated loss</dt>
                <dd className={parsed > estimate ? "danger-text" : ""}>
                  <Money amount={parsed > estimate ? parsed - estimate : 0n} />
                </dd>
              </div>
            )}
            <div>
              <dt>{kind === "deposit" ? "Beneficiary" : "Recipient"}</dt>
              <dd>
                {kind === "deposit" ? "The Commons DAO" : "Preview supporter"}
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>Local simulation</dd>
            </div>
            <div>
              <dt>Network fees</dt>
              <dd>None in preview</dd>
            </div>
          </dl>
          {kind === "deposit" &&
            (!a.settled || state.paused || a.shortfall > 0n) && (
              <Notice>
                {!a.settled
                  ? "Settle the strategy in Scenario controls before depositing."
                  : state.paused
                    ? "New deposits are paused."
                    : "Capital is impaired. New deposits are unavailable."}
              </Notice>
            )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              I understand my claim can lose value and withdrawals may be
              delayed.{" "}
              <Link to="/risks" target="_blank">
                Read risks
              </Link>
            </span>
          </label>
          {kind === "withdraw" && (
            <p className="fine-print">
              Redeemed units give up any future recovery.
            </p>
          )}
          <Feedback error={error} />
          <button
            className="button full"
            type="submit"
            disabled={
              !ack ||
              (kind === "deposit" &&
                (!a.settled || state.paused || a.shortfall > 0n))
            }
          >
            {kind === "deposit" ? "Preview deposit" : "Queue withdrawal"}
            <ArrowUpRight size={18} />
          </button>
          <p className="fine-print centered">
            No wallet signature. No on-chain transaction.
          </p>
        </form>
      )}
    </Modal>
  );
}
function ActivityList({
  limit,
  filter = "all",
}: {
  limit?: number;
  filter?: string;
}) {
  const { state } = usePreview();
  const rows = state.operations
    .filter((op) => filter === "all" || op.status === filter)
    .slice(0, limit);
  return rows.length ? (
    <div className="table-scroll">
      <table className="activity-table">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Time</th>
            <th>
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((op) => (
            <tr key={op.id}>
              <td>
                <div className="activity-name">
                  <span className="transaction-icon">
                    {op.kind.includes("Deposit") ? (
                      <ArrowDownLeft size={18} />
                    ) : op.kind.includes("loss") ? (
                      <ArrowDown size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{op.kind}</strong>
                    <span>
                      {op.id.startsWith("example")
                        ? "Example history"
                        : "Local preview"}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <Money amount={op.amount} />
              </td>
              <td>
                <Status status={op.status} />
              </td>
              <td>
                <DateLabel time={op.time} />
              </td>
              <td>
                <Link
                  className="icon-button"
                  to={`/app/operations/${op.id}`}
                  aria-label={`View ${op.kind} details`}
                >
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty title="Nothing here yet">
      <p>Your campaign activity will appear here.</p>
    </Empty>
  );
}

export function Overview() {
  const { state } = usePreview();
  const a = accounting(state);
  const [deposit, setDeposit] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="THE COMMONS / OVERVIEW"
        title="Good things grow together."
        description="A little capital. A lasting contribution."
      >
        <button className="button" onClick={() => setDeposit(true)}>
          Support campaign <ArrowUpRight size={18} />
        </button>
      </PageHeading>
      <div className="metric-grid">
        <Metric label="Capital backing" amount={a.backing} />
        <Metric label="Yield donated" amount={state.donated} />
        <Metric label="Treasury available" amount={state.treasury} />
        <Metric
          label="Your position"
          amount={state.positions[PREVIEW_ACCOUNT] ?? 0n}
          note="Nominal units · local preview"
        />
      </div>
      <div className="overview-grid">
        <article className="campaign-feature">
          <div className="campaign-feature-header">
            <Badge tone="blue">OPEN SOURCE</Badge>
            <Badge tone={a.shortfall > 0n ? "danger" : "success"}>
              {a.shortfall > 0n
                ? "Impaired"
                : state.paused
                  ? "Paused"
                  : "Accepting support"}
            </Badge>
          </div>
          <div className="campaign-feature-body">
            <div>
              <span className="eyebrow">OUR FEATURED COMMUNITY</span>
              <h2>
                The tools we share.
                <br />
                The future we build.
              </h2>
              <p>
                Help independent builders maintain the open-source tools
                everyone relies on.
              </p>
              <div className="campaign-identity">
                <span className="campaign-icon">
                  <Code size={24} />
                </span>
                <div>
                  <strong>The Commons</strong>
                  <span>Fictional community · example campaign</span>
                </div>
              </div>
            </div>
            <img
              src="/assets/yieldfund-growth.png"
              alt="A blue sprout growing from shared community blocks"
              width="1536"
              height="1024"
            />
          </div>
          <div className="campaign-feature-footer">
            <span>
              <strong>01</strong> shared purpose
            </span>
            <TextLink to="/app/campaigns/commons">Explore campaign</TextLink>
          </div>
        </article>
        <section className="panel capital-panel">
          <PanelHeading title="Where capital goes">
            <ArrowUpRight size={19} />
          </PanelHeading>
          <div className="capital-total">
            <span className="eyebrow">POOLED CAPITAL</span>
            <strong>
              <Money amount={a.backing} unit={false} />
              <span>tUSD</span>
            </strong>
          </div>
          <div
            className="allocation-bar"
            aria-label={`Idle ${formatAmount(state.idle - state.excluded)}, strategy ${formatAmount(state.strategy)}`}
          >
            <div
              style={{
                width: `${a.backing > 0n ? Number((state.strategy * 10000n) / a.backing) / 100 : 0}%`,
              }}
            />
          </div>
          <dl className="capital-breakdown">
            <div>
              <dt>
                <span className="legend-square blue-square" />
                In strategy
              </dt>
              <dd>
                <Money amount={state.strategy} />
              </dd>
            </div>
            <div>
              <dt>
                <span className="legend-square" />
                Idle capital
              </dt>
              <dd>
                <Money amount={state.idle - state.excluded} />
              </dd>
            </div>
            <div>
              <dt>Eligible surplus</dt>
              <dd>
                <Money amount={a.settled ? a.surplus : 0n} />
              </dd>
            </div>
          </dl>
          <div className="panel-note">
            <ShieldCheck size={18} />
            <span>Supporter capital stays separate from treasury funds.</span>
          </div>
        </section>
      </div>
      <div className="overview-bottom">
        <section className="panel activity-panel">
          <PanelHeading title="Recent activity">
            <TextLink to="/app/activity">View all</TextLink>
          </PanelHeading>
          <ActivityList limit={4} />
        </section>
        <section className="funding-note">
          <span className="eyebrow">COMMUNITY-LED. ALWAYS.</span>
          <Bank size={31} weight="light" />
          <h3>
            Your support.
            <br />
            Their next chapter.
          </h3>
          <p>The council decides how donated yield is spent.</p>
          <TextLink to="/app/treasury">Meet the treasury</TextLink>
        </section>
      </div>
      {deposit && (
        <TransactionModal kind="deposit" onClose={() => setDeposit(false)} />
      )}
    </>
  );
}

export function Campaign() {
  const { state } = usePreview();
  const a = accounting(state);
  const [deposit, setDeposit] = useState(false);
  return (
    <>
      <Link to="/app" className="back-link">
        <ArrowLeft size={15} />
        Overview
      </Link>
      <PageHeading
        eyebrow="01 / OPEN-SOURCE COMMUNITY"
        title="The Commons"
        description="Keep shared tools in good hands."
      >
        <button className="button" onClick={() => setDeposit(true)}>
          Deposit <Plus size={17} />
        </button>
      </PageHeading>
      <div className="detail-grid">
        <div>
          <div className="campaign-cover">
            <img
              src="/assets/yieldfund-growth.png"
              alt="Illustrated community growth"
              width="1536"
              height="1024"
            />
            <span className="cover-caption">CAPITAL FOR A COMMON PURPOSE.</span>
          </div>
          <section className="panel campaign-about">
            <PanelHeading title="Built by people. Backed by you." />
            <p>
              The Commons is a fictional open-source community used to
              demonstrate YieldFund. Its example treasury supports maintenance,
              documentation and small contributor grants.
            </p>
            <div className="tag-list">
              <Badge>Public tools</Badge>
              <Badge>Shared ownership</Badge>
              <Badge>Open reporting</Badge>
            </div>
            <h3>What your support does</h3>
            <p>
              Eligible yield goes to the community treasury. The example council
              reviews payments, while your remaining capital claim stays with
              the vault.
            </p>
          </section>
        </div>
        <div className="stacked-panels">
          <section className="panel">
            <PanelHeading title="Campaign details" />
            <dl className="review-lines padded">
              <div>
                <dt>Mode</dt>
                <dd>Local preview</dd>
              </div>
              <div>
                <dt>Token</dt>
                <dd>tUSD · 6 decimals</dd>
              </div>
              <div>
                <dt>Token contract</dt>
                <dd>Not deployed</dd>
              </div>
              <div>
                <dt>Vault</dt>
                <dd>Not deployed</dd>
              </div>
              <div>
                <dt>Beneficiary</dt>
                <dd>
                  The Commons DAO
                  <br />
                  <small>Example · not deployed</small>
                </dd>
              </div>
              <div>
                <dt>Strategy</dt>
                <dd>Local simulation</dd>
              </div>
              <div>
                <dt>Platform fee</dt>
                <dd>0%</dd>
              </div>
            </dl>
          </section>
          <div className="panel padded">
            <Metric label="Capital backing" amount={a.backing} />
            <button className="button full" onClick={() => setDeposit(true)}>
              Support this campaign <ArrowUpRight size={18} />
            </button>
            <p className="fine-print">
              Capital can lose value. Withdrawals may be delayed.
            </p>
            <TextLink to="/risks">Read the risks</TextLink>
          </div>
        </div>
      </div>
      {deposit && (
        <TransactionModal kind="deposit" onClose={() => setDeposit(false)} />
      )}
    </>
  );
}

export function Positions() {
  const { state, act } = usePreview();
  const [modal, setModal] = useState<"deposit" | "withdraw" | null>(null);
  const { error, message, run, setError } = useAction();
  const units = state.positions[PREVIEW_ACCOUNT] ?? 0n;
  const estimate = quoteWithdrawal(state, units);
  const requests = state.withdrawals.filter((w) => w.owner === PREVIEW_ACCOUNT);
  function settle(id: string) {
    try {
      act({ type: "checkpoint" });
      act({ type: "begin-withdrawal", id });
      act({ type: "resolve-transfer", outcome: "success" });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="YOUR CAPITAL / LOCAL PREVIEW"
        title="My position"
        description="Your capital and its contribution, kept clear."
      >
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() => setModal("withdraw")}
            disabled={availableUnits(state, PREVIEW_ACCOUNT) === 0n}
          >
            Withdraw <ArrowUpRight size={17} />
          </button>
          <button className="button" onClick={() => setModal("deposit")}>
            Deposit <Plus size={17} />
          </button>
        </div>
      </PageHeading>
      <div className="metric-grid">
        <Metric label="Nominal units" amount={units} />
        <Metric
          label="Estimated redemption"
          amount={estimate}
          note="Estimate · subject to settlement"
        />
        <Metric label="Capital shortfall" amount={units - estimate} />
        <Metric label="Preview wallet" amount={state.wallet} />
      </div>
      <Notice>
        This position belongs to the preview supporter. It is separate from any
        connected wallet.
      </Notice>
      <Feedback error={error} message={message} />
      {units === 0n && requests.length === 0 ? (
        <section className="panel">
          <Empty title="Your support starts here.">
            <p>Try a deposit into The Commons campaign.</p>
            <button className="button" onClick={() => setModal("deposit")}>
              Preview a deposit <ArrowRight size={18} />
            </button>
          </Empty>
        </section>
      ) : (
        <section className="panel position-panel">
          <PanelHeading title="The Commons">
            <Badge tone="blue">Example position</Badge>
          </PanelHeading>
          <div className="position-summary">
            <span className="campaign-icon">
              <Code size={27} />
            </span>
            <div>
              <h3>Open-source community fund</h3>
              <p>
                {formatAmount(availableUnits(state, PREVIEW_ACCOUNT))} units
                available to request
              </p>
            </div>
            <TextLink to="/app/campaigns/commons">View campaign</TextLink>
          </div>
        </section>
      )}
      <section className="panel">
        <PanelHeading title="Withdrawal requests">
          <span className="eyebrow">
            {requests.length.toString().padStart(2, "0")} REQUESTS
          </span>
        </PanelHeading>
        {requests.length ? (
          <div className="request-list">
            {requests.map((w) => (
              <div className="request-row" key={w.id}>
                <div>
                  <strong>
                    <Money amount={w.units} />
                  </strong>
                  <span>
                    Minimum {formatAmount(w.minimum)} · {w.id}
                  </span>
                </div>
                <Status status={w.status} />
                <div className="button-row">
                  {w.status === "queued" && (
                    <>
                      <button
                        className="button small secondary"
                        onClick={() =>
                          run(
                            {
                              type: "cancel-withdrawal",
                              owner: PREVIEW_ACCOUNT,
                              id: w.id,
                            },
                            "Request cancelled.",
                          )
                        }
                      >
                        Cancel
                      </button>
                      <button
                        className="button small"
                        onClick={() => settle(w.id)}
                      >
                        Settle preview
                      </button>
                    </>
                  )}
                  {w.status === "completed" && (
                    <span>Paid {formatAmount(w.paid)} tUSD</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No pending withdrawals">
            <p>Requests will appear here until settlement.</p>
          </Empty>
        )}
      </section>
      {modal && (
        <TransactionModal kind={modal} onClose={() => setModal(null)} />
      )}
    </>
  );
}

function ProposalForm({ onClose }: { onClose: () => void }) {
  const { act } = usePreview();
  const [title, setTitle] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      act({ type: "propose", title, recipient, amount: parseAmount(amount) });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal title="Propose a payment" onClose={onClose}>
      <form className="transaction-form" onSubmit={submit}>
        <Notice>
          Local governance preview. This does not create a Sputnik DAO proposal.
        </Notice>
        <label htmlFor="proposal-title">Purpose</label>
        <input
          id="proposal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Maintain the community SDK"
          maxLength={100}
          required
        />
        <label htmlFor="proposal-recipient">Example recipient</label>
        <input
          id="proposal-recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Contributor name"
          maxLength={64}
          required
        />
        <label htmlFor="proposal-amount">Amount · tUSD</label>
        <input
          id="proposal-amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          inputMode="decimal"
          required
        />
        <Feedback error={error} />
        <button className="button full">
          Create preview proposal <ArrowRight size={18} />
        </button>
      </form>
    </Modal>
  );
}
export function Treasury() {
  const { state } = usePreview();
  const [modal, setModal] = useState(false);
  return (
    <>
      <PageHeading
        eyebrow="THE COMMONS / COMMUNITY TREASURY"
        title="Support becomes possibility."
        description="Donated yield. Decisions made together."
      >
        <button className="button" onClick={() => setModal(true)}>
          Propose payment <Plus size={18} />
        </button>
      </PageHeading>
      <div className="metric-grid three">
        <Metric label="Treasury balance" amount={state.treasury} />
        <Metric label="Total received" amount={state.donated} />
        <Metric label="Community payments" amount={state.communityPaid} />
      </div>
      <div className="governance-strip">
        <div>
          <Bank size={25} />
          <div>
            <strong>The Commons DAO</strong>
            <span>Example governance · not deployed</span>
          </div>
        </div>
        <span>
          <strong>2 of 3</strong> approvals required
        </span>
        <div className="council-names">Alex / Sam / Jo</div>
      </div>
      <section className="panel">
        <PanelHeading title="Payment proposals">
          <Badge>{state.proposals.length} proposals</Badge>
        </PanelHeading>
        <div className="proposal-list">
          {state.proposals.map((p) => (
            <Link
              key={p.id}
              to={`/app/treasury/proposals/${p.id}`}
              className="proposal-row"
            >
              <div className="proposal-icon">
                <Code size={22} />
              </div>
              <div className="proposal-title">
                <span className="eyebrow">{p.id.toUpperCase()}</span>
                <h3>{p.title}</h3>
                <span>{p.recipient}</span>
              </div>
              <div className="proposal-amount">
                <strong>
                  <Money amount={p.amount} />
                </strong>
                <span>{p.votes.length} / 2 approvals</span>
              </div>
              <Status status={p.status} />
              <ArrowUpRight size={20} />
            </Link>
          ))}
        </div>
      </section>
      <Notice>
        Only donated treasury funds can be spent. Supporter deposits do not
        grant voting rights.
      </Notice>
      {modal && <ProposalForm onClose={() => setModal(false)} />}
    </>
  );
}
export function ProposalDetail() {
  const { proposalId } = useParams();
  const { state } = usePreview();
  const p = state.proposals.find((x) => x.id === proposalId);
  const [member, setMember] = useState("Sam");
  const { run, error, message } = useAction();
  if (!p)
    return (
      <Empty title="Proposal not found">
        <TextLink to="/app/treasury">Back to treasury</TextLink>
      </Empty>
    );
  return (
    <>
      <Link className="back-link" to="/app/treasury">
        <ArrowLeft size={16} />
        Treasury
      </Link>
      <PageHeading eyebrow={p.id.toUpperCase()} title={p.title}>
        <Status status={p.status} />
      </PageHeading>
      <div className="detail-grid">
        <section className="panel">
          <PanelHeading title="Payment details" />
          <dl className="review-lines padded">
            <div>
              <dt>Recipient</dt>
              <dd>{p.recipient}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>
                <Money amount={p.amount} />
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>Donated yield only</dd>
            </div>
            <div>
              <dt>Execution</dt>
              <dd>
                {p.status === "paid" ? "Completed locally" : "Not executed"}
              </dd>
            </div>
            <div>
              <dt>On-chain receipt</dt>
              <dd>Not available in preview</dd>
            </div>
          </dl>
          <Notice>
            Approval and payment are separate steps. A live release will verify
            the recipient’s token receipt.
          </Notice>
        </section>
        <section className="panel padded">
          <span className="eyebrow">EXAMPLE COUNCIL</span>
          <h2>{p.votes.length} of 2 approvals</h2>
          <div className="vote-list">
            {MEMBERS.map((m) => (
              <div key={m}>
                <span>{m}</span>
                {p.votes.includes(m) ? (
                  <span className="approved-vote">
                    <Check size={15} />
                    Approved
                  </span>
                ) : (
                  <span>Awaiting vote</span>
                )}
              </div>
            ))}
          </div>
          {p.status === "voting" && (
            <>
              <label htmlFor="council-member">Preview vote as</label>
              <select
                id="council-member"
                value={member}
                onChange={(e) => setMember(e.target.value)}
              >
                {MEMBERS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <button
                className="button full"
                disabled={p.votes.includes(member)}
                onClick={() =>
                  run(
                    { type: "vote", id: p.id, member },
                    "Preview vote recorded.",
                  )
                }
              >
                Approve in preview <Check size={18} />
              </button>
            </>
          )}
          {p.status === "approved" && (
            <button
              className="button full"
              onClick={() =>
                run(
                  { type: "pay-proposal", id: p.id },
                  "Preview payment completed. No tokens moved.",
                )
              }
            >
              Execute preview payment <ArrowUpRight size={18} />
            </button>
          )}
          <Feedback error={error} message={message} />
        </section>
      </div>
    </>
  );
}
export function Activity() {
  const [filter, setFilter] = useState("all");
  return (
    <>
      <PageHeading
        eyebrow="THE COMMONS / FUNDING TRAIL"
        title="Every step, accounted for."
        description="Follow capital, treasury funding and community payments."
      />
      <section className="panel">
        <PanelHeading title="All activity">
          <div className="filter-control">
            <FunnelSimple size={16} />
            <label className="sr-only" htmlFor="activity-filter">
              Filter by status
            </label>
            <select
              id="activity-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="completed">Completed</option>
              <option value="queued">Queued</option>
              <option value="pending">Pending</option>
              <option value="needs-reconciliation">Needs reconciliation</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </PanelHeading>
        <ActivityList filter={filter} />
      </section>
      <p className="fine-print">
        Local preview records do not have on-chain transaction hashes.
      </p>
    </>
  );
}
export function OperationDetail() {
  const { operationId } = useParams();
  const { state } = usePreview();
  const op = state.operations.find((x) => x.id === operationId);
  if (!op)
    return (
      <Empty title="Operation not found">
        <TextLink to="/app/activity">View activity</TextLink>
      </Empty>
    );
  const steps =
    op.status === "queued"
      ? ["Request recorded", "Waiting for settlement"]
      : op.status === "completed"
        ? ["Action recorded", "Ledger reconciled", "Completed locally"]
        : ["Action recorded", op.status.replaceAll("-", " ")];
  return (
    <>
      <Link className="back-link" to="/app/activity">
        <ArrowLeft size={16} />
        Activity
      </Link>
      <PageHeading eyebrow={op.id.toUpperCase()} title={op.kind}>
        <Status status={op.status} />
      </PageHeading>
      <div className="detail-grid">
        <section className="panel">
          <PanelHeading title="Operation details" />
          <dl className="review-lines padded">
            <div>
              <dt>Amount</dt>
              <dd>
                <Money amount={op.amount} />
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>Local simulation</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>
                <DateLabel time={op.time} />
              </dd>
            </div>
            <div>
              <dt>Receipt</dt>
              <dd>No on-chain receipt</dd>
            </div>
          </dl>
          <Notice>{op.detail}</Notice>
        </section>
        <section className="panel padded">
          <h2>Progress</h2>
          <ol className="operation-timeline">
            {steps.map((s, i) => (
              <li key={s}>
                <span>{i + 1}</span>
                <div>
                  <strong>{s}</strong>
                  {i === steps.length - 1 && (
                    <p>
                      {op.status === "completed"
                        ? "Preview ledger updated."
                        : "No payment is assumed before completion."}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
export function Manage() {
  const { state, act, reset } = usePreview();
  const a = accounting(state);
  const { run, error, message, setError } = useAction();
  const [resetOpen, setResetOpen] = useState(false);
  function simulate(gain: boolean) {
    try {
      if (state.strategy === 0n)
        act({ type: "allocate", amount: state.idle - state.excluded });
      act({
        type: "strategy-result",
        amount: gain ? 30n * SCALE : -(a.backing / 10n),
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function donate() {
    try {
      act({ type: "begin-donation", amount: a.surplus });
      act({ type: "resolve-transfer", outcome: "success" });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="DEVELOPER PREVIEW / SCENARIOS"
        title="See how the mechanics work."
        description="Local controls for profit, loss, liquidity and settlement."
      >
        <button className="button secondary" onClick={() => setResetOpen(true)}>
          <ArrowsClockwise size={17} />
          Reset preview
        </button>
      </PageHeading>
      <Notice>
        These controls change local example data only. They are not
        administrative controls for a deployed vault.
      </Notice>
      <Feedback error={error} message={message} />
      <div className="metric-grid">
        <Metric label="Backing" amount={a.backing} />
        <Metric label="Nominal claims" amount={a.nominal} />
        <Metric label="Capital shortfall" amount={a.shortfall} />
        <Metric
          label="Candidate surplus"
          amount={a.surplus}
          note={
            a.settled
              ? "Settled · eligible for preview donation"
              : "Requires full redemption"
          }
        />
      </div>
      <div className="scenario-grid">
        <section className="panel padded">
          <span className="eyebrow">01 / ALLOCATION</span>
          <h2>Put capital to work.</h2>
          <p>Move idle capital into the simulated strategy.</p>
          <dl className="review-lines">
            <div>
              <dt>Idle</dt>
              <dd>
                <Money amount={state.idle - state.excluded} />
              </dd>
            </div>
            <div>
              <dt>Strategy</dt>
              <dd>
                <Money amount={state.strategy} />
              </dd>
            </div>
          </dl>
          <button
            className="button secondary full"
            disabled={
              state.idle === state.excluded ||
              state.paused ||
              !!state.pending ||
              a.shortfall > 0n
            }
            onClick={() =>
              run(
                { type: "allocate", amount: state.idle - state.excluded },
                "Idle capital allocated in preview.",
              )
            }
          >
            Allocate idle capital <ArrowRight size={17} />
          </button>
        </section>
        <section className="panel padded">
          <span className="eyebrow">02 / STRATEGY RESULT</span>
          <h2>Explore both outcomes.</h2>
          <p>Gains support the treasury. Losses reduce capital.</p>
          <div className="scenario-options">
            <button
              className="button secondary full"
              disabled={!!state.pending || state.paused}
              onClick={() => simulate(true)}
            >
              Simulate +30 tUSD <Plus size={17} />
            </button>
            <button
              className="button secondary full"
              disabled={!!state.pending || a.backing === 0n || state.paused}
              onClick={() => simulate(false)}
            >
              Simulate 10% loss <ArrowDown size={17} />
            </button>
          </div>
          <p className="fine-print">
            Scenario amounts, never live performance.
          </p>
        </section>
        <section className="panel padded">
          <span className="eyebrow">03 / SETTLEMENT</span>
          <h2>Reconcile before paying.</h2>
          <p>Fully redeem the strategy, then donate eligible surplus.</p>
          <div className="scenario-options">
            <button
              className="button secondary full"
              disabled={!!state.pending}
              onClick={() =>
                run(
                  { type: "checkpoint" },
                  "Strategy redeemed; checkpoint reconciled.",
                )
              }
            >
              Settle checkpoint <Check size={17} />
            </button>
            <button
              className="button full"
              disabled={!a.settled || a.surplus === 0n || state.paused}
              onClick={donate}
            >
              Donate eligible yield <ArrowUpRight size={17} />
            </button>
          </div>
        </section>
      </div>
      <section className="panel">
        <PanelHeading title="Exceptional states">
          <SlidersHorizontal size={21} />
        </PanelHeading>
        <div className="toggle-row">
          <div>
            <strong>Pause new risk</strong>
            <p>Stop new deposits, allocations and distributions.</p>
          </div>
          <button
            role="switch"
            aria-checked={state.paused}
            className={`toggle ${state.paused ? "on" : ""}`}
            onClick={() =>
              run(
                { type: "pause", value: !state.paused },
                state.paused ? "New risk resumed." : "New risk paused.",
              )
            }
            aria-label="Pause new risk"
          >
            <span />
          </button>
        </div>
        <div className="toggle-row">
          <div>
            <strong>Unavailable strategy liquidity</strong>
            <p>Keep withdrawals queued until redemption is possible.</p>
          </div>
          <button
            role="switch"
            aria-checked={state.liquidityBlocked}
            className={`toggle ${state.liquidityBlocked ? "on" : ""}`}
            onClick={() =>
              run(
                { type: "liquidity", value: !state.liquidityBlocked },
                "Liquidity scenario updated.",
              )
            }
            aria-label="Unavailable strategy liquidity"
          >
            <span />
          </button>
        </div>
      </section>
      <div className="integration-status">
        <span className="eyebrow">INTEGRATION STATUS</span>
        <div>
          <span>
            NEAR vault <Badge>Not deployed</Badge>
          </span>
          <span>
            Rhea <Badge>Not connected</Badge>
          </span>
          <span>
            Sputnik DAO <Badge>Not deployed</Badge>
          </span>
        </div>
      </div>
      {resetOpen && (
        <Modal title="Reset this preview?" onClose={() => setResetOpen(false)}>
          <div className="transaction-form">
            <p>
              This clears local deposits, requests and example votes in this
              tab.
            </p>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() => setResetOpen(false)}
              >
                Keep exploring
              </button>
              <button
                className="button"
                onClick={() => {
                  reset();
                  setResetOpen(false);
                }}
              >
                Reset preview
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
