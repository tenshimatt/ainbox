import Link from 'next/link';

const COMPLIANCE_ITEMS = [
  {
    title: 'SOC 2 Type II',
    description: 'Ainbox undergoes annual SOC 2 Type II audits, verifying our controls for security, availability, and confidentiality.',
    status: 'Certified',
    statusColor: 'text-green-600',
  },
  {
    title: 'GDPR Compliance',
    description: 'Full compliance with GDPR requirements. Your data is processed in accordance with EU data protection regulations.',
    status: 'Compliant',
    statusColor: 'text-green-600',
  },
  {
    title: 'Data Encryption',
    description: 'All data is encrypted at rest using AES-256 and in transit using TLS 1.3. Email content is encrypted with per-row column-level encryption.',
    status: 'Active',
    statusColor: 'text-green-600',
  },
  {
    title: 'OAuth 2.0 Authentication',
    description: 'All email provider connections use OAuth 2.0. We never store or have access to your email passwords.',
    status: 'Active',
    statusColor: 'text-green-600',
  },
  {
    title: 'Token Security',
    description: 'OAuth refresh tokens are encrypted at rest and never leave our server-side edge functions. No tokens are exposed to client-side JavaScript.',
    status: 'Active',
    statusColor: 'text-green-600',
  },
  {
    title: 'Email Content Protection',
    description: 'Email bodies are never logged in plaintext. All observability output has redacted content. Data is decrypted only in edge function memory during a single request.',
    status: 'Active',
    statusColor: 'text-green-600',
  },
  {
    title: 'Tenant Isolation',
    description: 'Every database query filters by authenticated user ID. Row-Level Security (RLS) is enforced on every table. No cross-tenant data flow is possible.',
    status: 'Active',
    statusColor: 'text-green-600',
  },
  {
    title: 'Penetration Testing',
    description: 'Regular third-party penetration testing and vulnerability assessments are conducted against our infrastructure.',
    status: 'Quarterly',
    statusColor: 'text-blue-600',
  },
];

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Security & Compliance</h1>
          <p className="mt-3 text-lg text-slate-500">
            Your data security is our top priority
          </p>
        </div>

        <div className="mt-10 grid gap-4">
          {COMPLIANCE_ITEMS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-900">{item.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                </div>
                <span className={`shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium ${item.statusColor}`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Report a Vulnerability</h2>
          <p className="mt-1 text-sm text-slate-500">
            If you discover a security vulnerability, please report it to our security team immediately. We follow a responsible disclosure policy.
          </p>
          <Link
            href="mailto:security@ainbox.app"
            className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            security@ainbox.app
          </Link>
        </div>
      </div>
    </main>
  );
}
