import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Based',
  description: 'Terms of Service for Based, the AI dev studio.',
};

export default function TermsPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="legal-back">
          ← Based
        </Link>
        <h1 className="legal-title">Terms of Service</h1>
        <p className="legal-updated">Last updated: 22 May 2025</p>
      </header>

      <main className="legal-body">
        <section>
          <h2>1. What Based Is</h2>
          <p>
            Based (&quot;the Service&quot;) is an AI-powered app builder that generates HTML, CSS,
            and JavaScript from natural language prompts. It&apos;s a creative tool — not a
            professional service, and not a substitute for a developer. Outputs are AI-generated and
            may be inaccurate, incomplete, or unsuitable for production use without review. You are
            responsible for everything you build with it.
          </p>
        </section>

        <section>
          <h2>2. Who Can Use Based</h2>
          <p>
            You must be at least 13 years old to use Based. By creating an account you confirm you
            meet this requirement and have the authority to accept these terms.
          </p>
        </section>

        <section>
          <h2>3. Your Account</h2>
          <p>
            You are responsible for keeping your credentials secure. You are accountable for all
            activity that occurs under your account. Notify us immediately at{' '}
            <a href="mailto:husgogogo@gmail.com">husgogogo@gmail.com</a> if you suspect unauthorised
            access.
          </p>
        </section>

        <section>
          <h2>4. Acceptable Use</h2>
          <p>You must not use Based to:</p>
          <ul>
            <li>Generate illegal, harmful, or abusive content</li>
            <li>
              Abuse the platform to bypass generation limits, including via automation or scripting
            </li>
            <li>Attempt to reverse-engineer, copy, or resell the platform itself</li>
            <li>Violate the rights of any third party</li>
          </ul>
          <p>
            We reserve the right to suspend or terminate accounts that violate these rules without
            notice. In rare cases we may also discontinue the service entirely — if that happens, we
            will give reasonable notice and pro-rate any unused subscription time.
          </p>
        </section>

        <section>
          <h2>5. Intellectual Property</h2>
          <p>
            <strong>Your outputs:</strong> You own everything you generate using Based. We claim no
            rights over the apps, code, or content you produce.
          </p>
          <p>
            <strong>The platform:</strong> Based, its design, codebase, and underlying systems
            remain the intellectual property of Mohamad Hus Alfyandi Bin Mohamed Tahir. You may not
            copy, reproduce, or redistribute them.
          </p>
        </section>

        <section>
          <h2>6. Subscriptions and Billing</h2>
          <p>
            Based Pro is a monthly subscription billed in advance via Stripe. Your subscription
            renews automatically until you cancel. Cancellation takes effect at the end of the
            current billing period — you retain Pro access until then.
          </p>
          <p>
            For refunds and cancellations, see our{' '}
            <Link href="/refund" className="legal-link">
              Refund Policy
            </Link>
            .
          </p>
        </section>

        <section>
          <h2>7. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Based&apos;s total liability to you for any
            claim arising out of or related to the Service is limited to the amounts you paid in the
            three months preceding the claim. We are not liable for any indirect, consequential,
            incidental, or punitive losses, including loss of data, loss of revenue, or loss of
            business opportunity.
          </p>
          <p>
            The Service is provided &quot;as is.&quot; We make no warranties, express or implied,
            regarding uptime, accuracy of AI outputs, or fitness for any particular purpose.
          </p>
        </section>

        <section>
          <h2>8. Governing Law</h2>
          <p>
            These terms are governed by the laws of Singapore. Any dispute arising out of or in
            connection with these terms shall be subject to the exclusive jurisdiction of the courts
            of Singapore.
          </p>
        </section>

        <section>
          <h2>9. Changes to These Terms</h2>
          <p>
            We may update these terms from time to time. If you keep using Based after changes take
            effect, we&apos;ll take that as acceptance. If you disagree with a change, you can
            cancel before it kicks in.
          </p>
        </section>

        <section>
          <h2>10. Contact</h2>
          <p>
            Questions about these terms?{' '}
            <a href="mailto:husgogogo@gmail.com" className="legal-link">
              husgogogo@gmail.com
            </a>
          </p>
        </section>
      </main>

      <footer className="legal-footer">
        <Link href="/privacy" className="legal-footer-link">
          Privacy Policy
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
