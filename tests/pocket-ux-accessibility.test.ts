import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Pocket has a scoped, tactile, approved navy and green visual system", () => {
  const css = read("src/app/globals.css");
  const tokens = JSON.parse(read("shared/brand-tokens.json"));
  assert.match(css, /\.pocket-root/);
  assert.equal(tokens.pocket.ink, "#0D1B3D");
  assert.equal(tokens.pocket.action.addDebt, "#009966");
  assert.equal(tokens.pocket.action.recordPayment, "#175CD3");
  assert.equal(tokens.pocket.action.scanReceipt, "#6941C6");
  assert.equal(tokens.pocket.action.whoOwesMe, "#B54708");
  assert.match(css, /\.pocket-action-tile/);
  assert.match(css, /data-pocket-action="scan-receipt"/);
  assert.match(css, /\.pocket-primary-action/);
  assert.match(css, /min-height: 3rem/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /forced-colors: active/);
  const pocketBlock = css.slice(css.indexOf(".pocket-root"));
  assert.doesNotMatch(pocketBlock, /radial-gradient/i);
});

test("Pocket shell keeps touch navigation through tablet and uses a laptop rail", () => {
  const shell = read("src/components/pocket/pocket-shell.tsx");
  assert.match(shell, /data-pocket-shell/);
  assert.match(shell, /CollectBossPocketWordmark/);
  assert.match(shell, /lg:flex/);
  assert.match(shell, /lg:hidden/);
  assert.match(shell, /min-h-16/);
  assert.match(shell, /aria-current/);
  assert.match(shell, /Skip to main content/);
  assert.match(shell, /navigator\.onLine/);
  assert.match(shell, /role="alert" aria-live="assertive"/);
  assert.match(read("src/components/beta/feedback-button.tsx"), /pathname\.startsWith\("\/pocket"\)/);
  const preview = read("src/app/dev/pocket-ux/page.tsx");
  assert.match(preview, /process\.env\.NODE_ENV!=="development"/);
  assert.match(preview, /notFound\(\)/);
});

test("Pocket home exposes the locked three-second hierarchy", () => {
  const home = read("src/app/pocket/page.tsx");
  const ledger = read("src/components/pocket/pocket-ledger.tsx");
  for (const id of ["add-debt", "record-payment", "scan-receipt", "who-owes-me"]) assert.match(home, new RegExp(id, "i"));
  assert.match(ledger, /Today to Collect/);
  assert.match(ledger, /Due Today/);
  assert.match(ledger, /Overdue/);
  assert.match(ledger, /Recent payments/);
  assert.match(ledger, />Retry</);
});

test("Core Pocket forms associate server errors and expose busy state", () => {
  for (const path of [
    "src/components/pocket/pocket-ledger.tsx",
    "src/components/pocket/pocket-payments.tsx",
    "src/components/pocket/pocket-invoices.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /aria-busy=/, path);
    assert.match(source, /aria-describedby=/, path);
    assert.match(source, /role="alert"/, path);
  }
});

test("Long names and amounts wrap in Pocket data cards", () => {
  for (const path of [
    "src/components/pocket/pocket-ledger.tsx",
    "src/components/pocket/pocket-payments.tsx",
    "src/components/pocket/pocket-receipts.tsx",
    "src/components/pocket/pocket-invoices.tsx",
  ]) assert.doesNotMatch(read(path), /className="[^"]*truncate/, path);
  assert.match(read("src/app/globals.css"), /overflow-wrap: anywhere/);
});

test("Web and native shells share the Pocket motif and short action language", () => {
  const web = read("src/components/brand/pocket-wordmark.tsx");
  const native = read("mobile/src/products/pocket/pocket-app.tsx");
  assert.match(web, /Boss Pocket/);
  assert.match(native, /CollectBossPocketWordmark/);
  assert.doesNotMatch(native, /pocketFold|pocketMark/);
  assert.match(native, /accessibilityRole="tablist"/);
  assert.match(native, /accessibilityState=\{\{ selected \}\}/);
  assert.doesNotMatch(native, /will be added in a later prompt/i);
});
