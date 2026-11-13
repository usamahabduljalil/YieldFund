import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Minus,
  Code,
  UsersThree,
  GraduationCap,
  ShieldCheck,
  List,
  X,
  Plant,
} from "@phosphor-icons/react";
import { Brand, ArrowLink } from "./components";

function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <div className="public-nav">
        <Brand />
        <nav
          className={open ? "public-links open" : "public-links"}
          aria-label="Main navigation"
        >
          {[
            ["How it works", "how-it-works"],
            ["Communities", "communities"],
            ["Transparency", "transparency"],
            ["FAQ", "faq"],
          ].map(([name, id]) => (
            <a key={id} href={`/#${id}`} onClick={() => setOpen(false)}>
              {name}
            </a>
          ))}
        </nav>
        <ArrowLink to="/app">Launch app</ArrowLink>
        <button
          className="icon-button mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={24} /> : <List size={24} />}
        </button>
      </div>
    </header>
  );
}
function Footer() {
  return (
    <footer className="public-footer">
      <Brand />
      <span>Capital with a common purpose.</span>
      <div>
        <Link to="/risks">Risks & disclosures</Link>
        <a
          href="https://github.com/usamahabduljalil/YieldFund"
          target="_blank"
          rel="noreferrer"
        >
          Source <ArrowUpRight size={14} />
        </a>
        <a href="https://docs.near.org/" target="_blank" rel="noreferrer">
          NEAR docs <ArrowUpRight size={14} />
        </a>
        <span>© 2026 YieldFund</span>
      </div>
    </footer>
  );
}
const faqs = [
  [
    "What happens to my capital?",
    "It is held by the campaign vault and may be supplied to a lending strategy. You retain a claim on recoverable assets, not a guarantee of your original deposit.",
  ],
  [
    "Can I withdraw?",
    "You can request a withdrawal of your remaining claim. Settlement depends on available liquidity. You choose a minimum payout; a lower payout will not execute.",
  ],
  [
    "Who decides how funds are spent?",
    "The campaign’s DAO governs funds already donated to its treasury. Contributing to a campaign does not automatically give you voting rights.",
  ],
  [
    "Is the yield guaranteed?",
    "No. Yield varies and can be zero. Losses can reduce your capital, and withdrawals may be delayed.",
  ],
  [
    "What can I try today?",
    "Follow the completed testnet funding and DAO payment in the hosted app. Local preview lets you try example scenarios. Public signing is disabled; the funded simulator does not earn live Rhea yield.",
  ],
];
export function Landing() {
  const [faq, setFaq] = useState<number | null>(0);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <PublicHeader />
      <main id="main">
        <section className="hero page-width">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="tiny-line" /> COMMUNITY CAPITAL / BUILT ON NEAR
            </div>
            <h1>
              Put capital
              <br />
              behind your
              <br />
              <span>community.</span>
            </h1>
            <p>
              Support what matters.
              <br />
              Let eligible yield fund what comes next.
            </p>
            <div className="hero-actions">
              <ArrowLink to="/app">Explore YieldFund</ArrowLink>
              <a href="#how-it-works" className="quiet-link">
                How it works <ArrowRight size={17} />
              </a>
            </div>
            <div className="hero-footnote">
              <ShieldCheck size={16} />
              <span>Transparent funding. Community-governed.</span>
            </div>
          </div>
          <div className="hero-visual">
            <span className="visual-index">[ 01 / GROW TOGETHER ]</span>
            <img
              src="/assets/yieldfund-growth.png"
              alt="Blue halftone community garden with a sprout growing from shared building blocks"
              width="1536"
              height="1024"
              fetchPriority="high"
            />
            <div className="visual-caption">
              <span>
                SMALL CONTRIBUTIONS.
                <br />
                SHARED POSSIBILITIES.
              </span>
              <span>YF—001</span>
            </div>
          </div>
        </section>
        <div className="principles-strip">
          <div className="page-width">
            <span>Capital for a cause</span>
            <Plus size={16} />
            <span>Yield for a community</span>
            <Plus size={16} />
            <span>Decisions made together</span>
            <ArrowUpRight size={24} />
          </div>
        </div>
        <section className="section page-width" id="how-it-works">
          <div className="section-heading">
            <div>
              <span className="eyebrow">01 / THE IDEA</span>
              <h2>
                A different way
                <br />
                to give support.
              </h2>
            </div>
            <p>
              Your capital has a role.
              <br />
              So does your community.
            </p>
          </div>
          <div className="steps-grid">
            {[
              [
                "01",
                "Allocate capital.",
                "Choose a campaign. Deposit the supported token into its vault.",
              ],
              [
                "02",
                "Put yield to work.",
                "Eligible realized yield moves to the community treasury.",
              ],
              [
                "03",
                "Fund what matters.",
                "The DAO approves payments. Everyone can follow the trail.",
              ],
            ].map(([n, title, body]) => (
              <article key={n} className="step">
                <div className="step-number">
                  {n}
                  <ArrowUpRight size={24} />
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <div className="section-foot">
            <span>
              Your remaining claim can lose value. Withdrawals may be delayed.
            </span>
            <Link to="/risks">
              Understand the risks <ArrowUpRight size={16} />
            </Link>
          </div>
        </section>
        <section className="community-section" id="communities">
          <div className="page-width section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">02 / COMMON GROUND</span>
                <h2>
                  For the things
                  <br />
                  we build together.
                </h2>
              </div>
              <ArrowLink to="/app/campaigns/commons" secondary>
                View example campaign
              </ArrowLink>
            </div>
            <div className="community-grid">
              {[
                [
                  Code,
                  "Open source",
                  "Keep the tools we share moving forward.",
                ],
                [
                  GraduationCap,
                  "Alumni communities",
                  "Back the next generation of possibilities.",
                ],
                [
                  UsersThree,
                  "Collectives",
                  "Support a shared space, project or purpose.",
                ],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof Code;
                return (
                  <article key={title as string}>
                    <I size={36} weight="light" />
                    <h3>{title as string}</h3>
                    <p>{body as string}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section className="section page-width transparency" id="transparency">
          <div>
            <span className="eyebrow">03 / FOLLOW THE FUNDING</span>
            <h2>
              Every step.
              <br />
              Out in the open.
            </h2>
            <p>
              See where capital sits, what the treasury receives, and how
              community funds are spent.
            </p>
            <ArrowLink to="/app/treasury">Explore the treasury</ArrowLink>
          </div>
          <div className="funding-path">
            <div className="path-heading">
              <span>THE FUNDING TRAIL</span>
              <ArrowUpRight size={20} />
            </div>
            {[
              ["01", "Campaign vault", "Capital allocated"],
              ["02", "Community treasury", "Eligible yield donated"],
              ["03", "Community payment", "Approved by the DAO"],
            ].map(([n, title, note]) => (
              <div className="path-row" key={n}>
                <span>{n}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{note}</p>
                </div>
                <ArrowRight size={22} />
              </div>
            ))}
            <div className="path-foot">
              <ShieldCheck size={18} />
              <span>Capital and treasury funds stay separate.</span>
            </div>
          </div>
        </section>
        <section className="section page-width faq-section" id="faq">
          <div>
            <span className="eyebrow">04 / A LITTLE CLARITY</span>
            <h2>
              Good questions.
              <br />
              Clear answers.
            </h2>
          </div>
          <div className="faq-list">
            {faqs.map(([q, a], i) => (
              <div className="faq-item" key={q}>
                <button
                  aria-expanded={faq === i}
                  aria-controls={`faq-${i}`}
                  onClick={() => setFaq(faq === i ? null : i)}
                >
                  {q}
                  {faq === i ? <Minus size={20} /> : <Plus size={20} />}
                </button>
                <div id={`faq-${i}`} hidden={faq !== i}>
                  <p>{a}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="closing-cta page-width">
          <div>
            <span className="eyebrow">A SHARED FUTURE STARTS SOMEWHERE.</span>
            <h2>Make it grow.</h2>
          </div>
          <ArrowLink to="/app">Launch app</ArrowLink>
        </section>
      </main>
      <Footer />
    </>
  );
}
export function Risks() {
  return (
    <>
      <PublicHeader />
      <main className="page-width risks-page">
        <span className="eyebrow">YIELDFUND / DISCLOSURES</span>
        <h1>
          Know what
          <br />
          you’re supporting.
        </h1>
        <p className="lead">A recoverable claim is not a capital guarantee.</p>
        {[
          [
            "Capital can lose value",
            "Your tokens may be allocated to a lending strategy. Market losses, token depegging, smart-contract failures and administrative key compromise can reduce or eliminate your recoverable balance.",
          ],
          [
            "Withdrawals can take time",
            "A request reserves nominal units. Payment depends on successful strategy redemption and reconciliation. Your minimum payout protects against an execution below the amount you selected.",
          ],
          [
            "Yield belongs to the campaign",
            "Eligible yield successfully sent to the DAO is an irrevocable donation. It cannot be reclaimed through a supporter withdrawal. Depositing does not grant governance rights.",
          ],
          [
            "Check the application mode",
            "Local preview uses example balances and votes. Chain mode reads configured NEAR contracts, with signing available only for enabled testnet deployments. The local Sandbox is read-only. Connecting a wallet does not convert preview balances into tokens. The funded simulator does not earn live Rhea yield.",
          ],
          [
            "Before an on-chain release",
            "The exact token, vault, DAO, strategy, network and retained deployment authority must be verified and disclosed. A production release requires independent security review.",
          ],
        ].map(([title, body]) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
          </section>
        ))}
        <ArrowLink to="/app">Open application</ArrowLink>
      </main>
      <Footer />
    </>
  );
}
export function NotFound() {
  return (
    <main className="not-found">
      <Plant size={40} />
      <span className="eyebrow">404 / UNCHARTED GROUND</span>
      <h1>This page isn’t here.</h1>
      <ArrowLink to="/">Back to YieldFund</ArrowLink>
    </main>
  );
}
