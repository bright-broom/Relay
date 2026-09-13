import { useId, useState, type ReactNode, type ComponentProps } from "react";
import type { UiContext } from "../i18n/context";
import type { MessageKey } from "../i18n/messages";
import { Icon, iconOnly, labeled } from "./icons";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Alert } from "@/components/ui/alert";
export function Action({
  ui,
  label,
  symbol,
  iconOnly: only,
  children,
  ...props
}: {
  ui: UiContext;
  label: MessageKey;
  symbol?: string;
  iconOnly?: boolean;
  children?: ReactNode;
} & ComponentProps<typeof Button>) {
  const name = symbol ?? iconOnly[label] ?? labeled[label];
  const compact = only ?? Boolean(iconOnly[label]);
  const control = (
    <Button
      type="button"
      size={compact ? "icon" : "default"}
      aria-label={ui.t(label)}
      {...props}
    >
      {name && <Icon name={name} />}{" "}
      {!compact && <span>{children ?? ui.t(label)}</span>}
    </Button>
  );
  return compact ? (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>{ui.t(label)}</TooltipContent>
    </Tooltip>
  ) : (
    control
  );
}
export function IconLink({
  ui,
  label,
  href,
  symbol,
}: {
  ui: UiContext;
  label: MessageKey;
  href: string;
  symbol: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" asChild>
          <a href={href} aria-label={ui.t(label)}>
            <Icon name={symbol} />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{ui.t(label)}</TooltipContent>
    </Tooltip>
  );
}
export function Fold({
  ui,
  label,
  children,
  required = false,
  defaultOpen = false,
  deferMount = false,
}: {
  ui: UiContext;
  label: MessageKey;
  children: ReactNode;
  required?: boolean;
  defaultOpen?: boolean;
  deferMount?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [activated, setActivated] = useState(!deferMount || defaultOpen || required);
  return (
    <Collapsible
      className="disclosure"
      open={required || open}
      onOpenChange={(value) => { if (value) setActivated(true); setOpen(value); }}
    >
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="disclosure-trigger">
          {ui.t(label)}
          <Icon name="chevron" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        className="disclosure-body"
        forceMount
        hidden={!(required || open)}
      >
        {(activated || required) && children}
      </CollapsibleContent>
    </Collapsible>
  );
}
export type Option = { value: string; label: string; disabled?: boolean };
export function SelectField({
  ui,
  label,
  options,
  id,
  hideLabel = false,
  ...props
}: {
  ui: UiContext;
  label: MessageKey;
  options: readonly Option[];
  hideLabel?: boolean;
} & ComponentProps<typeof NativeSelect>) {
  const unique = useId();
  const fieldId = id ?? unique;
  return (
    <div className="field">
      <Label htmlFor={fieldId} className={hideLabel ? "sr-only" : undefined}>
        {ui.t(label)}
      </Label>
      <NativeSelect id={fieldId} {...props}>
        {options.map((option) => (
          <NativeSelectOption
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
export function ChoiceField({
  ui,
  id,
  label,
  options,
  value,
  onChange,
  numeric = false,
  maxLength = 120,
  disabled = false,
  invalid = false,
  description,
}: {
  ui: UiContext;
  id: string;
  label: MessageKey;
  options: readonly Option[];
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  maxLength?: number;
  disabled?: boolean;
  invalid?: boolean;
  description?: string;
}) {
  const [custom, setCustom] = useState(
    !options.some((option) => option.value === value),
  );
  const [draft, setDraft] = useState(custom ? value : "");
  return (
    <div className="stack">
      <SelectField
        ui={ui}
        id={id}
        label={label}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={description}
        options={[
          ...options.map((option, index) => ({
            ...option,
            value: String(index),
          })),
          { value: "custom", label: ui.t("customValue") },
        ]}
        value={
          custom
            ? "custom"
            : String(options.findIndex((option) => option.value === value))
        }
        onChange={(event) => {
          const next = event.target.value === "custom";
          setCustom(next);
          onChange(next ? draft : options[Number(event.target.value)].value);
          if (next)
            requestAnimationFrame(() =>
              document.getElementById(id + "-custom")?.focus(),
            );
        }}
      />
      {custom && (
        <div className="field">
          <Label className="sr-only" htmlFor={id + "-custom"}>
            {ui.t("customFor", { field: ui.t(label) })}
          </Label>
          <Input
            id={id + "-custom"}
            value={value}
            onChange={(event) => {
              setDraft(event.target.value);
              onChange(event.target.value);
            }}
            inputMode={numeric ? "numeric" : undefined}
            maxLength={maxLength}
            disabled={disabled}
            required
            aria-invalid={invalid}
            aria-describedby={description}
          />
        </div>
      )}
    </div>
  );
}
export function Notice({
  children,
  error = false,
  id,
  className = "",
}: {
  children: ReactNode;
  error?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <Alert
      id={id}
      role={error ? "alert" : "status"}
      className={"notice " + className}
    >
      <Icon name={error ? "alert" : "info"} />
      <div>{children}</div>
    </Alert>
  );
}
export function Heading({ ui, label }: { ui: UiContext; label: MessageKey }) {
  return (
    <header className="page-head">
      <h1 id="page-title" tabIndex={-1}>
        {ui.t(label)}
      </h1>
    </header>
  );
}
export const keyOptions = (ui: UiContext, keys: readonly MessageKey[]) =>
  keys.map((value) => ({ value, label: ui.t(value) }));
