import { useState, type FormEvent } from "react";
import { catalogs, canonicalLocale } from "../i18n/messages";
import type { UiContext } from "../i18n/context";
import { SelectField, Action, Fold } from "./controls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const suggestions = [
  "ja",
  "en",
  "ko",
  "zh-CN",
  "zh-TW",
  "fr",
  "es",
  "de",
  "pt-BR",
  "ar",
  "he",
  "hi",
  "id",
  "th",
  "vi",
];
export function LanguageForm({
  ui,
  onApply,
}: {
  ui: UiContext;
  onApply?: (locale: string) => void;
}) {
  const [selected, setSelected] = useState(ui.locale),
    [custom, setCustom] = useState(ui.locale),
    [error, setError] = useState(false);
  const names = new Intl.DisplayNames([ui.language], { type: "language" });
  const options = [
    ...new Set([...Object.keys(catalogs), ...suggestions, ui.locale]),
  ].map((value) => ({ value, label: names.of(value) ?? value }));
  function submit(event: FormEvent, value: string) {
    if (!onApply) return;
    event.preventDefault();
    const locale = canonicalLocale(value);
    if (!locale) {
      setError(true);
      requestAnimationFrame(()=>document.getElementById("language-custom-tag")?.focus());
      return;
    }
    onApply(locale);
  }
  const customForm = (
    <form
      id="language-custom-form"
      action="/"
      method="get"
      className="stack"
      onSubmit={(event) => submit(event, custom)}
    >
      <div className="field">
        <Label htmlFor="language-custom-tag">{ui.t("languageTag")}</Label>
        <Input
          id="language-custom-tag"
          name="lang"
          value={custom}
          onChange={(event) => {
            setError(false);
            setCustom(event.target.value);
          }}
          maxLength={100}
          required
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error}
          aria-describedby="language-help language-error"
        />
      </div>
      <p id="language-error" role="alert">
        {error ? ui.t("invalidLanguage") : ""}
      </p>
      <Action ui={ui} label="applyLanguage" symbol="check" type="submit" />
    </form>
  );
  return (
    <div className="stack">
      <form
        id="language-form"
        action="/"
        method="get"
        className="stack"
        onSubmit={(event) => submit(event, selected)}
      >
        <SelectField
          ui={ui}
          id="language-tag"
          label="language"
          name="lang"
          value={selected}
          options={options}
          onChange={(event) => setSelected(event.target.value)}
          aria-describedby="language-help"
        />
        <Action ui={ui} label="applyLanguage" symbol="check" type="submit" />
      </form>
      {onApply ? (
        <Fold ui={ui} label="languageTag">
          {customForm}
        </Fold>
      ) : (
        <details className="disclosure">
          <summary>{ui.t("languageTag")}</summary>
          {customForm}
        </details>
      )}
      <p id="language-help" className="meta">
        {ui.t("languageCoverage")}
      </p>
    </div>
  );
}
