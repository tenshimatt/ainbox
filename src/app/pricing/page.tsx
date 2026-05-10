import Link from 'next/link';

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
    cta: 'Get started',
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
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Pricing</h1>
          <p className="mt-3 text-lg text-slate-500">
            Choose the plan that fits your team&apos;s needs
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${
                tier.highlighted
                  ? 'border-slate-900 ring-2 ring-slate-900'
                  : 'border-slate-200'
              }`}
            >
              {tier.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-slate-900">{tier.name}</h2>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight text-slate-900">{tier.price}</span>
                  <span className="text-sm text-slate-500">{tier.period}</span>
                </div>
                <p className="mt-2 text-sm text-slate-500">{tier.description}</p>
              </div>
              <ul className="mb-6 flex-1 space-y-3">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                    <span className="mt-0.5 shrink-0 text-green-500">✓</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/connect"
                className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-medium transition-colors ${
                  tier.highlighted
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Need something different?</h2>
          <p className="mt-1 text-sm text-slate-500">
            All plans include a 14-day free trial. No credit card required. Contact our sales team for custom enterprise pricing.
          </p>
          <Link
            href="/connect"
            className="mt-4 inline-block rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Start free trial
          </Link>
        </div>
      </div>
    </main>
  );
}
