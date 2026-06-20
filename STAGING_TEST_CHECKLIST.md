# CollectBoss — Staging Test Checklist

**Version:** Step 20 (Production Release)
**Test environment:** Staging / Preview deployment on Vercel
**Supabase:** Staging project (separate from production)

---

## How to use this checklist

- Work through sections in order — each section builds on the previous.
- Mark each test: ✅ Pass | ❌ Fail | ⚠️ Partial | ⏭ Skipped
- Note failure details and screenshot when failing.
- Priority: 🔴 Critical | 🟡 High | 🟢 Medium | ⚪ Low

---

## Test Accounts to Create

| Account | Email | Role |
|---------|-------|------|
| Primary tester | tester1@collectboss.my | Business Owner |
| Cross-account tester | tester2@collectboss.my | Business Owner |
| Debtor (no account needed) | — | Uses /pay and /acknowledge links only |

---

## SECTION 1 — Authentication

### TC-001 — Register new account 🔴

**Steps:**
1. Open app in Incognito / Private window
2. Navigate to `/signup`
3. Enter email: `tester1@collectboss.my`, password: `Test1234!`
4. Click Sign Up
5. Check email for OTP (or Supabase Dashboard → Auth → Logs)
6. Enter the 6-digit OTP

**Expected result:**
- OTP email arrives within 30 seconds
- After OTP: redirected to `/onboarding/profile`
- NO mock demo data visible (Tan Wei Ming, CB-2024-xxxx) anywhere

---

### TC-002 — Complete business profile 🔴

**Steps (continuing from TC-001):**
1. At `/onboarding/profile`
2. Enter: Business Name = "Test Sdn Bhd", Reg No = "202301012345", Phone = "+60 12-345 6789"
3. Click Save

**Expected result:**
- Saves without error
- Redirected to `/` (dashboard)
- Dashboard shows user name / greeting
- Zero cases, zero balance (real empty state)

---

### TC-003 — Login existing account 🔴

**Steps:**
1. Logout (More → Logout)
2. Navigate to `/login`
3. Enter `tester1@collectboss.my` / `Test1234!`
4. Click Login

**Expected result:**
- Redirected to dashboard `/`
- Correct business data shown
- No 404 or error page

---

### TC-004 — Logout clears session 🔴

**Steps:**
1. While logged in, go to More (bottom nav on mobile, sidebar on desktop)
2. Click Logout

**Expected result:**
- Session cleared
- Redirected to `/login`
- Pressing Back does NOT return to a protected page

---

### TC-005 — Protected routes redirect unauthenticated users 🔴

**Steps:**
1. Ensure fully logged out
2. Navigate directly to `/cases`
3. Navigate directly to `/reports`
4. Navigate directly to `/payments`

**Expected result:**
- All three URLs redirect to `/login?redirect=...`
- Not-found page is NOT shown
- No crash or blank page

---

### TC-006 — Debtor public routes work without login 🔴

**Steps:**
1. Ensure fully logged out
2. Navigate to `/pay/[anyValidCaseId]`
3. Navigate to `/acknowledge/[anyValidCaseId]`
4. Navigate to `/forgot-password`

**Expected result:**
- All three load without any login redirect
- `/pay/[caseId]` shows debtor payment page with limited case info (NO bank details if locked)
- `/acknowledge/[caseId]` shows "No Active Plan" or plan confirmation page
- `/forgot-password` shows the password reset form

---

### TC-007 — Cross-account data isolation 🔴

**Steps:**
1. Logged in as tester1, create a case. Note its ID (e.g. `CB-2025-1234`)
2. Logout. Sign up as `tester2@collectboss.my`. Complete profile.
3. Navigate directly to `/cases/CB-2025-1234`

**Expected result:**
- tester2 CANNOT see tester1's case
- "Case not found" shown (not a crash)
- No data from tester1 visible to tester2

---

## SECTION 2 — Cases

### TC-010 — Create new case 🔴

**Steps:**
1. Logged in as tester1. Go to `/add`
2. Fill in:
   - Debtor Name: "Ahmad Sdn Bhd"
   - Amount Owed: 12500
   - Due Date: 30 days from today
   - Invoice No: "INV-2025-001"
   - Phone: "+60 12-999 0001"
3. Click Create Case

**Expected result:**
- Redirected to `/cases/[newId]?created=1`
- Green "Case created successfully!" banner shown briefly
- Case appears in `/cases` list
- Balance = RM 12,500.00 (full amount owed, no payments yet)

---

### TC-011 — Case detail shows correct fields 🟡

**Steps:**
1. Open the case created in TC-010
2. Review all displayed data

**Expected result:**
- Debtor: "Ahmad Sdn Bhd"
- Balance Due: RM 12,500.00
- Invoice No: INV-2025-001
- Status: Action Needed
- Days overdue: 0
- All sections visible: Overview, Payment History, Reminder History, sections for legal tools

---

### TC-012 — Change case status 🟡

**Steps:**
1. On case detail, click "Change Status"
2. Select "Payment Promise"

**Expected result:**
- Status badge updates to "Payment Promise"
- No page refresh needed (optimistic update)
- Audit log row created in Supabase `audit_logs` table

---

## SECTION 3 — Evidence Upload

### TC-020 — Upload valid evidence file 🔴

**Steps:**
1. From the case, go to `/evidence/[caseId]`
2. Select evidence type: "Invoice"
3. Upload a PDF file under 10 MB

**Expected result:**
- File uploads without error
- File listed with name, size, date
- Evidence checklist marks Invoice as ✅

---

### TC-021 — Reject invalid file type 🔴

**Steps:**
1. On evidence upload, attempt to attach a `.docx` or `.exe` file

**Expected result:**
- Error shown: file type not allowed
- File NOT uploaded
- No silent failure or crash

---

### TC-022 — Reject file over 10 MB 🔴

**Steps:**
1. Attempt to upload a file over 10 MB

**Expected result:**
- Error: "File is too large. Maximum size is 10 MB"
- File NOT uploaded

---

### TC-023 — Evidence files are private (storage security) 🔴

**Steps:**
1. Upload an evidence file as tester1
2. In browser DevTools (Network tab), copy the Supabase Storage URL of the uploaded file
3. Open that URL in an Incognito window (not logged in)

**Expected result:**
- 403 Forbidden OR 401 Unauthorized
- File NOT accessible without authentication
- Confirms the storage bucket is PRIVATE

---

### TC-024 — Evidence checklist completeness score 🟡

**Steps:**
1. Upload at least: Invoice, WhatsApp Screenshot, Payment Proof
2. Navigate to `/evidence/[caseId]/checklist`

**Expected result:**
- 3 "must-have" items show ✅
- Completeness score ≥ 50%
- No "missing must-have" warning for uploaded items
- "Fix →" links only shown for unuploaded items

---

## SECTION 4 — Reminders

### TC-030 — Generate and save reminder message 🟡

**Steps:**
1. Navigate to `/reminders/[caseId]`
2. Select reminder type: "Friendly"
3. Select channel: WhatsApp
4. Review the generated message (debtor name and amount should be filled)
5. Click Save

**Expected result:**
- Message generated with correct debtor name and balance
- Copy button works (clipboard receives text)
- Saved reminder appears in reminder history list

---

## SECTION 5 — Receiving Accounts

### TC-040 — Add receiving account 🔴

**Steps:**
1. Navigate to `/payments/account`
2. Click Add Account
3. Fill in: Bank = "Maybank", Holder = "Test Sdn Bhd", Account No = "1234567890", DuitNow = "+601234567890"
4. Save

**Expected result:**
- Account saved and visible in list
- "Primary" badge shown on first account

---

### TC-041 — Bank details hidden by default (Payment Lock) 🔴

**Steps:**
1. On the test case, ensure payment lock = "Approval" (default)
2. Open `/pay/[caseId]` in Incognito (debtor view)

**Expected result:**
- Bank account number NOT visible
- DuitNow QR NOT visible
- "Request Payment Details" button shown
- No financial details exposed

---

## SECTION 6 — Payment Lock & Access

### TC-050 — All three payment lock modes work 🔴

**Steps:**
1. On case, set Payment Lock to "Immediate" → open `/pay/[caseId]` → verify bank details ARE visible
2. Set Payment Lock to "Approval" → open `/pay/[caseId]` → verify bank details are NOT visible (Request button shown)
3. Set Payment Lock to "Manual" → open `/pay/[caseId]` → verify "contact creditor" message shown

**Expected result:**
- Immediate: full payment details visible
- Approval: locked, must request access
- Manual: locked, message about manual sharing

---

### TC-051 — Debtor requests payment access 🔴

**Steps:**
1. Set case payment lock to "Approval"
2. Open `/pay/[caseId]` in Incognito (debtor view)
3. Click "Request Payment Details"
4. Fill in: Name = "Ahmad bin Hassan", Phone = "+60 12-999 0001"
5. Submit

**Expected result:**
- "Request submitted" message shown
- Request appears in creditor's `/payments/requests`
- Status: Pending

---

### TC-052 — Creditor approves access (One-time) 🔴

**Steps:**
1. In creditor account, go to `/payments/requests`
2. Find the pending request
3. Click Approve → select "One-time access"

**Expected result:**
- Request status changes to "Approved"
- Debtor page `/pay/[caseId]` now shows bank details
- Audit log entry created

---

### TC-053 — Creditor approves access (24-hour) 🟡

**Steps:**
1. Reject existing request, have debtor submit again
2. Approve with "24-hour access"

**Expected result:**
- Bank details visible on debtor page
- Expiry timer shown (e.g. "Expires in 23h 59m")

---

### TC-054 — Expired access hides payment details 🔴

**Steps:**
1. Approve request with 24-hour access
2. Manually update `expires_at` in Supabase to a past time (e.g. 1 hour ago)
3. Refresh `/pay/[caseId]` debtor page

**Expected result:**
- "Your payment access has expired" message shown
- Bank details NOT visible
- "Submit New Request" button available

---

## SECTION 7 — Payment Proof

### TC-060 — Debtor submits payment proof 🔴

**Steps:**
1. Open `/pay/[caseId]` with approved access (bank details visible)
2. Scroll to "I've Made Payment" section
3. Enter: Amount = 2500, Method = Bank Transfer, Reference = "TXN123456"
4. Attach a screenshot image
5. Submit

**Expected result:**
- "Proof submitted for review" success message
- Proof status = "Pending Review"
- Case balance does NOT change yet (still RM 12,500.00)

---

### TC-061 — Balance NOT updated on proof submission 🔴

**Steps:**
1. Immediately after TC-060, open case detail

**Expected result:**
- Balance Due: RM 12,500.00 (unchanged)
- Amount Paid: RM 0.00 (unchanged)
- Proof visible with "Pending Review" label

---

### TC-062 — Balance updates after creditor approval 🔴

**Steps:**
1. In creditor account, find the pending proof on case detail or `/payments/requests`
2. Click Approve

**Expected result:**
- Payment status: "Approved" / "Verified"
- Balance Due: RM 10,000.00 (12,500 - 2,500)
- Amount Paid: RM 2,500.00
- Audit log entry: `payment.approved`

---

### TC-063 — Rejection does NOT change balance 🟡

**Steps:**
1. Have debtor submit another proof
2. Creditor clicks Reject

**Expected result:**
- Payment status: "Rejected"
- Balance Due: unchanged
- Amount Paid: unchanged

---

## SECTION 8 — Payment Plans

### TC-070 — Create payment plan 🔴

**Steps:**
1. Navigate to `/legal/[caseId]/plan`
2. Select 3 instalments
3. Set start date: 30 days from today
4. Add notes: "Agreed via phone call"
5. Click Create Payment Plan

**Expected result:**
- "Payment Plan Created!" success banner
- Schedule shows 3 monthly dates
- Each instalment = Total ÷ 3 (rounded up to 2dp)
- Next Best Action in case detail updates

---

### TC-071 — Debtor confirms payment plan 🔴

**Steps:**
1. Copy the `/acknowledge/[caseId]` link from success page
2. Open in Incognito (debtor view)
3. Review the plan schedule
4. Type full name in signature field
5. Check "I acknowledge this outstanding amount..."
6. Click Confirm Agreement

**Expected result:**
- "Acknowledgement Confirmed" success shown
- Plan status updates to "Debtor Confirmed"
- Payment reference code shown
- "Payment details may require creditor approval" message shown
- Audit log: `payment_plan.debtor_confirmed`

---

### TC-072 — Case detail shows active plan 🟡

**Steps:**
1. Return to case detail page

**Expected result:**
- Payment Plan section shows active plan with progress bar
- Next due date shown
- Status: "Debtor Confirmed" (green) or "Awaiting Confirmation" (amber)

---

## SECTION 9 — Debt Acknowledgement

### TC-080 — Creditor signs debt acknowledgement 🟡

**Steps:**
1. Navigate to `/legal/[caseId]/acknowledge`
2. Review the agreement document
3. Enter creditor name in signature field
4. Check the confirmation checkbox
5. Click Confirm & Save Acknowledgement

**Expected result:**
- "Acknowledgement Saved" confirmation screen
- Confirmed by + timestamp shown
- Debtor share link shown
- Audit log: `acknowledgement.signed`

---

## SECTION 10 — Evidence Pack

### TC-090 — Export evidence pack PDF 🔴

**Steps:**
1. Navigate to `/evidence/[caseId]/pack`
2. Review all preview sections (case summary, checklist, timeline)
3. Check evidence completeness score shown
4. Click "Export Evidence Pack as PDF"

**Expected result:**
- PDF generates and downloads: `evidence-pack-[caseId].pdf`
- PDF contains: CollectBoss wordmark, case summary, debtor details, checklist, disclaimer
- "Pack saved · Audit log created" banner shown
- Audit log: `evidence_pack.exported`

---

### TC-091 — PDF does NOT include bank account details 🔴

**Steps:**
1. Open the downloaded PDF from TC-090
2. Search for bank account number, DuitNow ID

**Expected result:**
- No bank account numbers in PDF
- No DuitNow QR codes in PDF
- Only case and evidence information

---

## SECTION 11 — Formal Demand

### TC-100 — Generate formal demand draft 🔴

**Steps:**
1. Navigate to `/legal/[caseId]/demand`
2. Select tone: "Friendly Formal"
3. Deadline: 14 days
4. Toggle "Include Payment Instructions" = ON
5. Toggle "Reference Evidence Pack" = ON
6. Review the draft preview

**Expected result:**
- Draft contains: debtor name, balance amount, invoice number, 14-day deadline date
- Bank account details appear in draft (payment instructions included)
- Evidence pack reference paragraph present
- Full legal disclaimer at bottom of draft

---

### TC-101 — No threatening or illegal language in any template 🔴

**Steps:**
1. Generate all 3 tone templates (Friendly, Strict, Final)
2. Read each draft carefully

**Expected result:**
- No mentions of: blacklist, CCRIS, CTOS, criminal charges
- No fake court references or court filing numbers
- No fake lawyer letterhead
- Each draft uses "legal review" language, not court-filing threats
- All 3 drafts end with the legal disclaimer

---

### TC-102 — Save demand draft 🟡

**Steps:**
1. Click "Save Draft"

**Expected result:**
- "Draft saved · Audit log created" message
- Draft appears in "Saved Drafts" list with title and date
- Record in Supabase `legal_documents` table

---

### TC-103 — Download demand PDF 🟡

**Steps:**
1. Click "Download as PDF"

**Expected result:**
- PDF downloads: `formal-demand-[caseId].pdf`
- Contains CollectBoss branding, demand text, disclaimer box
- No bank details if "Include Payment Instructions" toggle was OFF

---

## SECTION 12 — Lawyer Referral

### TC-110 — Case readiness checklist accurate 🟡

**Steps:**
1. Navigate to `/legal/[caseId]/lawyer` (Step 1)
2. Review the 8-item readiness checklist

**Expected result:**
- Items completed in prior tests show ✅ (invoice uploaded, contact available, etc.)
- Missing items show "Fix →" links to correct pages
- Readiness score (0–100) calculated correctly
- Level label: "Not Ready" / "Almost Ready" / "Ready" shown

---

### TC-111 — Legal partner selection shows placeholder warning 🟡

**Steps:**
1. Click "Select Legal Partner" (Step 2)
2. Review the 3 partner cards

**Expected result:**
- Amber warning: "Placeholder partners only. These are example listings."
- 3 partners shown with firm name, location, specialisation, response time
- Selecting a partner highlights it in green
- "Continue to Summary" activates

---

### TC-112 — Submit referral creates record 🟡

**Steps:**
1. On Step 3 (Summary):
   - Add notes: "Please review urgently"
   - Contact method: WhatsApp
   - Toggle evidence pack attachment = ON (if pack exists)
2. Click Submit Referral

**Expected result:**
- Step 4 (Confirmed) shown with referral ID
- Status: "Submitted"
- Audit log: `lawyer_referral.created`
- Case detail shows referral section with "Submitted" badge

---

## SECTION 13 — Small Claim Pack

### TC-120 — Amount ≤ RM 5,000 shows eligible banner 🟡

**Steps:**
1. Create a case with balance ≤ RM 5,000 (e.g. RM 3,200)
2. Navigate to `/legal/[caseId]/smallclaim`

**Expected result:**
- Green "Eligible for Small Claims Court" banner shown
- Balance and ≤ RM 5,000 confirmation visible

---

### TC-121 — Amount > RM 5,000 shows warning 🟡

**Steps:**
1. Open a case with balance > RM 5,000 (e.g. RM 12,500)
2. Navigate to `/legal/[caseId]/smallclaim`

**Expected result:**
- Amber "Amount Exceeds Small Claims Limit" warning
- "This case may not be suitable for small claim preparation. Consider legal review."
- "Refer to Lawyer Instead" button shown

---

### TC-122 — Readiness checklist and status 🟡

**Steps:**
1. On the small claim page, review the 9-item checklist

**Expected result:**
- Items completed in prior tests show ✅
- Missing items show "Fix →" links
- Score: Not Ready (<50%) / Almost Ready (50–79%) / Ready to Review (≥80%)
- Status chip colour matches: red / amber / green

---

### TC-123 — Save and download small claim pack 🟡

**Steps:**
1. Click "Save Small Claim Pack"
2. Click "Download as PDF"

**Expected result:**
- "Pack saved · Audit log created" shown
- PDF downloads: `small-claim-pack-[caseId].pdf`
- PDF contains checklist, case summary, next steps guide, disclaimer
- Disclaimer text: "does not submit any claim to court"
- Audit log: `small_claim_pack.generated`

---

## SECTION 14 — Reports & Analytics

### TC-130 — Reports page shows real data 🟡

**Steps:**
1. Navigate to `/reports`
2. Review all KPI cards and chart sections

**Expected result:**
- "Total to Collect" = sum of all case balances (verify manually)
- "Total Recovered" = sum of approved payments
- Cases by status bars reflect actual case statuses
- Overdue table shows real overdue cases (if any)
- NOT showing zeros or mock placeholder numbers

---

### TC-131 — Recovery rate calculation 🟡

**Steps:**
1. Note values: Total Amount Owed and Total Recovered from reports
2. Calculate: Rate = (Recovered ÷ Owed) × 100

**Expected result:**
- Displayed recovery rate matches manual calculation
- Progress bar width matches the percentage

---

## SECTION 15 — UI / UX

### TC-140 — Mobile layout (375px) 🔴

**Steps:**
1. Chrome DevTools → Device Toolbar → iPhone SE (375×667)
2. Navigate through: Dashboard, Cases, Case Detail, Evidence, Reminders, Payments, More

**Expected result:**
- No horizontal scroll on any page
- Bottom navigation visible and functional
- All buttons and links tappable (≥44px)
- Text readable, no overflow or clipping
- Cards do not overlap

---

### TC-141 — Desktop layout (1280px) 🔴

**Steps:**
1. Open at 1280px+ width
2. Navigate through all main pages

**Expected result:**
- Left sidebar visible (not bottom nav)
- Dashboard shows 4-column KPI cards
- Tables render properly
- No mobile-only elements visible at desktop

---

### TC-142 — Loading states shown 🟡

**Steps:**
1. Open DevTools → Network → Slow 3G
2. Navigate to case detail, cases list

**Expected result:**
- Loading spinner shown while data fetches
- No blank white page
- App does not crash during slow load

---

### TC-143 — Empty states are friendly 🟡

**Steps:**
1. Log in as tester2 (new account, no cases)
2. Check: Cases list, Reports, Payment history for a new case

**Expected result:**
- "No cases yet. Add your first case →" on /cases
- Reports shows zeros gracefully, no errors
- Payment history: "No payment records" (not blank)

---

### TC-144 — 404 page is branded 🟢

**Steps:**
1. Navigate to `/this-page-does-not-exist-abc123`

**Expected result:**
- Brand-styled 404 page: CollectBoss wordmark, navy/emerald colours
- "Go to Dashboard" button works
- NOT the default Next.js 404 page

---

### TC-145 — Invalid case ID shows graceful error 🟡

**Steps:**
1. Navigate to `/cases/INVALID-CASE-999`

**Expected result:**
- "Case not found" message
- Back link to `/cases`
- No JavaScript console errors or crashes

---

## SECTION 16 — Security Final Checks

### TC-150 — No credentials in browser source 🔴

**Steps:**
1. On any page: View Source (Ctrl+U)
2. Search for: "service_role", "eyJhbG" (JWT prefix in longer strings)

**Expected result:**
- Only the ANON key visible (safe — RLS protects it)
- Service role key NEVER appears in any client-side code
- No hardcoded bank account numbers

---

### TC-151 — Service role key not in JS bundle 🔴

**Steps:**
1. DevTools → Sources → Search in all files: "SERVICE_ROLE"

**Expected result:**
- Zero results found
- `SUPABASE_SERVICE_ROLE_KEY` exists only on the server, never in the browser

---

### TC-152 — Legal disclaimers on all legal pages 🔴

**Steps:**
Visit each page and confirm disclaimer text is present:
1. `/legal/[caseId]/demand`
2. `/legal/[caseId]/lawyer`
3. `/legal/[caseId]/smallclaim`
4. `/evidence/[caseId]/pack`
5. `/legal/[caseId]/acknowledge`
6. `/acknowledge/[caseId]` (debtor page)

**Expected result:**
- Every page contains: "This is not legal advice"
- Every page contains: "CollectBoss helps organize..."
- Disclaimer is visible (not hidden behind a scroll)

---

### TC-153 — No threatening language in any generated content 🔴

**Steps:**
1. Generate all 3 formal demand tones
2. View the generated payment plan agreement
3. View the lawyer referral confirmation

**Expected result:**
- NONE of these phrases appear anywhere:
  - "report you to CCRIS" / "CTOS"
  - "blacklist"
  - "criminal charges" / "police report"
  - Fake court case numbers or court stamps
  - Fake lawyer names or bar council numbers
- All generated text is professional and factual only

---

## SECTION 17 — Data Integrity

### TC-160 — Balance calculation accuracy 🔴

**Steps:**
1. Create case: Amount Owed = RM 10,000.00
2. Approve payment 1: RM 3,000.00
3. Approve payment 2: RM 2,000.00
4. Check case detail balance

**Expected result:**
- Amount Paid: RM 5,000.00
- Balance Due: RM 5,000.00
- Recovery progress: 50%
- No rounding errors

---

### TC-161 — Full payment sets balance to zero 🟡

**Steps:**
1. Approve final payment to cover remaining RM 5,000.00
2. Check case detail

**Expected result:**
- Balance Due: RM 0.00
- Amount Paid: RM 10,000.00
- Case can be set to "Paid" status
- No negative balance

---

## SECTION 18 — Audit Trail

### TC-170 — Audit log records all key actions 🟡

**Steps:**
1. In Supabase Dashboard → Table Editor → audit_logs
2. Verify rows exist for:

| Action | Expected |
|--------|----------|
| Create case | `case.created` |
| Approve payment | `payment.approved` |
| Create payment plan | `payment_plan.created` |
| Debtor confirms plan | `payment_plan.debtor_confirmed` |
| Export evidence pack | `evidence_pack.exported` |
| Save formal demand | `formal_demand.saved` |
| Submit lawyer referral | `lawyer_referral.created` |
| Generate small claim pack | `small_claim_pack.generated` |

**Expected result:**
- Each listed action has a row in audit_logs
- `business_id` matches tester1's business ID
- `case_id` matches the correct case
- `metadata` JSON contains relevant details
- `created_at` timestamp is recent and accurate

---

## Test Results Summary

| Section | TCs | Pass | Fail | Skip |
|---------|-----|------|------|------|
| 1 — Authentication | 7 | | | |
| 2 — Cases | 3 | | | |
| 3 — Evidence | 5 | | | |
| 4 — Reminders | 1 | | | |
| 5 — Receiving Accounts | 2 | | | |
| 6 — Payment Lock & Access | 5 | | | |
| 7 — Payment Proof | 4 | | | |
| 8 — Payment Plans | 3 | | | |
| 9 — Debt Acknowledgement | 1 | | | |
| 10 — Evidence Pack | 2 | | | |
| 11 — Formal Demand | 4 | | | |
| 12 — Lawyer Referral | 3 | | | |
| 13 — Small Claim Pack | 4 | | | |
| 14 — Reports | 2 | | | |
| 15 — UI / UX | 6 | | | |
| 16 — Security | 4 | | | |
| 17 — Data Integrity | 2 | | | |
| 18 — Audit Trail | 1 | | | |
| **TOTAL** | **69** | | | |

---

## Critical Blockers — Must ALL Pass Before Real Users

| TC | Description |
|----|-------------|
| TC-001 | Register new account |
| TC-002 | Complete business profile |
| TC-003 | Login works |
| TC-004 | Logout clears session |
| TC-005 | Protected routes redirect |
| TC-006 | Debtor public routes work |
| TC-007 | Cross-account data isolation |
| TC-010 | Create new case |
| TC-020 | Upload valid evidence |
| TC-021 | Reject invalid file type |
| TC-023 | Evidence files are private |
| TC-041 | Bank details hidden when locked |
| TC-050 | Payment lock modes work |
| TC-052 | Creditor approves access |
| TC-054 | Expired access hides details |
| TC-060 | Debtor submits proof |
| TC-061 | Balance NOT updated on submission |
| TC-062 | Balance updates on approval |
| TC-090 | Export evidence pack PDF |
| TC-091 | PDF has no bank details |
| TC-100 | Formal demand generates |
| TC-101 | No threatening language |
| TC-140 | Mobile layout works |
| TC-141 | Desktop layout works |
| TC-150 | No credentials in source |
| TC-151 | Service role key not in browser |
| TC-152 | Legal disclaimers present |
| TC-153 | No threatening language in content |
| TC-160 | Balance calculation accurate |

---

## Known Limitations (Not Bugs — Document for Users)

| Area | Limitation |
|------|-----------|
| OTP | No WhatsApp/SMS OTP yet — email OTP only via Supabase |
| Reminders | Generated text only — no auto-send to WhatsApp |
| Lawyer partners | Placeholder cards only — no real legal network integrated |
| Monthly chart | Uses estimated trend, not real date-based payment data |
| PWA icons | SVG placeholders — real 192px/512px PNGs needed before app store |
| E-signature | Typed name only — not a legally binding e-signature |
| Court filing | No actual court form submission — document prep only |
