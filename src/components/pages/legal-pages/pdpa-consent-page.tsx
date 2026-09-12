import {
  LegalShell, LegalH2, LegalH3, LegalP, LegalUL, LegalWarning, LegalHighlight,
} from "./legal-shell";

export function PdpaConsentPage() {
  return (
    <LegalShell
      title="PDPA Consent Notice"
      subtitle="Personal Data Protection Notice under the Personal Data Protection Act 2010 (Malaysia)."
      lastUpdated="2026-09-01"
    >
      <LegalHighlight>
        This notice is issued pursuant to Section 7 of the Personal Data Protection Act 2010
        (Act 709) of Malaysia (&ldquo;PDPA 2010&rdquo;). Please read this notice carefully before
        registering for or using CollectBoss.
      </LegalHighlight>

      <LegalH2>1. Purpose of This Notice</LegalH2>
      <LegalP>
        This Personal Data Protection Notice (&ldquo;Notice&rdquo;) informs you of your rights as a data
        subject under the PDPA 2010 and explains how CollectBoss (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) collects,
        uses, discloses, and processes your personal data as required by Malaysian law.
      </LegalP>
      <LegalP>
        By registering for a CollectBoss account or continuing to use the platform, you
        acknowledge that you have read, understood, and consent to the collection and
        processing of your personal data as described in this Notice and our Privacy Policy.
      </LegalP>

      <LegalH2>2. Personal Data Collected</LegalH2>
      <LegalP>
        We collect the following categories of personal data from you:
      </LegalP>

      <LegalH3>2.1 User Personal Data</LegalH3>
      <LegalUL>
        <li>Full name and email address</li>
        <li>Business name, SSM registration number, and business address</li>
        <li>Phone number (if provided)</li>
        <li>Account credentials (password stored as a secure, irreversible hash)</li>
        <li>Subscription and billing information (managed via Stripe — we store only your Stripe Customer ID)</li>
        <li>Platform usage data and activity logs</li>
      </LegalUL>

      <LegalH3>2.2 Third-Party Personal Data (Debtor Data)</LegalH3>
      <LegalP>
        As a CollectBoss user, you may upload personal data of third parties (debtors) including:
      </LegalP>
      <LegalUL>
        <li>Full name and IC number (MyKad / NRIC)</li>
        <li>Contact information (phone, email, address)</li>
        <li>Financial information (debt amount, payment history, bank details)</li>
        <li>Supporting documents (invoices, agreements, correspondence)</li>
      </LegalUL>
      <LegalWarning>
        By uploading third-party personal data, you represent and warrant that:
        (a) you have a legitimate business purpose for processing such data as required by
        Section 6 of the PDPA 2010; (b) you have notified the relevant data subject that
        their data is being processed, or are otherwise lawfully authorised to do so; and
        (c) you will use such data only for lawful debt collection purposes. CollectBoss
        stores this data solely as your data processor.
      </LegalWarning>

      <LegalH2>3. Purposes of Processing</LegalH2>
      <LegalP>
        Your personal data is collected and processed for the following purposes:
      </LegalP>
      <LegalUL>
        <li>Creating and maintaining your CollectBoss account</li>
        <li>Delivering the debt management and documentation services you have subscribed to</li>
        <li>Processing subscription payments and managing your billing account</li>
        <li>Providing customer support and responding to your inquiries</li>
        <li>Improving the platform through aggregated and anonymised usage analytics</li>
        <li>Enforcing our Terms of Use and preventing fraudulent or illegal activity</li>
        <li>Complying with applicable Malaysian laws, regulations, and court orders</li>
        <li>Communicating important service updates, security notices, and account alerts</li>
      </LegalUL>

      <LegalH2>4. Disclosure of Personal Data</LegalH2>
      <LegalP>
        We do not sell your personal data. Your personal data may be disclosed to the
        following parties as necessary to provide the Service:
      </LegalP>
      <LegalUL>
        <li><strong>Supabase Pte Ltd</strong> — our cloud database and authentication provider. Data is stored
        on servers located in the region selected by CollectBoss at the time of your account creation.</li>
        <li><strong>Stripe, Inc.</strong> — our payment processing provider. Stripe processes payment data
        under their own Privacy Policy and PCI-DSS compliance standards.</li>
        <li><strong>Vercel, Inc.</strong> — our web hosting and content delivery provider.</li>
        <li><strong>Law enforcement and regulatory authorities</strong> — where required by law, court order,
        or to investigate suspected criminal activity.</li>
      </LegalUL>

      <LegalH2>5. Your Rights as a Data Subject</LegalH2>
      <LegalP>
        Under the PDPA 2010, you have the following rights in respect of your personal data:
      </LegalP>

      <LegalH3>5.1 Right of Access (Section 30, PDPA 2010)</LegalH3>
      <LegalP>
        You have the right to request access to personal data we hold about you and to be
        informed of the manner in which your personal data has been or is being used.
      </LegalP>

      <LegalH3>5.2 Right of Correction (Section 34, PDPA 2010)</LegalH3>
      <LegalP>
        You have the right to request correction of personal data that is inaccurate,
        incomplete, misleading, or outdated.
      </LegalP>

      <LegalH3>5.3 Right to Withdraw Consent (Section 38, PDPA 2010)</LegalH3>
      <LegalP>
        You have the right to withdraw your consent to processing of your personal data at
        any time. Please note that withdrawal of consent may result in our inability to
        continue providing the Service, and may require account closure.
      </LegalP>

      <LegalH3>5.4 Right to Prevent Processing for Direct Marketing (Section 43, PDPA 2010)</LegalH3>
      <LegalP>
        You have the right to request that we cease processing your personal data for
        direct marketing purposes. CollectBoss does not currently conduct direct marketing
        campaigns beyond essential service communications.
      </LegalP>

      <LegalH3>5.5 Right to Request Erasure</LegalH3>
      <LegalP>
        You may request deletion of your account and associated personal data. We will
        comply within a reasonable time, subject to our legal obligations to retain certain
        records (e.g. billing records for 7 years under Malaysian financial regulations).
      </LegalP>

      <LegalH2>6. How to Exercise Your Rights</LegalH2>
      <LegalP>
        To exercise any of the rights listed above, submit your request via the{" "}
        <a href="/support" className="text-[#009966] hover:underline font-semibold">
          Support page
        </a>.
        Please include:
      </LegalP>
      <LegalUL>
        <li>Your full name and registered email address</li>
        <li>A description of the right you wish to exercise</li>
        <li>Any relevant details to help us locate your data</li>
      </LegalUL>
      <LegalP>
        We will acknowledge your request within 7 business days and respond substantively
        within 21 days, in accordance with the PDPA 2010. Identity verification may be
        required before we process your request.
      </LegalP>

      <LegalH2>7. Cross-Border Data Transfer</LegalH2>
      <LegalP>
        Your personal data may be processed in countries outside Malaysia (including
        servers operated by Supabase, Stripe, and Vercel). Where data is transferred
        outside Malaysia, we take reasonable steps to ensure it receives equivalent
        protection as required by Section 129 of the PDPA 2010.
      </LegalP>

      <LegalH2>8. Data Retention</LegalH2>
      <LegalUL>
        <li>Account data: retained for the duration of your account and up to 12 months after closure</li>
        <li>Case data: retained while your account is active; deleted within 90 days upon verified account deletion request</li>
        <li>Billing records: retained for 7 years in compliance with Malaysian financial record-keeping requirements</li>
        <li>Security logs: retained for up to 90 days</li>
      </LegalUL>

      <LegalH2>9. Data Security</LegalH2>
      <LegalP>
        We implement commercially reasonable technical and organisational security measures,
        including TLS encryption in transit, hashed password storage, Row-Level Security
        database policies, and restricted server-side API key access. No system is completely
        immune from security incidents. In the event of a data breach affecting your personal
        data, we will notify you in accordance with our obligations under Malaysian law.
      </LegalP>

      <LegalH2>10. Consent</LegalH2>
      <LegalP>
        By creating a CollectBoss account, you confirm that you:
      </LegalP>
      <LegalUL>
        <li>Are at least 18 years of age</li>
        <li>Are authorised to act on behalf of the business entity registered on the platform</li>
        <li>Have read and understood this PDPA Consent Notice</li>
        <li>Consent to the collection, use, and processing of your personal data as described</li>
        <li>Understand that you may withdraw consent at any time via the Support page</li>
      </LegalUL>

      <LegalH2>11. Updates to This Notice</LegalH2>
      <LegalP>
        We may update this Notice from time to time. Material changes will be communicated
        via email or in-app notification. Continued use of the platform after the effective
        date of any changes constitutes acceptance of the revised Notice.
      </LegalP>

      <LegalH2>12. Contact</LegalH2>
      <LegalP>
        For all PDPA-related requests, queries, or complaints, contact us via the{" "}
        <a href="/support" className="text-[#009966] hover:underline font-semibold">
          Support page
        </a>.
      </LegalP>
    </LegalShell>
  );
}
