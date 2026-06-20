import {
  LegalShell, LegalH2, LegalH3, LegalP, LegalUL, LegalWarning, LegalHighlight,
} from "./legal-shell";

export function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      subtitle="How CollectBoss collects, uses, and protects your personal data."
      lastUpdated="2025-01-01"
    >
      <LegalHighlight>
        This Privacy Policy is prepared in compliance with the Personal Data Protection Act
        2010 (PDPA 2010) of Malaysia. By using CollectBoss, you consent to the collection
        and processing of your personal data as described below.
      </LegalHighlight>

      <LegalH2>1. Data Controller</LegalH2>
      <LegalP>
        CollectBoss (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is the data controller responsible for personal data
        processed through this platform. We are committed to protecting the privacy and security
        of all personal data in accordance with the PDPA 2010 and applicable Malaysian law.
      </LegalP>
      <LegalP>
        For questions about how we handle your data, contact us via the{" "}
        <a href="/support" className="text-[#009966] hover:underline font-semibold">
          Support page
        </a>.
      </LegalP>

      <LegalH2>2. Personal Data We Collect</LegalH2>

      <LegalH3>2.1 Account Data</LegalH3>
      <LegalUL>
        <li>Full name and email address (used to create and manage your account)</li>
        <li>Business name, registration number (SSM), and business address</li>
        <li>Phone number (optional, for account recovery)</li>
        <li>Password (stored as a secure hash — we never store your plain-text password)</li>
      </LegalUL>

      <LegalH3>2.2 Case and Debtor Data</LegalH3>
      <LegalP>
        When you add debt collection cases to CollectBoss, you may upload personal data about
        third parties (debtors), including:
      </LegalP>
      <LegalUL>
        <li>Debtor name, IC number (MyKad / NRIC), and contact information</li>
        <li>Debt amount, due date, and invoice details</li>
        <li>Evidence files such as invoices, receipts, WhatsApp screenshots, agreements</li>
        <li>Notes and correspondence history</li>
      </LegalUL>
      <LegalWarning>
        You are responsible for ensuring you have a lawful basis under the PDPA 2010 to upload
        and process third-party personal data. CollectBoss stores this data as your data
        processor. Do not upload personal data you are not authorised to process.
      </LegalWarning>

      <LegalH3>2.3 Billing Data</LegalH3>
      <LegalP>
        We use Stripe as our payment processor. CollectBoss does not store your credit card
        number or full payment details. Stripe collects and retains payment information in
        accordance with their own Privacy Policy and PCI-DSS standards. We store only the
        Stripe Customer ID and subscription status.
      </LegalP>

      <LegalH3>2.4 Usage Data</LegalH3>
      <LegalUL>
        <li>Pages visited, features used, and actions taken within the platform</li>
        <li>Device type, browser, operating system, and IP address</li>
        <li>Error logs and crash reports for platform improvement</li>
      </LegalUL>

      <LegalH2>3. How We Use Your Personal Data</LegalH2>
      <LegalP>We process your personal data for the following purposes:</LegalP>
      <LegalUL>
        <li><strong>Service delivery</strong> — to operate, maintain, and improve the CollectBoss platform</li>
        <li><strong>Account management</strong> — to create, authenticate, and manage your account</li>
        <li><strong>Billing</strong> — to process subscription payments via Stripe</li>
        <li><strong>Support</strong> — to respond to your queries, bug reports, and feedback</li>
        <li><strong>Security</strong> — to detect, investigate, and prevent fraudulent or illegal activity</li>
        <li><strong>Legal compliance</strong> — to comply with applicable Malaysian law and court orders</li>
        <li><strong>Analytics</strong> — to understand how the platform is used and improve the product</li>
      </LegalUL>

      <LegalH2>4. Lawful Basis for Processing</LegalH2>
      <LegalP>We rely on the following lawful bases under the PDPA 2010:</LegalP>
      <LegalUL>
        <li><strong>Consent</strong> — you have given explicit consent by registering and accepting these terms</li>
        <li><strong>Contract performance</strong> — processing is necessary to deliver the service you subscribed to</li>
        <li><strong>Legitimate interest</strong> — platform security, fraud prevention, and product improvement</li>
        <li><strong>Legal obligation</strong> — compliance with Malaysian law, court orders, and regulatory requirements</li>
      </LegalUL>

      <LegalH2>5. Data Sharing and Disclosure</LegalH2>
      <LegalP>
        We do not sell your personal data. We share data only with trusted third-party
        service providers who are necessary to operate the platform:
      </LegalP>
      <LegalUL>
        <li><strong>Supabase</strong> — cloud database and authentication infrastructure (servers in supported regions)</li>
        <li><strong>Stripe</strong> — payment processing and billing management</li>
        <li><strong>Vercel</strong> — web hosting and serverless infrastructure</li>
      </LegalUL>
      <LegalP>
        All service providers are bound by data processing agreements and are required to
        protect your data in accordance with applicable law.
      </LegalP>
      <LegalP>
        We may disclose personal data to law enforcement or regulatory authorities if required
        by Malaysian law, court order, or to investigate suspected illegal activity.
      </LegalP>

      <LegalH2>6. Data Retention</LegalH2>
      <LegalUL>
        <li>Account data is retained for the duration of your subscription and up to 12 months after account closure</li>
        <li>Case and debtor data is retained as long as your account is active, and deleted within 90 days of account deletion upon request</li>
        <li>Billing records are retained for 7 years in accordance with Malaysian financial record-keeping requirements</li>
        <li>Usage logs are retained for up to 90 days for security and debugging purposes</li>
      </LegalUL>

      <LegalH2>7. Data Security</LegalH2>
      <LegalP>
        We implement appropriate technical and organisational security measures to protect
        your personal data against unauthorised access, disclosure, alteration, or destruction:
      </LegalP>
      <LegalUL>
        <li>All data is encrypted in transit using TLS 1.2 or higher</li>
        <li>Passwords are hashed using industry-standard bcrypt</li>
        <li>Database access is controlled by Row-Level Security (RLS) policies — each user can only access their own data</li>
        <li>File storage (evidence, payment proofs) is private and access-controlled</li>
        <li>Stripe API keys and service role secrets are never exposed to the browser</li>
      </LegalUL>
      <LegalP>
        No method of transmission or storage is 100% secure. If you discover a security
        vulnerability, please report it to us immediately via the Support page.
      </LegalP>

      <LegalH2>8. Your Rights Under the PDPA 2010</LegalH2>
      <LegalP>As a data subject under the PDPA 2010, you have the right to:</LegalP>
      <LegalUL>
        <li><strong>Access</strong> — request a copy of the personal data we hold about you</li>
        <li><strong>Correction</strong> — request correction of inaccurate or incomplete personal data</li>
        <li><strong>Withdraw consent</strong> — withdraw your consent to processing at any time (note: this may affect service delivery)</li>
        <li><strong>Erasure</strong> — request deletion of your account and personal data, subject to our retention obligations</li>
        <li><strong>Objection</strong> — object to certain types of processing, including direct marketing</li>
      </LegalUL>
      <LegalP>
        To exercise any of these rights, contact us via the{" "}
        <a href="/support" className="text-[#009966] hover:underline font-semibold">Support page</a>.
        We will respond within 21 days in accordance with the PDPA 2010.
      </LegalP>

      <LegalH2>9. Cookies</LegalH2>
      <LegalP>
        CollectBoss uses essential cookies and session tokens to maintain your login state.
        We do not use tracking cookies or third-party advertising cookies. You may disable
        cookies in your browser settings, but this will prevent you from logging in.
      </LegalP>

      <LegalH2>10. Third-Party Links</LegalH2>
      <LegalP>
        The platform may contain links to external websites (e.g. Stripe, Malaysian court
        portals). We are not responsible for the privacy practices of third-party websites.
        We encourage you to review the privacy policies of any external sites you visit.
      </LegalP>

      <LegalH2>11. Changes to This Policy</LegalH2>
      <LegalP>
        We may update this Privacy Policy from time to time. Material changes will be
        notified via email or an in-app notice. Continued use of CollectBoss after changes
        take effect constitutes your acceptance of the revised policy.
      </LegalP>

      <LegalH2>12. Contact</LegalH2>
      <LegalP>
        For privacy-related requests or questions, contact us via the{" "}
        <a href="/support" className="text-[#009966] hover:underline font-semibold">
          Support page
        </a>.
      </LegalP>
    </LegalShell>
  );
}
