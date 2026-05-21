import { PublicShell } from '@/components/brand/PublicShell';
import { PillLink } from '@/components/brand/PillButton';
import { EyebrowChip } from '@/components/brand/EyebrowChip';
import { WaveBackground } from '@/components/brand/WaveBackground';

export const metadata = {
  title: 'Pricing — Task Response',
  description: 'Simple, predictable pricing for AI inbox automation. 14-day free trial.',
};

const TIERS = [
  {
    name: 'Starter',
    price: '£99',
    period: '/month',
    description: 'For individuals and small teams getting started with AI inbox operations.',
    features: [
      '1 email account',
      'Up to 500 emails/month',
      'AI draft generation',
      'Basic category classification',
      'Email support',
    ],
    cta: 'Start free trial',
    ctaHref: '/connect?plan=starter&trial=true',
    trial: true,
    highlighted: false,
  },
  {
    name: 'Pro',
    price: '£299',
    period: '/month',
    description: 'For growing teams that need advanced automation and insights.',
    features: [
      'Up to 5 email accounts',
      'Unlimited emails/month',
      'AI draft generation + auto-send',
      'Full category classification',
      'Knowledge base extraction',
      'Audit log with CSV export',
      'Priority support',
    ],
    cta: 'Start free trial',
    ctaHref: '/connect?plan=pro&trial=true',
    trial: true,
    highlighted: true,
  },
  {
    name: 'Business',
    price: '£999+',
    period: '/month',
    description: 'For enterprises with custom requirements and dedicated support.',
    features: [
      'Unlimited email accounts',
      'Unlimited emails/month',
      'Everything in Pro',
      'Custom confidence thresholds',
      'Custom KB categories',
      'SSO / SAML',
      'Dedicated account manager',
      '99.99% SLA',
    ],
    cta: 'Contact sales',
    ctaHref: '/connect?plan=business',
    trial: false,
    highlighted: false,
  },
];

const TRIAL_STEPS = [
  {
    step: '01',
    title: 'Connect your inbox',
    body: 'Sign in with Google or Microsoft. No credit card required.',
  },
  {
    step: '02',
    title: 'AI starts learning',
    body: 'Task Response classifies your backlog and builds your knowledge base automatically.',
  },
  {
    step: '03',
    title: 'Review drafts, go live',
    body: 'Approve AI-generated replies. Upgrade when your 14-day trial ends — or cancel for free.',
  },
];

const TRIAL_FAQS = [
  {
    q: 'Do I need a credit card to start?',
    a: 'No. The 14-day free trial requires only a Google or Microsoft account. You add a payment method when you decide to upgrade.',
  },
  {
    q: 'What happens when the trial ends?',
    a: 'Your account pauses — no charges, no deletions. Log back in to choose a plan and pick up where you left off.',
  },
  {
    q: 'Can I switch plans during the trial?',
    a: 'Yes. You can change your trial plan at any time from Settings → Billing. The 14-day clock resets only on your first activation.',
  },
  {
    q: 'Is the full feature set available in the trial?',
    a: 'Starter and Pro trials give you the full feature set for that tier. Business trials are arranged separately via the sales team.',
  },
];

export default function PricingPage() {
  return (
    <PublicShell>
      <section className="relative overflow-hidden">
        <WaveBackground variant="top" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
          <EyebrowChip>14-day free trial · no card required</EyebrowChip>
          <h1 className="mt-6 font-display text-display text-ink">
            Simple{' '}
            <span className="font-serif italic text-brand-500">pricing.</span>
          </h1>
          <p className="mt-5 text-base text-muted">
            Pick a plan. Cancel anytime. Every plan includes the full Task
            Response pipeline — drafting, classification, auto-send.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-3xl p-8 transition-shadow ${
                tier.highlighted
                  ? 'bg-ink text-white shadow-card'
                  : 'bg-surface text-ink shadow-card hover:shadow-lg'
              }`}
            >
              {tier.highlighted && (
                <span className="absolute -top-3 left-8 rounded-pill bg-brand-500 px-3 py-1 text-xs font-medium text-white">
                  Most popular
                </span>
              )}
              {tier.trial && !tier.highlighted && (
                <span
                  className="absolute -top-3 right-8 rounded-pill border border-brand-500/30 bg-white px-3 py-1 text-xs font-medium text-brand-500"
                  aria-label="14-day free trial included"
                >
                  14-day free trial
                </span>
              )}
              <h2 className={`font-display text-title ${tier.highlighted ? 'text-white' : 'text-ink'}`}>
                {tier.name}
              </h2>
              <div className="mt-3 flex items-baseline gap-1">
                <span className={`font-display text-4xl font-medium ${tier.highlighted ? 'text-white' : 'text-ink'}`}>
                  {tier.price}
                </span>
                <span className={`text-sm ${tier.highlighted ? 'text-white/60' : 'text-muted'}`}>
                  {tier.period}
                </span>
              </div>
              {tier.trial && (
                <p className={`mt-1 text-xs font-medium ${tier.highlighted ? 'text-brand-400' : 'text-brand-500'}`}>
                  Includes 14-day free trial
                </p>
              )}
              <p className={`mt-3 text-sm ${tier.highlighted ? 'text-white/70' : 'text-muted'}`}>
                {tier.description}
              </p>
              <ul className="mt-6 mb-8 flex-1 space-y-3">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className={`flex items-start gap-2 text-sm ${tier.highlighted ? 'text-white/85' : 'text-muted'}`}
                  >
                    <span className="mt-1 block h-1.5 w-1.5 flex-none rounded-full bg-brand-500" />
                    {f}
                  </li>
                ))}
              </ul>
              <PillLink
                href={tier.ctaHref}
                variant={tier.highlighted ? 'primary' : 'tertiary'}
                className="w-full"
              >
                {tier.cta}
              </PillLink>
              {tier.trial && (
                <p className={`mt-3 text-center text-xs ${tier.highlighted ? 'text-white/50' : 'text-muted'}`}>
                  No credit card required
                </p>
              )}
            </div>
          ))}
        </div>

        {/* How the free trial works */}
        <div className="mt-20" id="free-trial">
          <div className="text-center">
            <EyebrowChip>Free trial</EyebrowChip>
            <h2 className="mt-4 font-display text-title text-ink">
              Up and running in{' '}
              <span className="font-serif italic text-brand-500">3 steps.</span>
            </h2>
            <p className="mt-3 text-sm text-muted">
              Your 14-day trial starts the moment you connect your inbox.
            </p>
          </div>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {TRIAL_STEPS.map((s) => (
              <div key={s.step} className="rounded-3xl bg-surface p-8">
                <span className="font-display text-4xl font-medium text-brand-500/30">
                  {s.step}
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-ink">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm text-muted">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <PillLink href="/connect?trial=true" variant="primary">
              Start your free trial
            </PillLink>
            <p className="mt-3 text-xs text-muted">No credit card required · Cancel anytime</p>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-20" id="trial-faq">
          <h2 className="font-display text-title text-ink">
            Free trial{' '}
            <span className="font-serif italic text-brand-500">FAQ.</span>
          </h2>
          <dl className="mt-8 divide-y divide-ink/5">
            {TRIAL_FAQS.map((faq) => (
              <div key={faq.q} className="py-6">
                <dt className="font-medium text-ink">{faq.q}</dt>
                <dd className="mt-2 text-sm text-muted">{faq.a}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-12 rounded-3xl bg-surface p-8 text-center">
          <h2 className="font-display text-title text-ink">Need something different?</h2>
          <p className="mt-2 text-sm text-muted">
            All plans include a 14-day free trial. No credit card required. Contact sales for custom enterprise pricing.
          </p>
          <div className="mt-5">
            <PillLink href="/connect?trial=true" variant="secondary">Start free trial</PillLink>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
