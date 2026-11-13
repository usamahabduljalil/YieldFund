import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  Plant,
  X,
  WarningCircle,
} from "@phosphor-icons/react";
import { formatAmount } from "@yieldfund/domain";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className={`brand ${compact ? "compact" : ""}`}
      aria-label="YieldFund home"
    >
      <Plant size={29} weight="bold" />
      <span>
        yieldfund<span className="brand-period">.</span>
      </span>
    </Link>
  );
}
export function ArrowLink({
  to,
  children,
  secondary = false,
}: {
  to: string;
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link className={`button ${secondary ? "secondary" : ""}`} to={to}>
      {children}
      <ArrowUpRight size={18} />
    </Link>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "danger" | "success";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Money({
  amount,
  unit = true,
}: {
  amount: bigint;
  unit?: boolean;
}) {
  return (
    <>
      {formatAmount(amount)}
      {unit && <span className="unit"> tUSD</span>}
    </>
  );
}
export function Metric({
  label,
  amount,
  note,
}: {
  label: string;
  amount: bigint;
  note?: string;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong>
        <Money amount={amount} unit={false} />
      </strong>
      <span className="metric-note">{note ?? "tUSD · example token"}</span>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Plant size={32} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <WarningCircle size={18} />
      <span>{children}</span>
    </div>
  );
}
export function TextLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowRight size={16} />
    </Link>
  );
}
export function Modal({
  title,
  children,
  onClose,
  contextLabel = "YIELDFUND / LOCAL PREVIEW",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  contextLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el?.close();
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">{contextLabel}</span>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
