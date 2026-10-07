"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { requestJson } from "@/lib/data/http-service";

type Provider = "bukku" | "autocount";

const FIELDS: Record<Provider, Array<{ key: string; label: string; placeholder: string; secret?: boolean }>> = {
  bukku: [
    { key: "subdomain", label: "Company subdomain", placeholder: "mycompany (from mycompany.bukku.my)" },
    { key: "accessToken", label: "Access token", placeholder: "Control Panel → Integrations → API Access", secret: true },
  ],
  autocount: [
    { key: "accountBookId", label: "Account book ID", placeholder: "e.g. 1234" },
    { key: "keyId", label: "Key ID", placeholder: "Settings → API Keys" },
    { key: "apiKey", label: "API Key", placeholder: "Settings → API Keys", secret: true },
  ],
};

const HELP: Record<Provider, string> = {
  bukku: "In Bukku, open Control Panel → Integrations, turn on API Access and copy the access token.",
  autocount: "In AutoCount Cloud Accounting, open Settings → API Keys, create a key with read access, then copy the Key ID and API Key.",
};

/** Credential form for accounting software that uses API keys instead of a sign-in page. */
export function ApiKeyConnectForm({ provider, name, onConnected }: { provider: Provider; name: string; onConnected: () => void }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function connect() {
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/integrations/accounting/${provider}/api-key`, { method: "POST", body: JSON.stringify(values) }, `We couldn't connect ${name}.`);
      setValues({});
      setOpen(false);
      onConnected();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `We couldn't connect ${name}.`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0D1B3D] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#162956]">
        <KeyRound className="h-4 w-4" aria-hidden="true" /> Connect {name}
      </button>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[11px] leading-relaxed text-gray-500">{HELP[provider]}</p>
      {FIELDS[provider].map((field) => (
        <label key={field.key} className="text-[11px] font-bold text-gray-700">{field.label}
          <input
            type={field.secret ? "password" : "text"}
            autoComplete="off"
            value={values[field.key] ?? ""}
            placeholder={field.placeholder}
            onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-normal"
          />
        </label>
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={() => { setOpen(false); setError(""); }} className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600">Cancel</button>
        <button type="button" onClick={() => void connect()} disabled={busy || FIELDS[provider].some((field) => !(values[field.key] ?? "").trim())}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#009966] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Connect
        </button>
      </div>
      {error && <p role="alert" className="text-[11px] font-semibold text-red-700">{error}</p>}
      <p className="text-[10px] text-gray-400">Your key is checked with a read-only request and stored encrypted.</p>
    </div>
  );
}
