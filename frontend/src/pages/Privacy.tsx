import LegalLayout from '@/components/layout/LegalLayout';

export default function Privacy() {
  return (
    <LegalLayout
      title="Privacy Policy"
      highlight="Privacy"
      intro={`This Privacy Policy explains how ZunoPilot, operated by mTouch Labs Private Limited, collects, uses, discloses, and protects your information when you use our WhatsApp Business platform, dashboards, and associated services.`}
      lastUpdated="10-05-2026"
    >
      <p className="text-slate-700 leading-relaxed">
        This Privacy Policy explains how ZunoPilot, operated by <b>mTouch Labs Private Limited</b> ("mTouch Labs", "ZunoPilot", "we", "us", or "our"), collects, uses, discloses, and protects your information when you use our WhatsApp Business platform, dashboards, and associated services (collectively, the "Services").
      </p>
      <p className="mt-3 text-slate-700 leading-relaxed">
        By accessing or using our Services, you consent to the collection, transfer, manipulation, storage, disclosure, and other uses of your information as described in this Privacy Policy.
      </p>

      <Section title="1. Information We Collect">
        <p>
          We collect information you provide directly to us when creating a business
          account, configuring integration profiles, or contacting support:
        </p>
        <Bullets items={[
          ['Account Credentials', 'Full name, email address, password hashes, and company details.'],
          ['WhatsApp Metadata', 'WhatsApp Business Account (WABA) IDs, Phone Number IDs, and Meta Access Tokens.'],
          ['Business Content', 'Menu items, prices, descriptions, salon service catalogs, business categories, and order metadata.'],
        ]} />
      </Section>

      <Section title="2. How We Use Information">
        <p>
          We process your data to fulfill our commitments and provide the core
          ZunoPilot features:
        </p>
        <Bullets items={[
          'To synchronize and route WhatsApp messages to your shared team inbox.',
          'To trigger automated order confirmations, status updates (accepted, out for delivery), and cancellations.',
          'To compile business analytics, conversation count trends, and response rate metrics.',
          'To secure user sessions and verify account access.',
        ]} />
      </Section>

      <Section title="3. WhatsApp Data & Privacy">
        <p>
          ZunoPilot connects directly to Meta's WhatsApp Cloud API. Because your
          customer conversations route through our databases:
        </p>
        <Bullets items={[
          ['Message Logs', 'We store WhatsApp message content (text, image links, order state) to display them inside your Shared Inbox. We do not inspect message contents for advertisement targetings.'],
          ['Meta Guidelines', 'You must comply with WhatsApp Business Terms and policies. You are solely responsible for obtaining the appropriate opt-in consents from your customers before sending them automated status notifications.'],
        ]} />
      </Section>

      <Section title="4. Sharing Your Information">
        <p>
          We do not sell, rent, or trade your personal or business data to third-party
          advertisers. We only share information with:
        </p>
        <Bullets items={[
          ['Service Providers', 'Secure hosting environments (Postgres instances, server infrastructures) acting strictly on our instructions.'],
          ['Meta Platforms, Inc', 'Access tokens and payload details sent to the WhatsApp API endpoints to transmit messages.'],
          ['Legal Requirements', 'If required to do so by law, court orders, or regulations.'],
        ]} />
      </Section>

      <Section title="5. Security of Your Data">
        <p>
          We employ industry-standard physical, technical, and administrative
          measures to secure your credentials, passwords, and Meta developer access
          tokens. Your tokens are encrypted at rest. However, no internet
          transmission is 100% secure, and we cannot guarantee absolute security.
        </p>
      </Section>

      <Section title="6. Your Privacy Rights">
        <p>
          Depending on your location, you may have rights under GDPR, CCPA, or local
          laws to access, correct, delete, or limit the processing of your data. To
          exercise these rights (e.g. request complete account deletion), contact us
          via the information below.
        </p>
      </Section>

      <Section title="7. Contact Information">
        <p>
          For questions, clarifications, or requests regarding this Privacy Policy,
          please reach out to:
        </p>
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-4 text-sm">
          <div className="font-semibold text-slate-900">ZunoPilot Privacy Team</div>
          <div className="mt-1">
            Email:{' '}
            <a href="mailto:privacy@zunopilot.com" className="text-violet-600 font-medium underline">
              privacy@zunopilot.com
            </a>
          </div>
        </div>
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

/**
 * Renders a bulleted list. Each item is either a plain string or a [label, description]
 * tuple — the tuple renders the label in bold followed by an em dash and the description.
 */
function Bullets({ items }: { items: (string | [string, string])[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5">
      {items.map((it, i) =>
        Array.isArray(it) ? (
          <li key={i}>
            <b>{it[0]}:</b> {it[1]}
          </li>
        ) : (
          <li key={i}>{it}</li>
        )
      )}
    </ul>
  );
}
