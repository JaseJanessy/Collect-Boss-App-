# Automatic WhatsApp reminders

CollectBoss sends payment reminders from **one verified CollectBoss WhatsApp
number** through the WhatsApp Business Platform (Meta Cloud API). Each
business turns it on in **Settings → Automatic WhatsApp reminders**.

## How it works

1. The hourly job (`/api/cron/domain-events`) calls
   `whatsapp_enqueue_due_reminders`. It queues one reminder for each open
   invoice whose due date plus a chosen offset equals today (Malaysia time).
2. A customer receives at most one automatic reminder per day.
3. Messages are only sent between **9am and 8pm Malaysia time**. Outside that
   window they wait for the next run.
4. Before sending, the worker skips the message if:
   - the customer replied STOP,
   - the contact is marked wrong number, invalid, or email-only,
   - the invoice is already paid or closed.
5. Delivery updates (sent / delivered / read / failed) and STOP replies arrive
   on `/api/webhooks/whatsapp`, which is verified with `X-Hub-Signature-256`.

Rules for businesses:

- The feature is available on **paid plans only**, because Meta charges per
  conversation.
- An owner or admin must confirm customer consent before turning it on.
- Changes to the setting are recorded in the audit log.

## Setup checklist (one time, for CollectBoss)

1. In Meta Business Manager, verify the CollectBoss business. Then add a phone
   number to a WhatsApp Business Account.
2. Create a **System User** with a permanent access token that has the
   `whatsapp_business_messaging` permission.
3. Submit the three templates below in **English (`en`)** and
   **Malay (`ms`)**, in the **Utility** category. Wait for approval.
4. Set these environment variables (server-only, never `NEXT_PUBLIC_`):

   | Variable | Value |
   |---|---|
   | `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID from the WhatsApp manager |
   | `WHATSAPP_ACCESS_TOKEN` | System User permanent token |
   | `WHATSAPP_APP_SECRET` | Meta app secret (webhook signature) |
   | `WHATSAPP_VERIFY_TOKEN` | Any long random string you choose |
   | `WHATSAPP_GRAPH_VERSION` | Optional, defaults to `v21.0` |
   | `WHATSAPP_TEMPLATE_BEFORE_DUE` / `_DUE_TODAY` / `_OVERDUE` | Optional overrides of template names |

5. In the Meta app's WhatsApp → Configuration, set:
   - the webhook URL to `https://app.collectboss.com/api/webhooks/whatsapp`,
   - the verify token to the value of `WHATSAPP_VERIFY_TOKEN`.

   Then subscribe to the `messages` field.
6. Apply `supabase/migrations/20260921_whatsapp_auto_reminders.sql`.

## Templates

Every template uses the same five body parameters:

| Parameter | Meaning |
|---|---|
| `{{1}}` | Customer name |
| `{{2}}` | Business name |
| `{{3}}` | Amount with currency, e.g. `MYR 1,500.00` |
| `{{4}}` | Due date, e.g. `01/10/2026` |
| `{{5}}` | Invoice reference |

### `payment_reminder_before_due`

**en**
> Hi {{1}}, this is a friendly reminder from {{2}}. Invoice {{5}} for {{3}} is due on {{4}}. If you have already paid, please ignore this message. Reply STOP to stop these reminders.

**ms**
> Hai {{1}}, ini peringatan mesra daripada {{2}}. Invois {{5}} berjumlah {{3}} perlu dibayar pada {{4}}. Jika anda sudah membuat bayaran, sila abaikan mesej ini. Balas BERHENTI untuk menghentikan peringatan.

### `payment_reminder_due_today`

**en**
> Hi {{1}}, invoice {{5}} from {{2}} for {{3}} is due today ({{4}}). Thank you for arranging payment. Reply STOP to stop these reminders.

**ms**
> Hai {{1}}, invois {{5}} daripada {{2}} berjumlah {{3}} perlu dibayar hari ini ({{4}}). Terima kasih kerana menguruskan bayaran. Balas BERHENTI untuk menghentikan peringatan.

### `payment_reminder_overdue`

**en**
> Hi {{1}}, our records show invoice {{5}} from {{2}} for {{3}} was due on {{4}} and is still outstanding. Please arrange payment or contact {{2}} if there is an issue. Reply STOP to stop these reminders.

**ms**
> Hai {{1}}, rekod kami menunjukkan invois {{5}} daripada {{2}} berjumlah {{3}} perlu dibayar pada {{4}} dan masih belum dijelaskan. Sila buat bayaran atau hubungi {{2}} jika ada sebarang isu. Balas BERHENTI untuk menghentikan peringatan.

## Notes

- The opt-out list is **global** per phone number, because all businesses share
  one sender number. Support can remove an entry on a customer's written
  request.
- Phone numbers are normalised to E.164. Local Malaysian numbers such as
  `012-345 6789` become `+60123456789`. Numbers that cannot be normalised are
  never queued.
- Reminders are only queued for invoices (obligations) linked to a customer
  with a phone number.
