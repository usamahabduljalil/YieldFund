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
import type {
  RuntimeConfig,
  Deployment,
} from "../../../packages/near-client/src/chain";
import { CampaignDirectory } from "./campaign-directory";
import {
  CampaignRegistry,
  parseRegistry,
  type RegistryDeployment,
} from "../../../packages/near-client/src/campaigns";
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
  ["/app/campaigns", "Campaigns", Stack],
  ["/app/positions", "My position", Stack],
  ["/app/treasury", "Treasury", Bank],
  ["/app/activity", "Activity", ClockCounterClockwise],
] as const;
function Shell({
  chain = false,
  network = "testnet",
  deployment,
  baseline,
  onSelect,
}: {
  chain?: boolean;
  network?: string;
  deployment?: Deployment;
  baseline?: Deployment;
  onSelect?: (deployment: Deployment) => void;
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
  const name =
    location.pathname === "/app/campaigns"
      ? "Campaigns"
      : location.pathname === "/app/campaigns/new"
        ? "Create campaign"
        : location.pathname.includes("campaigns")
          ? "Campaign"
          : location.pathname.includes("operations")
            ? "Operation"
            : location.pathname.includes("manage")
              ? chain
                ? "Campaign operations"
                : "Scenario controls"
              : (links.find(
                  ([path]) =>
                    path !== "/app" && location.pathname.startsWith(path),
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
          <strong>{deployment?.displayName ?? "The Commons"}</strong>
          <span>
            {deployment?.config.campaign_id === "commons" || !deployment
              ? "Open-source community"
              : deployment.config.campaign_id}
          </span>
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
              {network === "sandbox"
                ? "Local sandbox"
                : network === "mainnet"
                  ? "Mainnet wallet"
                  : "Testnet wallet"}
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
          {["/app/campaigns", "/app/campaigns/new"].includes(
            location.pathname,
          ) ? (
            <CampaignDirectory
              current={baseline ?? deployment}
              onSelect={onSelect}
            />
          ) : chain ? (
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
  const navigate = useNavigate();
  const [baseline, setBaseline] = useState<Deployment | undefined>();
  const [runtime, setRuntime] = useState<RuntimeConfig | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadRuntime()
      .then(async (value) => {
        if (value.mode === "chain") {
          if (active) setBaseline(value);
          const direct = /^\/app\/campaigns\/([a-z0-9-]+)$/.exec(
            location.pathname,
          )?.[1];
          const selectionKey = `yieldfund.selected-campaign:${value.network}`;
          const saved = sessionStorage.getItem(selectionKey);
          const id = direct && direct !== "new" ? direct : saved;
          if (direct === value.config.campaign_id)
            sessionStorage.removeItem(selectionKey);
          if (id && id !== value.config.campaign_id) {
            const response = await fetch("/registry.json", {
              cache: "no-store",
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) throw Error("Campaign registry unavailable");
            const data = await response.json();
            const registry: RegistryDeployment | undefined = data.deployments
              .map(parseRegistry)
              .find((d: RegistryDeployment) => d.network === value.network);
            if (!registry)
              throw Error("Selected campaign registry unavailable");
            const selected = await new CampaignRegistry(
              registry,
            ).resolveCampaign(id, value);
            if (active) setRuntime(selected);
            return;
          }
        }
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
  function select(deployment: Deployment) {
    sessionStorage.setItem(
      `yieldfund.selected-campaign:${deployment.network}`,
      deployment.config.campaign_id,
    );
    setRuntime(deployment);
    navigate(`/app/campaigns/${deployment.config.campaign_id}`);
  }
  if (error)
    return (
      <main className="loading-screen">
        <h1>Deployment unavailable</h1>
        <p role="alert">{error}</p>
        <button className="button" onClick={() => location.reload()}>
          Retry
        </button>
        <Link to="/">Back to website</Link>
        {baseline && (
          <button
            className="button secondary"
            onClick={() => {
              sessionStorage.removeItem(
                `yieldfund.selected-campaign:${baseline.network}`,
              );
              setError("");
              setRuntime(baseline);
              navigate("/app/campaigns");
            }}
          >
            Return to campaign directory
          </button>
        )}
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
      network={runtime.network === "mainnet" ? "mainnet" : "testnet"}
      rpcUrl={runtime.network !== "sandbox" ? runtime.rpcUrl : undefined}
    >
      <ChainProvider
        key={`${runtime.network}:${runtime.vaultId}`}
        deployment={runtime}
      >
        <Shell
          chain
          network={runtime.network}
          deployment={runtime}
          baseline={baseline}
          onSelect={select}
        />
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
