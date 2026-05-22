import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Refund Policy — Based',
  description: 'Based Pro refund and cancellation policy.',
};

export default function RefundPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link href="/" className="legal-back">
          ← Based
        </Link>
        <h1 className="legal-title">Refund Policy</h1>
        <p className="legal-updated">Last updated: 22 May 2025</p>
      </header>

      <main className="legal-body">
        <section>
          <h2>Cancellation</h2>
          <p>
            Based Pro is a monthly subscription billed in advance. You can cancel at any time from
            your billing portal — just click &quot;Manage billing&quot; in Settings. Your Pro access
            continues until the end of the current billing period, and your card will not be charged
            again.
          </p>
          <p>
            Your projects remain accessible until the end of your billing period. There is no
            cancellation fee and no minimum commitment.
          </p>
        </section>

        <section>
          <h2>Refunds</h2>
          <p>
            If you are not happy, reach out at{' '}
            <a href="mailto:husgogogo@gmail.com" className="legal-link">
              husgogogo@gmail.com
            </a>{' '}
            and we will sort it out — no argument, no hoops. We&apos;d rather refund you than see a
            chargeback — it&apos;s faster for you too.
          </p>
          <p>
            If you were charged in error (duplicate charge, charge after cancellation, etc.), email
            us and we will issue a full refund immediately. As a general guide, we&apos;ll refund
            the most recent charge without question.
          </p>
        </section>

        <section>
          <h2>Disputes and Chargebacks</h2>
          <p>
            Before filing a dispute with your bank, please contact us first. Chargebacks take weeks
            to resolve and cost both sides. We will respond to refund requests within 1 business day
            and can issue a refund in minutes through Stripe.
          </p>
        </section>

        <section>
          <h2>Singapore Consumer Protection</h2>
          <p>
            Nothing in this policy limits your rights under the Singapore Consumer Protection (Fair
            Trading) Act or any other applicable law.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            <a href="mailto:husgogogo@gmail.com" className="legal-link">
              husgogogo@gmail.com
            </a>
          </p>
        </section>
      </main>

      <footer className="legal-footer">
        <Link href="/terms" className="legal-footer-link">
          Terms of Service
        </Link>
        <span className="legal-footer-sep">·</span>
        <Link href="/privacy" className="legal-footer-link">
          Privacy Policy
        </Link>
        <span className="legal-footer-sep">·</span>
        <Link href="/" className="legal-footer-link">
          Back to Based
        </Link>
      </footer>
    </div>
  );
}
