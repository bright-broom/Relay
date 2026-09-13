import { useState, useRef } from "react";
import { compareCosts, comparisonSchema } from "../pricing/comparison";
import { fixedCostProfile } from "../pricing/profiles";
import { InstallmentDraft, monthInput } from "../pricing/form";
import {
  costEvidenceText,
  validCostEvidence,
  evidenceKinds,
  evidenceLabels,
  type CostEvidence,
} from "../ui/input-values";
import type { UiContext } from "../i18n/context";
import type { MessageKey } from "../i18n/messages";
import { Action, ChoiceField, SelectField, Fold, Notice } from "../ui/controls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
type Amounts = {
  currentMonthly: string;
  proposedMonthly: string;
  upfront: string;
  installmentMonthly: string;
};
export function Pricing({
  ui,
  customer,
  presenting,
  onPresent,
}: {
  ui: UiContext;
  customer: string;
  presenting: boolean;
  onPresent: (value: boolean) => void;
}) {
  const { t, money } = ui;
  const [amounts, setAmounts] = useState<Amounts>({
    currentMonthly: "",
    proposedMonthly: "",
    upfront: "",
    installmentMonthly: "0",
  });
  const [term, setTerm] = useState("0"),
    [horizon, setHorizon] = useState("120"),
    [source, setSource] = useState<CostEvidence>({
      kind: "",
      date: "",
      reference: "",
    }),
    [confirmed, setConfirmed] = useState(false);
  const installments = useRef(new InstallmentDraft());
  const parsed = comparisonSchema.safeParse({
    currency: fixedCostProfile.currency,
    ...Object.fromEntries(
      Object.entries(amounts).map(([key, value]) => [
        key,
        ui.normalizeDigits(value),
      ]),
    ),
    installmentMonths: monthInput(ui.normalizeDigits(term)),
    horizonMonths: monthInput(ui.normalizeDigits(horizon)),
  });
  const result = parsed.success ? compareCosts(parsed.data) : null;
  const hasAmount = Boolean(
    amounts.currentMonthly || amounts.proposedMonthly || amounts.upfront,
  );
  const invalid = (field: string) =>
    !parsed.success &&
    hasAmount &&
    parsed.error.issues.some((issue) => issue.path[0] === field);
  const sourceValid = validCostEvidence(source);
  const canPresent = Boolean(result && sourceValid && confirmed);
  const setAmount = (id: keyof Amounts, value: string) => {
    setConfirmed(false);
    setAmounts((current) => ({ ...current, [id]: value }));
  };
  const evidenceChange = (patch: Partial<CostEvidence>) => {
    setConfirmed(false);
    setSource((current) => ({ ...current, ...patch }));
  };
  const amount = (id: keyof Amounts, label: MessageKey) => (
    <div className="field">
      <Label htmlFor={"price-" + id}>{t(label)}</Label>
      <div className="input-action">
        <Input
          id={"price-" + id}
          name={id}
          value={amounts[id]}
          onChange={(event) => setAmount(id, event.target.value)}
          inputMode="numeric"
          maxLength={10}
          required
          aria-invalid={invalid(id)}
          aria-describedby="price-validation"
        />
        <Button
          type="button"
          variant="outline"
          aria-label={t("amountZeroFor", { field: t(label) })}
          onClick={() => setAmount(id, "0")}
        >
          {t("amountZero")}
        </Button>
      </div>
    </div>
  );
  const choices = (values: readonly number[]) =>
    values.map((value) => ({
      value: String(value),
      label:
        value === 0
          ? t("pricingNoPayment")
          : t("pricingMonths", { count: value }),
    }));
  const row = (label: MessageKey, value: string) => (
    <div className="fact">
      <dt>{t(label)}</dt>
      <dd>{money(value)}</dd>
    </div>
  );
  return (
    <section className="stack" id="pricing">
      {customer && <p dir="auto">{customer}</p>}
      <Notice>{t("pricingEstimate")}</Notice>
      <form
        id="price-form"
        hidden={presenting}
        noValidate
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="form-grid">
          {amount("currentMonthly", "pricingCurrent")}
          {amount("proposedMonthly", "pricingRunning")}
          {amount("upfront", "pricingUpfront")}
          <ChoiceField
            ui={ui}
            id="price-horizonMonths"
            label="pricingHorizon"
            options={choices(fixedCostProfile.horizonOptions)}
            value={horizon}
            numeric
            maxLength={3}
            invalid={invalid("horizonMonths")}
            description="price-validation"
            onChange={(value) => {
              setHorizon(value);
              setConfirmed(false);
            }}
          />
        </div>
        <Fold ui={ui} label="pricingPayment">
          <div className="form-grid">
            <ChoiceField
              ui={ui}
              id="price-installmentMonths"
              label="pricingTerm"
              options={choices(fixedCostProfile.installmentOptions)}
              value={term}
              numeric
              maxLength={3}
              invalid={invalid("installmentMonths")}
              description="price-validation"
              onChange={(value) => {
                const next = installments.current.setTerm(
                  ui.normalizeDigits(value),
                  amounts.installmentMonthly,
                );
                setTerm(value);
                setAmount("installmentMonthly", next.monthly);
              }}
            />
            {ui.normalizeDigits(term) !== "0" &&
              amount("installmentMonthly", "pricingPayment")}
          </div>
        </Fold>
        <p id="price-validation" className="field-error" role="status">
          {!parsed.success && hasAmount ? t("pricingInvalid") : ""}
        </p>
        <div className="form-grid">
          <SelectField
            ui={ui}
            id="price-source-kind"
            label="pricingSource"
            value={source.kind}
            required
            aria-describedby="price-source-error"
            options={[
              { value: "", label: t("choose") },
              ...evidenceKinds.map((value) => ({
                value,
                label: t(evidenceLabels[value]),
              })),
            ]}
            onChange={(event) => evidenceChange({ kind: event.target.value })}
          />
          <div className="field">
            <Label htmlFor="price-source-date">{t("sourceDate")}</Label>
            <Input
              id="price-source-date"
              type="date"
              value={source.date}
              required
              aria-describedby="price-source-error"
              onChange={(event) => evidenceChange({ date: event.target.value })}
            />
          </div>
        </div>
        <Fold
          ui={ui}
          label={
            source.kind === "other"
              ? "sourceReferenceRequired"
              : "sourceReference"
          }
          required={source.kind === "other"}
        >
          <Label className="sr-only" htmlFor="price-source">
            {t("sourceReferenceRequired")}
          </Label>
          <Input
            id="price-source"
            maxLength={200}
            value={source.reference}
            required={source.kind === "other"}
            onChange={(event) =>
              evidenceChange({ reference: event.target.value })
            }
            aria-describedby="price-source-error"
          />
        </Fold>
        <p id="price-source-error" className="field-error" role="status">
          {!sourceValid && (source.kind || source.date || source.reference)
            ? t("sourceInvalid")
            : ""}
        </p>
        <div className="row block-gap pricing-confirm">
          <Checkbox
            id="price-confirm"
            checked={confirmed}
            onCheckedChange={(value) => setConfirmed(value === true)}
          />
          <Label htmlFor="price-confirm">{t("pricingConfirm")}</Label>
        </div>
        <p className="meta">{t("pricingSession")}</p>
      </form>
      <div id="price-results" aria-live="polite">
        {result ? (
          <>
            <p className="meta">
              {t("pricingHorizon")} ·{" "}
              {t("pricingMonths", { count: result.input.horizonMonths })}
            </p>
            <div className="split block-gap">
              <Card className="panel">
                <h3>{t("pricingBefore")}</h3>
                <dl>
                  {row("pricingMonthlyPlain", result.input.currentMonthly)}
                  {row("pricingTotal", result.currentTotal)}
                </dl>
              </Card>
              <Card className="panel">
                <h3>{t("pricingAfter")}</h3>
                <dl>
                  {row(
                    result.input.installmentMonths
                      ? "pricingMonthly"
                      : "pricingMonthlyPlain",
                    result.monthlyDuring,
                  )}
                  {result.input.installmentMonths > 0 &&
                    row("pricingAfterTerm", result.monthlyAfter)}
                  {row("pricingTotal", result.proposedTotal)}
                </dl>
              </Card>
            </div>
            <div className="metric">
              <p className="metric-label">
                {t(
                  BigInt(result.totalDifference) > 0n
                    ? "pricingReduction"
                    : BigInt(result.totalDifference) < 0n
                      ? "pricingIncrease"
                      : "pricingSame",
                )}
              </p>
              <p className="metric-value">
                {money(
                  (BigInt(result.totalDifference) < 0n
                    ? -BigInt(result.totalDifference)
                    : BigInt(result.totalDifference)
                  ).toString(),
                )}
              </p>
            </div>
            {BigInt(result.remainingInstallments) > 0n && (
              <Notice>
                <dl>{row("pricingRemaining", result.remainingInstallments)}</dl>
                <p>{t("pricingRemainingHint")}</p>
              </Notice>
            )}
            <p>{t("pricingScope")}</p>
            <Fold ui={ui} label="pricingAssumptions" required={presenting}>
              <dl>
                {row("pricingUpfront", result.input.upfront)}
                {row("pricingRunning", result.input.proposedMonthly)}
                {row("pricingPayment", result.input.installmentMonthly)}
                <div className="fact">
                  <dt>{t("pricingTerm")}</dt>
                  <dd>
                    {t("pricingMonths", {
                      count: result.input.installmentMonths,
                    })}
                  </dd>
                </div>
              </dl>
              <h3 className="block-gap">{t("pricingBreakdown")}</h3>
              <dl>
                {row("pricingRunningTotal", result.runningTotal)}
                {row("pricingPaymentTotal", result.installmentTotal)}
              </dl>
              <p>{t("pricingFormulaBefore")}</p>
              <p>{t("pricingFormulaAfter")}</p>
              <p>{t("pricingPrecision")}</p>
              {sourceValid && (
                <p>
                  {t("pricingSource")}: {costEvidenceText(ui, source)}
                </p>
              )}
              <p className="meta">
                {t("pricingVersion", { version: result.version })}
              </p>
            </Fold>
          </>
        ) : (
          <p className="empty">{t("pricingEmpty")}</p>
        )}
      </div>
      {!presenting && <p className="meta">{t("pricingEvidenceNeeded")}</p>}
      <div className="form-actions">
        {presenting ? (
          <Action
            ui={ui}
            label="pricingEdit"
            variant="outline"
            onClick={() => {
              onPresent(false);
              requestAnimationFrame(() =>
                document.getElementById("price-currentMonthly")?.focus(),
              );
            }}
          />
        ) : (
          <Action
            ui={ui}
            label="pricingPresent"
            disabled={!canPresent}
            onClick={() => {
              if (canPresent) onPresent(true);
            }}
          />
        )}
      </div>
    </section>
  );
}
