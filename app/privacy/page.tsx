import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Based',
  description: 'How Based collects, uses, and protects your data.',
};

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="legal-back">
          ← Based
        </Link>
        <h1 className="legal-title">Privacy Policy</h1>
        <p className="legal-updated">Last updated: 12 June 2026</p>
      </header>

      <main className="legal-body">
        <section>
          <h2>1. Who We Are</h2>
          <p>
            Based is operated by Mohamad Hus Alfyandi Bin Mohamed Tahir, based in Singapore. If you
            have any privacy questions, contact us at{' '}
            <a href="mailto:husgogogo@gmail.com" className="legal-link">
              husgogogo@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2>2. What Data We Collect</h2>
          <ul>
            <li>
              <strong>Account data:</strong> your email address and authentication provider (Google,
              GitHub, or email/password).
            </li>
            <li>
              <strong>Usage data:</strong> prompts you send, apps you generate, projects you save,
              and feature interactions. This is used to operate the service and improve it.
            </li>
            <li>
              <strong>Billing data:</strong> handled entirely by Stripe. We do not store your card
              number. We store a Stripe customer ID and subscription status.
            </li>
            <li>
              <strong>Analytics:</strong> anonymised usage events (page views, feature usage) via
              PostHog. No personally identifiable data is included in analytics events.
            </li>
            <li>
              <strong>Memory:</strong> if you opt in, Based stores a short summary of your
              preferences to personalise future sessions. You can clear this at any time from
              Settings.
            </li>
            <li>
              <strong>Device permissions (mobile &amp; desktop apps):</strong> with your explicit
              consent, Based may access your <strong>camera</strong> and <strong>microphone</strong>{' '}
              (for voice and vision features), your approximate <strong>location</strong> (to answer
              location-aware questions like weather), and your <strong>screen</strong> (only when
              you tap to share it, so the companion can see what you&apos;re looking at). Camera,
              microphone, and screen data are processed for the active request and are not recorded
              or stored by us. You can revoke any of these permissions in your device settings at
              any time.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. How We Use Your Data</h2>
          <ul>
            <li>To provide and operate the Based service</li>
            <li>To process payments and manage your subscription</li>
            <li>To send transactional emails (account verification, password reset)</li>
            <li>To improve Based — we may review aggregated usage patterns to guide development</li>
            <li>To respond to support requests</li>
          </ul>
          <p>
            <strong>We never sell your data. We never use it to train AI models.</strong>
          </p>
        </section>

        <section>
          <h2>4. Sub-Processors</h2>
          <p>
            Based relies on the following third-party services to operate. Each acts as a data
            processor under our instructions:
          </p>
          <table className="legal-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Purpose</th>
                <th>Data shared</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Anthropic</td>
                <td>AI generation (Claude)</td>
                <td>Prompts and conversation context</td>
              </tr>
              <tr>
                <td>Supabase</td>
                <td>Database and authentication</td>
                <td>Account data, projects, settings</td>
              </tr>
              <tr>
                <td>Stripe</td>
                <td>Payment processing</td>
                <td>Email, subscription status</td>
              </tr>
              <tr>
                <td>Vercel</td>
                <td>Hosting and infrastructure</td>
                <td>Request logs (IP, user agent)</td>
              </tr>
              <tr>
                <td>PostHog</td>
                <td>Product analytics</td>
                <td>Anonymised usage events</td>
              </tr>
              <tr>
                <td>Fal.ai</td>
                <td>Image and video generation</td>
                <td>Generation prompts</td>
              </tr>
              <tr>
                <td>Upstash Redis</td>
                <td>AI memory storage</td>
                <td>Memory summaries (if opted in)</td>
              </tr>
              <tr>
                <td>Google</td>
                <td>Google Calendar API</td>
                <td>Calendar events (only when you connect Google Calendar)</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>5. Data Retention &amp; Account Deletion</h2>
          <p>
            You can permanently delete your account at any time from{' '}
            <strong>Settings &rarr; Delete account</strong> inside the app. This immediately and
            irreversibly removes your account and associated data — projects, tasks, notes, memory,
            and settings.
          </p>
          <p>
            We retain your data for as long as your account is active. If you delete your account,
            we will delete your personal data within 30 days, except where we are required to retain
            it for legal or financial compliance purposes (e.g. Stripe transaction records). To
            request deletion without signing in, email{' '}
            <a href="mailto:husgogogo@gmail.com">husgogogo@gmail.com</a>.
          </p>
        </section>

        <section>
          <h2>6. Your Rights</h2>
          <p>Under the Singapore Personal Data Protection Act (PDPA), you have the right to:</p>
          <ul>
            <li>
              <strong>Access</strong> the personal data we hold about you
            </li>
            <li>
              <strong>Correct</strong> inaccurate data
            </li>
            <li>
              <strong>Withdraw consent</strong> for data collection at any time (note: withdrawing
              consent may prevent you from using the Service)
            </li>
            <li>
              <strong>Request deletion</strong> of your account and associated data
            </li>
          </ul>
          <p>
            To exercise any of these rights, email{' '}
            <a href="mailto:husgogogo@gmail.com" className="legal-link">
              husgogogo@gmail.com
            </a>
            . We will respond within 10 business days.
          </p>
        </section>

        <section>
          <h2>7. Cookies</h2>
          <p>
            Based uses essential cookies for authentication (Supabase session token) and anonymised
            analytics (PostHog). We do not use advertising or tracking cookies.
          </p>
        </section>

        <section>
          <h2>8. Children</h2>
          <p>
            Based is not intended for users under 13. We do not knowingly collect personal data from
            children. If you believe a child has created an account, contact us and we will delete
            it promptly.
          </p>
        </section>

        <section>
          <h2>9. Anthropic Data Handling</h2>
          <p>
            Your prompts are sent to Anthropic to generate responses. Anthropic processes them under
            their own{' '}
            <a
              href="https://www.anthropic.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="legal-link"
            >
              privacy policy
            </a>
            . We do not store raw prompt content beyond your active session.
          </p>
        </section>

        <section>
          <h2>10. Google Calendar Data</h2>
          <p>
            When you connect Google Calendar, Based accesses your calendar events solely to: check
            for scheduling conflicts before creating tasks, and create, update, or delete events on
            your behalf when you manage tasks through the companion.
          </p>
          <p>
            Based does not store your calendar event content beyond what is needed to complete the
            requested action. Calendar data is never used for advertising, never shared with third
            parties, and never used to train AI models.
          </p>
          <p>
            Based&rsquo;s use of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="legal-link"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>
            You can disconnect Google Calendar at any time from{' '}
            <strong>Settings → Google Calendar → Disconnect</strong>.
          </p>
        </section>

        <section>
          <h2>11. Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. Material changes will be communicated by
            email before they take effect.
          </p>
        </section>
      </main>

      <footer className="legal-footer">
        <Link href="/terms" className="legal-footer-link">
          Terms of Service
        </Link>
        <span className="legal-footer-sep">·</span>
        <Link href="/refund" className="legal-footer-link">
          Refund Policy
        </Link>
        <span className="legal-footer-sep">·</span>
        <Link href="/" className="legal-footer-link">
          Back to Based
        </Link>
      </footer>
    </div>
  );
}
