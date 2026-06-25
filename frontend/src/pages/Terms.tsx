import LegalLayout from '@/components/layout/LegalLayout';

export default function Terms() {
  return (
    <LegalLayout
      title="ZunoPilot Terms and Conditions"
      highlight="Terms"
      intro="These Terms and Conditions govern your access to and use of the websites, browser extensions, dashboards, APIs, and related services provided under the ZunoPilot brand, operated by mTouch Labs Private Limited."
      lastUpdated="[Insert Date]"
    >
      <p className="text-slate-700 leading-relaxed">
        These Terms and Conditions (“Terms”) govern your access to and use of the
        websites, browser extensions, dashboards, APIs, and related services provided
        under the ZunoPilot brand (collectively, the “Services”), operated by
        <b> mTouch Labs Private Limited</b>, a company incorporated under the laws of
        India (“mTouch Labs”, “ZunoPilot”, “we”, “our”, or “us”).
      </p>
      <p className="mt-3 text-slate-700 leading-relaxed">
        By creating an account, linking a WhatsApp Business Account, accessing the
        Services, or clicking “Accept” where prompted, you agree to be bound by these
        Terms. If you do not agree to these Terms, you must not access or use the
        Services.
      </p>

      <Section title="1. Acceptance of Terms">
        <p>
          We reserve the right to modify, update, or replace these Terms at any time.
          If we make material changes, we will provide at least fifteen (15) days'
          prior notice through the Services, email, or other reasonable means.
        </p>
        <p>
          Your continued use of the Services after the revised Terms become effective
          constitutes your acceptance of the updated Terms.
        </p>
      </Section>

      <Section title="2. Eligibility and Account Registration">
        <p>To use the Services, you must:</p>
        <Bullets items={[
          'Be at least eighteen (18) years of age and legally capable of entering into binding agreements;',
          'Provide accurate, current, and complete information during registration;',
          'Promptly update your account information when necessary;',
          'Maintain the confidentiality of your login credentials and access tokens; and',
          'Accept responsibility for all activities that occur under your account.',
        ]} />
        <p>You must immediately notify us of any unauthorized use of your account or security breach.</p>
      </Section>

      <Section title="3. WhatsApp Business API Compliance">
        <p>
          ZunoPilot provides tools and interfaces that integrate with Meta's WhatsApp
          Business Platform. By using these features, you agree that:
        </p>
        <Bullets items={[
          'You will comply with all applicable Meta WhatsApp Business Terms of Service, Commerce Policies, Developer Policies, and messaging guidelines;',
          'You are solely responsible for obtaining all legally required permissions, consents, and opt-ins from your customers before sending messages;',
          'You will maintain records demonstrating such consent where required by law;',
          'You will only use approved message templates and communication practices permitted by Meta and applicable laws; and',
          'You accept responsibility for any restrictions, suspensions, limitations, or termination of your WhatsApp Business Account imposed by Meta due to your conduct, policy violations, or customer complaints.',
        ]} />
        <p>
          ZunoPilot does not verify whether you have obtained customer consent and
          shall not be liable for claims arising from unauthorized messaging activities.
        </p>
      </Section>

      <Section title="4. Meta Disclaimer">
        <p>ZunoPilot is an independent software product operated by mTouch Labs Private Limited.</p>
        <p>ZunoPilot is not affiliated with, endorsed by, sponsored by, or administered by Meta Platforms, Inc.</p>
        <p>WhatsApp®, WhatsApp Business™, and related trademarks are the property of Meta Platforms, Inc.</p>
      </Section>

      <Section title="5. Prohibited Use">
        <p>You agree not to use the Services to:</p>
        <Bullets items={[
          'Send unsolicited messages, spam, or promotional communications without proper consent;',
          'Violate Meta policies or applicable laws;',
          'Transmit unlawful, harmful, threatening, defamatory, abusive, discriminatory, obscene, or fraudulent content;',
          'Engage in phishing, impersonation, deception, or identity misuse;',
          'Reverse engineer, decompile, copy, modify, or attempt to gain unauthorized access to the Services;',
          'Circumvent usage limits, security mechanisms, or rate limits;',
          'Probe, scan, or test vulnerabilities of our systems without authorization;',
          'Interfere with the operation or integrity of the Services; or',
          'Use the Services for activities involving illegal products, scams, or prohibited industries under Meta policies.',
        ]} />
      </Section>

      <Section title="6. Subscription, Billing, and Payments">
        <p>Certain features of the Services require payment of subscription fees. By subscribing, you agree that:</p>
        <Bullets items={[
          'Subscription fees are billed in advance on a monthly or annual basis, depending on your selected plan;',
          'You authorize us and our payment providers to charge the applicable fees using your designated payment method;',
          'Fees paid are non-refundable except where required by applicable law;',
          'Cancellations take effect at the end of the current billing cycle;',
          'No refunds or credits will be issued for partial subscription periods, unused Services, or downgrades; and',
          'We reserve the right to modify pricing upon reasonable prior notice.',
        ]} />
        <p>Failure to pay applicable fees may result in suspension or termination of access to paid features.</p>
      </Section>

      <Section title="7. Service Availability">
        <p>
          While we strive to provide reliable Services, we do not guarantee
          uninterrupted, timely, secure, or error-free operation. The Services may be
          affected by:
        </p>
        <Bullets items={[
          'Scheduled maintenance;',
          'Technical failures;',
          'Internet disruptions;',
          'Failures or downtime of third-party providers, including Meta;',
          'Security incidents; or',
          'Events beyond our reasonable control.',
        ]} />
        <p>We shall not be liable for any loss arising from such interruptions.</p>
      </Section>

      <Section title="8. Data Protection and Privacy">
        <p>
          Our collection and processing of personal information are governed by our{' '}
          <a href="/privacy" className="text-violet-600 font-medium underline">Privacy Policy</a>.
          By using the Services, you acknowledge and agree that:
        </p>
        <Bullets items={[
          'We may process personal data necessary to provide the Services;',
          'Customers remain responsible for determining the lawful basis for communications sent through the Services;',
          'Customers act as the primary controllers or fiduciaries of customer data; and',
          'ZunoPilot acts solely as a service provider or processor in accordance with applicable data protection laws.',
        ]} />
        <p>
          For customers subject to Indian law, customers remain the Data Fiduciaries
          under the Digital Personal Data Protection Act, 2023, while mTouch Labs acts
          as a Data Processor solely to the extent necessary to provide the Services.
        </p>
      </Section>

      <Section title="9. Intellectual Property">
        <p>
          All rights, title, and interest in the Services, including software, source
          code, designs, trademarks, branding, interfaces, documentation, workflows,
          and related intellectual property, are owned by or licensed to mTouch Labs
          Private Limited.
        </p>
        <p>
          These Terms grant you a limited, non-exclusive, non-transferable, and
          revocable right to use the Services solely in accordance with these Terms.
        </p>
        <p>
          You may not reproduce, distribute, modify, create derivative works from, or
          exploit any part of the Services without our prior written consent.
        </p>
      </Section>

      <Section title="10. Suspension and Termination">
        <p>
          We reserve the right to suspend, restrict, or terminate your access to the
          Services immediately, with or without notice, if:
        </p>
        <Bullets items={[
          'You violate these Terms;',
          'You violate Meta policies or applicable laws;',
          'You fail to pay applicable fees;',
          'Your activities expose us, Meta, other users, or third parties to legal, operational, or reputational risk; or',
          'We are required to do so by law or regulatory authorities.',
        ]} />
        <p>Termination of your account does not relieve you of outstanding payment obligations accrued before termination.</p>
      </Section>

      <Section title="11. Limitation of Liability">
        <p>
          To the maximum extent permitted by law, mTouch Labs Private Limited, its
          directors, officers, employees, affiliates, licensors, and partners shall
          not be liable for any indirect, incidental, special, consequential,
          exemplary, or punitive damages, including loss of profits, revenue,
          goodwill, business opportunities, data, or business interruption arising out
          of or relating to:
        </p>
        <Bullets items={[
          'Your access to or inability to access the Services;',
          'Any acts, omissions, outages, suspensions, or conduct of Meta or other third-party providers;',
          'Unauthorized access to your accounts, systems, databases, or access tokens;',
          'Errors, interruptions, or failures of the Services; or',
          'Your use of or reliance on the Services.',
        ]} />
        <p>
          To the extent permitted by applicable law, our total aggregate liability
          arising out of or relating to the Services shall not exceed the total
          subscription fees actually paid by you to mTouch Labs during the twelve (12)
          months immediately preceding the event giving rise to the claim.
        </p>
      </Section>

      <Section title="12. Indemnification">
        <p>
          You agree to defend, indemnify, and hold harmless mTouch Labs Private
          Limited and its directors, employees, affiliates, and partners from and
          against any claims, liabilities, damages, losses, penalties, fines, costs,
          and expenses (including reasonable legal fees) arising out of or related to:
        </p>
        <Bullets items={[
          'Your use of the Services;',
          'Your violation of these Terms;',
          'Your violation of Meta policies;',
          'Your failure to obtain required customer consent; or',
          'Your violation of applicable laws or third-party rights.',
        ]} />
      </Section>

      <Section title="13. Force Majeure">
        <p>
          mTouch Labs shall not be liable for any delay or failure in performance
          resulting from causes beyond its reasonable control, including acts of God,
          natural disasters, epidemics, cyberattacks, internet failures, governmental
          actions, labor disputes, utility interruptions, or failures of third-party
          service providers.
        </p>
      </Section>

      <Section title="14. Governing Law and Jurisdiction">
        <p>These Terms shall be governed by and construed in accordance with the laws of India.</p>
        <p>
          Any disputes arising out of or relating to these Terms or the Services shall
          be subject to the exclusive jurisdiction of the courts located in
          Hyderabad, Telangana, India.
        </p>
      </Section>

      <Section title="15. Severability">
        <p>
          If any provision of these Terms is held to be invalid, illegal, or
          unenforceable, the remaining provisions shall remain in full force and effect.
        </p>
      </Section>

      <Section title="16. Entire Agreement">
        <p>
          These Terms, together with our Privacy Policy and any other policies
          referenced herein, constitute the entire agreement between you and mTouch
          Labs Private Limited regarding the Services and supersede any prior
          agreements or understandings relating to the subject matter herein.
        </p>
      </Section>

      <Section title="17. Contact Information">
        <p>If you have any questions regarding these Terms, please contact:</p>
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 text-sm">
          <div className="font-semibold text-slate-900">mTouch Labs Private Limited</div>
          <div className="mt-1">
            Email:{' '}
            <a href="mailto:support@zunopilot.com" className="text-violet-600 font-medium underline">
              support@zunopilot.com
            </a>
          </div>
          <div>
            Website:{' '}
            <a href="https://www.zunopilot.com" className="text-violet-600 font-medium underline">
              https://www.zunopilot.com
            </a>
          </div>
        </div>
        <p className="mt-4 italic text-slate-600">
          By using ZunoPilot, you acknowledge that you have read, understood, and
          agree to be bound by these Terms and Conditions.
        </p>
      </Section>
    </LegalLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h2>
      <div className="mt-3 text-slate-700 leading-relaxed text-[15px] sm:text-base space-y-3">
        {children}
      </div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5">
      {items.map((t) => <li key={t}>{t}</li>)}
    </ul>
  );
}
