import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "surface" | "ghost" | "accent";
type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconLeft?: ReactNode;
}

export function Button({
  variant = "surface",
  size = "md",
  iconLeft,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={cx("ds-button", `ds-button--${variant}`, `ds-button--${size}`, className)} type="button" {...props}>
      {iconLeft ? <span className="ds-button__icon">{iconLeft}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "warm";
  icon?: ReactNode;
}

export function Badge({ tone = "neutral", icon, className, children, ...props }: BadgeProps) {
  return (
    <span className={cx("ds-badge", `ds-badge--${tone}`, className)} {...props}>
      {icon ? <span className="ds-badge__icon">{icon}</span> : null}
      {children}
    </span>
  );
}

interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  status?: "ready" | "draft";
}

export function StatusPill({ status = "ready", className, children, ...props }: StatusPillProps) {
  return (
    <span className={cx("ds-status", `ds-status--${status}`, className)} {...props}>
      {children ?? (status === "ready" ? "Ready" : "Draft")}
    </span>
  );
}

interface SegmentedOption<T extends string> {
  label: string;
  value: T;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string> extends HTMLAttributes<HTMLDivElement> {
  options: SegmentedOption<T>[];
  value: T;
}

export function SegmentedControl<T extends string>({ options, value, className, ...props }: SegmentedControlProps<T>) {
  return (
    <div className={cx("ds-segmented", className)} {...props}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("ds-segmented__item", option.value === value && "is-active")}
          aria-pressed={option.value === value}
        >
          {option.icon ? <span className="ds-segmented__icon">{option.icon}</span> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function TextInput({ label, className, ...props }: TextInputProps) {
  return (
    <label className="ds-field">
      {label ? <span className="ds-field__label">{label}</span> : null}
      <input className={cx("ds-input", className)} {...props} />
    </label>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function TextArea({ label, className, ...props }: TextAreaProps) {
  return (
    <label className="ds-field">
      {label ? <span className="ds-field__label">{label}</span> : null}
      <textarea className={cx("ds-textarea", className)} {...props} />
    </label>
  );
}

interface CardProps extends HTMLAttributes<HTMLElement> {
  muted?: boolean;
}

export function Card({ muted, className, children, ...props }: CardProps) {
  return (
    <section className={cx("ds-card", muted && "ds-card--muted", className)} {...props}>
      {children}
    </section>
  );
}

export function RailButton({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx("ds-rail-button", className)} {...props}>
      {children}
    </button>
  );
}

interface BreadcrumbProps extends HTMLAttributes<HTMLOListElement> {
  items: string[];
}

export function Breadcrumb({ items, className, ...props }: BreadcrumbProps) {
  return (
    <ol className={cx("ds-breadcrumb", className)} {...props}>
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="ds-breadcrumb__item">
          {item}
        </li>
      ))}
    </ol>
  );
}

interface LibrarySectionProps extends HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
}

export function LibrarySection({ title, description, className, children, ...props }: LibrarySectionProps) {
  return (
    <section className={cx("library-section", className)} {...props}>
      <header className="library-section__header">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
