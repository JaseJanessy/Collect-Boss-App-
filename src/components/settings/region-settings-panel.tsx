"use client";

import { useState } from "react";
import { Globe2, Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { useRegion } from "@/contexts/region-context";
import { COUNTRY_CAPABILITIES, defaultsForCountry } from "@/lib/international/registry";
import type { BusinessRegistrationIdentifier, RegionConfigurationDto, SupportedCountryCode } from "@/lib/international/types";

export function RegionSettingsPanel() {
  const region = useRegion();
  if (region.loading) return null;
  if (!region.configuration.canManage) {
    const settings = region.configuration.settings;
    return <SectionCard title="Business & Region">
      <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <RegionSummary label="Country" value={COUNTRY_CAPABILITIES[settings.countryCode].displayName} />
        <RegionSummary label="Locale" value={settings.locale} />
        <RegionSummary label="Timezone" value={settings.timezone} />
        <RegionSummary label="Currency" value={settings.defaultCurrency} />
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
        Region settings are read-only in this session. An owner or admin can manage them when connected to tenant data.
      </p>
    </SectionCard>;
  }
  const key = JSON.stringify(region.configuration);
  return <RegionSettingsEditor key={key} configuration={region.configuration} refresh={region.refresh} />;
}

function RegionSummary({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-gray-50 p-3">
    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
    <p className="mt-1 break-words font-bold text-gray-800">{value}</p>
  </div>;
}

function RegionSettingsEditor({ configuration, refresh }: { configuration: RegionConfigurationDto; refresh: () => Promise<void> }) {
  const [settings, setSettings] = useState(configuration.settings);
  const [address, setAddress] = useState(configuration.address);
  const [phoneDisplay, setPhoneDisplay] = useState(configuration.phoneDisplay ?? "");
  const [identifiers, setIdentifiers] = useState<BusinessRegistrationIdentifier[]>(configuration.registrationIdentifiers);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const capability = COUNTRY_CAPABILITIES[settings.countryCode];

  function changeCountry(countryCode: SupportedCountryCode) {
    setSettings(defaultsForCountry(countryCode));
    setAddress((current) => ({ ...current, countryCode }));
    setIdentifiers((current) => current.map((item) => ({ ...item, issuingCountry: countryCode })));
  }

  function addIdentifier() {
    const suggested = capability.businessIdentifierTypes[0];
    setIdentifiers((current) => [...current, {
      type: suggested?.type ?? "business_registration", value: "", label: suggested?.label ?? null,
      issuingCountry: settings.countryCode,
    }]);
  }

  function updateIdentifier(index: number, patch: Partial<BusinessRegistrationIdentifier>) {
    setIdentifiers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function save() {
    setSaving(true); setMessage("");
    const response = await fetch("/api/region-settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...settings, address, phoneDisplay: phoneDisplay.trim() || null, registrationIdentifiers: identifiers }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setMessage(payload.error ?? "Unable to save region settings.");
    else { setMessage("Region settings saved. Stored financial values and historical timestamps were not changed."); await refresh(); }
    setSaving(false);
  }

  return <SectionCard title="Business & Region">
    <div className="mt-2 flex gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-800">
      <Globe2 className="mt-0.5 h-4 w-4 shrink-0" />
      Country selection controls presentation and future capability adapters. It does not certify legal or compliance correctness.
    </div>

    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Country">
        <select value={settings.countryCode} onChange={(event) => changeCountry(event.target.value as SupportedCountryCode)} className={inputClass}>
          {Object.values(COUNTRY_CAPABILITIES).map((country) => <option key={country.countryCode} value={country.countryCode}>{country.displayName}</option>)}
        </select>
      </Field>
      <Field label="Locale">
        <select value={settings.locale} onChange={(event) => setSettings({ ...settings, locale: event.target.value })} className={inputClass}>
          {capability.supportedLocales.map((locale) => <option key={locale}>{locale}</option>)}
        </select>
      </Field>
      <Field label="Timezone">
        <select value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} className={inputClass}>
          {capability.supportedTimezones.map((timezone) => <option key={timezone}>{timezone}</option>)}
        </select>
      </Field>
      <Field label="Default currency">
        <select value={settings.defaultCurrency} onChange={(event) => setSettings({ ...settings, defaultCurrency: event.target.value })} className={inputClass}>
          {[...new Set(Object.values(COUNTRY_CAPABILITIES).map((country) => country.defaultCurrency))].map((currency) => <option key={currency}>{currency}</option>)}
        </select>
      </Field>
      <Field label="Date format">
        <select value={settings.dateFormat} onChange={(event) => setSettings({ ...settings, dateFormat: event.target.value as typeof settings.dateFormat })} className={inputClass}>
          <option value="locale">Locale default</option><option value="day-month-year">Day / month / year</option>
          <option value="month-day-year">Month / day / year</option><option value="year-month-day">Year / month / day</option>
        </select>
      </Field>
      <Field label="Number format">
        <select value={settings.numberFormat} onChange={(event) => setSettings({ ...settings, numberFormat: event.target.value as typeof settings.numberFormat })} className={inputClass}>
          <option value="locale">Locale default</option><option value="dot-decimal">1,234.56</option><option value="comma-decimal">1.234,56</option>
        </select>
      </Field>
      <Field label="Language code">
        <input value={settings.languageCode} onChange={(event) => setSettings({ ...settings, languageCode: event.target.value })} className={inputClass} placeholder="en" />
      </Field>
      <Field label="Business phone">
        <input type="tel" value={phoneDisplay} onChange={(event) => setPhoneDisplay(event.target.value)} className={inputClass} placeholder={`+${capability.callingCode} …`} />
        <p className="mt-1 text-[10px] text-gray-400">The entered display value is preserved; a validated E.164 companion is stored when possible.</p>
      </Field>
    </div>

    <div className="mt-4 rounded-xl border border-gray-100 p-3">
      <p className="text-xs font-bold text-gray-800">Structured business address</p>
      <p className="mt-0.5 text-[10px] text-gray-400">Fields are optional and do not assume a Malaysia-only state or postcode structure.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Address lines">
          <textarea value={address.lines.join("\n")} onChange={(event) => setAddress({ ...address, lines: event.target.value.split("\n").slice(0, 4) })} className={`${inputClass} min-h-20`} />
        </Field>
        <div className="grid gap-3">
          <Field label="City / locality"><input value={address.locality ?? ""} onChange={(event) => setAddress({ ...address, locality: event.target.value || null })} className={inputClass} /></Field>
          <Field label="State / region (optional)"><input value={address.administrativeArea ?? ""} onChange={(event) => setAddress({ ...address, administrativeArea: event.target.value || null })} className={inputClass} /></Field>
          <Field label="Postal code (optional)"><input value={address.postalCode ?? ""} onChange={(event) => setAddress({ ...address, postalCode: event.target.value || null })} className={inputClass} /></Field>
        </div>
      </div>
    </div>

    <div className="mt-4 rounded-xl border border-gray-100 p-3">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-xs font-bold text-gray-800">Business registration identifiers</p><p className="mt-0.5 text-[10px] text-gray-400">Generic typed metadata; no country-specific database columns.</p></div>
        <button type="button" onClick={addIdentifier} className="flex items-center gap-1 text-[11px] font-bold text-[#009966]"><Plus className="h-3.5 w-3.5" />Add</button>
      </div>
      <div className="mt-2 space-y-2">
        {identifiers.map((identifier, index) => <div key={`${identifier.type}-${index}`} className="grid gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input aria-label="Identifier type" value={identifier.type} onChange={(event) => updateIdentifier(index, { type: event.target.value })} className={inputClass} placeholder="business_registration" />
          <input aria-label="Identifier label" value={identifier.label ?? ""} onChange={(event) => updateIdentifier(index, { label: event.target.value || null })} className={inputClass} placeholder={capability.businessIdentifierTypes[0]?.label} />
          <input aria-label="Identifier value" value={identifier.value} onChange={(event) => updateIdentifier(index, { value: event.target.value })} className={inputClass} placeholder="Registration value" />
          <button type="button" aria-label="Remove identifier" onClick={() => setIdentifiers((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="p-2 text-red-500"><Trash2 className="h-4 w-4" /></button>
        </div>)}
      </div>
    </div>

    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[10px] text-gray-400">Defaults source: {configuration.defaultsSource.replaceAll("_", " ")}</p>
      <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-[#0D1B3D] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save region settings"}</button>
    </div>
    {message && <p role="status" className={`mt-2 text-[11px] ${message.startsWith("Region settings saved") ? "text-emerald-700" : "text-red-600"}`}>{message}</p>}
  </SectionCard>;
}

const inputClass = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs text-gray-700 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-[11px] font-semibold text-gray-600"><span className="mb-1 block">{label}</span>{children}</label>;
}
