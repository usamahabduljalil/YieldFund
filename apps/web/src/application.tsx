import { useState, useEffect, useRef } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  SquaresFour,
  Stack,
  Bank,
  ClockCounterClockwise,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowLeft,
  List,
  X,
  ArrowRight,
} from "@phosphor-icons/react";
import { Brand, Badge } from "./components";
import { WalletControl, WalletProvider } from "./wallet";
import { ChainProvider, loadRuntime } from "./chain-store";
import { ChainBanner, ChainRoutes } from "./chain-pages";
import type { RuntimeConfig } from "../../../packages/near-client/src/chain";
import { PreviewProvider } from "./preview-store";
import {
  Overview,
  Campaign,
  Positions,
  Treasury,
  ProposalDetail,
  Activity,
  OperationDetail,
  Manage,
} from "./app-pages";
import { NotFound } from "./public-pages";
const links = [
  ["/app", "Overview", SquaresFour],
  ["/app/positions", "My position", Stack],
  ["/app/treasury", "Treasury", Bank],
  ["/app/activity", "Activity", ClockCounterClockwise],
] as const;
function Shell({
  chain = false,
  network = "testnet",
}: {
  chain?: boolean;
  network?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width:700px)").matches,
  );
  const sidebar = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width:700px)");
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>("a, button") ?? [],
      );
    focusable()[0]?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      document.body.style.overflow = oldOverflow;
      trigger.current?.focus();
    };
  }, [open, mobile]);
  const location = useLocation();
  const navigate = useNavigate();
  const name = location.pathname.includes("campaigns")
    ? "Campaign"
    : location.pathname.includes("operations")
      ? "Operation"
      : location.pathname.includes("manage")
        ? chain
          ? "Campaign operations"
          : "Scenario controls"
        : (links.find(
            ([path]) => path !== "/app" && location.pathname.startsWith(path),
          )?.[1] ?? "Overview");
  return (
    <div className="application">
      <a className="skip-link" href="#app-main">
        Skip to content
      </a>
      <aside
        ref={sidebar}
        className={`sidebar ${open ? "open" : ""}`}
        inert={mobile && !open}
        role={mobile && open ? "dialog" : undefined}
        aria-modal={mobile && open ? true : undefined}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-brand">
          <Brand compact />
          <button
            className="icon-button mobile-menu"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <X size={22} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="eyebrow">YOUR COMMUNITY SPACE</span>
          <strong>The Commons</strong>
          <span>Open-source community</span>
        </div>
        <nav aria-label="Application navigation">
          {links.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/app"}
              onClick={() => setOpen(false)}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={20} />
              {label}
              <ArrowUpRight className="nav-arrow" size={15} />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link
            className="scenario-link"
            to="/app/manage"
            onClick={() => setOpen(false)}
          >
            <SlidersHorizontal size={18} />
            {chain ? "Campaign operations" : "Scenario controls"}
          </Link>
          <div className="sidebar-note">
            <span className="eyebrow">GROW SOMETHING GOOD.</span>
            <p>
              Shared capital.
              <br />
              Shared possibilities.
            </p>
            <Link to="/risks">
              Risks & disclosures <ArrowUpRight size={14} />
            </Link>
          </div>
          <Link className="back-to-site" to="/">
            <ArrowLeft size={16} />
            Back to website
          </Link>
        </div>
      </aside>
      {open && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="app-content" inert={mobile && open}>
        <header className="app-header">
          <div className="breadcrumbs">
            <button
              ref={trigger}
              className="icon-button mobile-menu"
              onClick={() => setOpen(true)}
              aria-label="Open navigation"
            >
              <List size={23} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{name}</strong>
          </div>
          <div className="header-actions">
            <Badge>
              {network === "sandbox" ? "Local sandbox" : "Testnet wallet"}
            </Badge>
            {network !== "sandbox" && <WalletControl />}
          </div>
        </header>
        {chain ? (
          <ChainBanner />
        ) : (
          <div className="preview-banner">
            <span>
              <span className="preview-label">LOCAL PREVIEW</span>Example
              balances. No tokens move.
            </span>
            <button onClick={() => navigate("/app/manage")}>
              Try a scenario <ArrowRight size={14} />
            </button>
          </div>
        )}
        <main id="app-main" className="app-main" key={location.pathname}>
          {chain ? (
            <ChainRoutes />
          ) : (
            <Routes>
              <Route index element={<Overview />} />
              <Route path="campaigns/commons" element={<Campaign />} />
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
          )}
        </main>
        <footer className="app-footer">
          <span>YIELDFUND / COMMUNITY CAPITAL</span>
          <Link to="/risks">
            Know the risks <ArrowUpRight size={13} />
          </Link>
        </footer>
      </div>
    </div>
  );
}
export default function Application() {
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadRuntime()
      .then((value) => {
        if (active) setRuntime(value);
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Deployment unavailable");
      });
    return () => {
      active = false;
    };
  }, []);
  if (error)
    return (
      <main className="loading-screen">
        <h1>Deployment unavailable</h1>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => location.reload()}>
          Retry
        </button>
        <Link to="/">Back to website</Link>
      </main>
    );
  if (!runtime)
    return (
      <div className="loading-screen" role="status">
        Opening workspace…
      </div>
    );
  return runtime.mode === "chain" ? (
    <WalletProvider
      rpcUrl={runtime.network === "testnet" ? runtime.rpcUrl : undefined}
    >
      <ChainProvider deployment={runtime}>
        <Shell chain network={runtime.network} />
      </ChainProvider>
    </WalletProvider>
  ) : (
    <WalletProvider>
      <PreviewProvider>
        <Shell />
      </PreviewProvider>
    </WalletProvider>
  );
}
