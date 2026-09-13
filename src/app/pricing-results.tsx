import type { CSSProperties } from 'react';
import type { ComparisonResult } from '../pricing/comparison';
import type { CostEvidence } from '../ui/input-values';
import { costEvidenceText, validCostEvidence } from '../ui/input-values';
import type { UiContext } from '../i18n/context';
import type { MessageKey } from '../i18n/messages';
import { Badge } from '@/components/ui/badge';
import { Fold } from '../ui/controls';
import { Icon } from '../ui/icons';

/** Display adapter only: amounts and differences come from the calculation engine. */
export function PricingResults({ui,result,source}: {
  ui:UiContext;result:ComparisonResult;source:CostEvidence;
}) {
  const {t,money}=ui;
  const {input}=result;
  const totalDelta=BigInt(result.totalDifference);
  const monthlyDelta=BigInt(result.monthlyDifference);
  const magnitude=(value:bigint)=>money((value<0n?-value:value).toString());
  const direction=(value:bigint)=>value>0n?'decrease':value<0n?'increase':'equal';
  const largest=BigInt(result.currentTotal)>BigInt(result.proposedTotal)?BigInt(result.currentTotal):BigInt(result.proposedTotal);
  // Only the decorative bar ratio is rounded; displayed money stays exact.
  const bar=(amount:string):CSSProperties=>({
    '--comparison-share':`${largest===0n?0:Number(BigInt(amount)*10000n/largest)/100}%`,
  } as CSSProperties);
  const fact=(label:MessageKey,value:string)=><div className="fact"><dt>{t(label)}</dt><dd>{money(value)}</dd></div>;
  const totals=[
    {label:'pricingBefore',amount:result.currentTotal,phase:'before'},
    {label:'pricingAfter',amount:result.proposedTotal,phase:'after'},
  ] as const;
  return <div className="price-summary">
    <div className="row space-between">
      <p className="meta">{t('pricingHorizon')} · {t('pricingMonths',{count:input.horizonMonths})}</p>
      <Badge>{t('pricingEstimateLabel')}</Badge>
    </div>
    <section className="price-monthly" aria-labelledby="price-monthly-title">
      <h3 id="price-monthly-title" tabIndex={-1}>{t('pricingMonthlyHeading')}</h3>
      <div className="price-pair">
        <div className="price-option" data-phase="before">
          <h4>{t('pricingBefore')}</h4>
          <p className="meta">{t('pricingMonthlyPlain')}</p>
          <p className="price-amount"><bdi>{money(input.currentMonthly)}</bdi></p>
        </div>
        <div className="price-option" data-phase="after">
          <h4>{t('pricingAfter')}</h4>
          <p className="meta">{t(input.installmentMonths?'pricingMonthly':'pricingMonthlyPlain')}</p>
          <p className="price-amount"><bdi>{money(result.monthlyDuring)}</bdi></p>
          {input.installmentMonths>0 && <div className="price-later">
            <p>{t('pricingAfterTerm')} · {t('pricingFromMonth',{month:input.installmentMonths+1})}</p>
            <p className="price-secondary"><bdi>{money(result.monthlyAfter)}</bdi></p>
          </div>}
        </div>
      </div>
      <p className="price-change" data-direction={direction(monthlyDelta)}>
        <Icon name={direction(monthlyDelta)} />
        {t(monthlyDelta>0n?'pricingMonthlyReduction':monthlyDelta<0n?'pricingMonthlyIncrease':'pricingMonthlySame',{amount:magnitude(monthlyDelta)})}
        {input.installmentMonths>0 && <span className="meta">{t('pricingDuringTerm')}</span>}
      </p>
      {BigInt(input.upfront)>0n && <p className="meta">{t('pricingUpfrontSummary',{amount:money(input.upfront)})}</p>}
    </section>
    <section className="price-total" aria-labelledby="price-total-title">
      <div className="row space-between">
        <h3 id="price-total-title">{t('pricingTotal')}</h3>
        <p>{t('pricingMonths',{count:input.horizonMonths})}</p>
      </div>
      <div className="price-bars">
        {totals.map(item=><div className="price-bar-row" data-phase={item.phase} key={item.phase}>
          <dl><dt>{t(item.label)}</dt><dd><bdi>{money(item.amount)}</bdi></dd></dl>
          <div className="price-bar-track" aria-hidden="true"><div className="price-bar-fill" style={bar(item.amount)} /></div>
        </div>)}
      </div>
      <div className="price-total-difference" data-direction={direction(totalDelta)}>
        <p className="row"><Icon name={direction(totalDelta)} />{t(totalDelta>0n?'pricingReduction':totalDelta<0n?'pricingIncrease':'pricingSame')}</p>
        <p className="price-secondary"><bdi>{magnitude(totalDelta)}</bdi></p>
      </div>
      {BigInt(result.remainingInstallments)>0n && <aside className="price-remaining" aria-label={t('pricingRemaining')}>
        <div className="row"><Icon name="alert"/><strong>{t('pricingRemaining')}</strong></div>
        <p className="price-secondary"><bdi>{money(result.remainingInstallments)}</bdi></p>
        <p>{t('pricingRemainingHint')}</p>
      </aside>}
    </section>
    <section className="price-conditions" aria-labelledby="price-conditions-title">
      <h3 id="price-conditions-title">{t('pricingConditionsHeading')}</h3>
      <dl className="price-conditions-grid">
        {fact('pricingUpfront',input.upfront)}
        <div className="fact"><dt>{t('pricingTerm')}</dt><dd>{input.installmentMonths?t('pricingMonths',{count:input.installmentMonths}):t('pricingNoPayment')}</dd></div>
      </dl>
      <p>{t('pricingScope')}</p>
      {validCostEvidence(source) && <p className="price-source"><Icon name="file"/><span>{t('pricingSource')}: {costEvidenceText(ui,source)}</span></p>}
      <p className="meta">{t('pricingEstimate')}</p>
      <Fold ui={ui} label="pricingAssumptions">
        <dl className="price-conditions-grid">
          {fact('pricingRunning',input.proposedMonthly)}
          {fact('pricingPayment',input.installmentMonthly)}
        </dl>
        <h4 className="block-gap">{t('pricingBreakdown')}</h4>
        <dl className="price-conditions-grid">
          {fact('pricingRunningTotal',result.runningTotal)}
          {fact('pricingPaymentTotal',result.installmentTotal)}
        </dl>
        <p>{t('pricingFormulaBefore')}</p>
        <p>{t('pricingFormulaAfter')}</p>
        <p>{t('pricingPrecision')}</p>
        <p className="meta">{t('pricingVersion',{version:result.version})}</p>
      </Fold>
    </section>
  </div>;
}
