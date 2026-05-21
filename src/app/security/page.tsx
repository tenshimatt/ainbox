import { PublicShell } from '@/components/brand/PublicShell';
import { PillLink } from '@/components/brand/PillButton';
import { EyebrowChip } from '@/components/brand/EyebrowChip';
import { WaveBackground } from '@/components/brand/WaveBackground';

export const metadata = {
  title: 'Security & Compliance — Task Response',
  description: 'How Task Response protects your inbox data: encryption, tenant isolation, SOC 2, GDPR.',
};

const ITEMS = [
  { title: 'SOC 2 Type II', description: 'Annual SOC 2 Type II audits verify our controls for security, availability, and confidentiality.', status: 'Certified' },
  { title: 'GDPR Compliance', description: 'Your data is processed in accordance with EU data protection regulations.', status: 'Compliant' },
  { title: 'Data Encryption', description: 'AES-256 at rest, TLS 1.3 in transit. Email content uses per-row column-level encryption.', status: 'Active' },
  { title: 'OAuth 2.0 Authentication', description: 'All email provider connections use OAuth 2.0. We never store or have access to your email passwords.', status: 'Active' },
  { title: 'Token Security', description: 'OAuth refresh tokens are encrypted at rest and never leave our server-side edge functions.', status: 'Active' },
  { title: 'Email Content Protection', description: 'Email bodies are never logged in plaintext. Decrypted only in edge function memory during a single request.', status: 'Active' },
  { title: 'Tenant Isolation', description: 'Every database query filters by authenticated user ID. Row-Level Security is enforced on every table.', status: 'Active' },
  { title: 'Penetration Testing', description: 'Regular third-party penetration testing and vulnerability assessments against our infrastructure.', status: 'Quarterly' },
];

export default function SecurityPage() {
  return (
    <PublicShell>
      <section className="relative overflow-hidden">
        <WaveBackground variant="top" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
          <EyebrowChip>Security &amp; compliance</EyebrowChip>
          <h1 className="mt-6 font-display text-display text-ink">
            Your data,{' '}
            <span className="font-serif italic text-brand-500">guarded.</span>
          </h1>
          <p className="mt-5 text-base text-muted">
            Task Response is built for inboxes that matter — encrypted end-to-end, tenant-isolated, audited.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-12">
        <div className="grid gap-4">
          {ITEMS.map((item) => (
            <div key={item.title} className="rounded-3xl bg-surface p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-medium text-ink">{item.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{item.description}</p>
                </div>
                <span className="shrink-0 rounded-pill bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-600">
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="rounded-3xl bg-ink p-8 text-white">
          <h2 className="font-display text-title">Report a vulnerability</h2>
          <p className="mt-2 text-sm text-white/70">
            If you discover a security vulnerability, please report it to our security team. We follow a responsible disclosure policy.
          </p>
          <div className="mt-5">
            <PillLink href="mailto:security@taskresponse.com" variant="primary">
              security@taskresponse.com
            </PillLink>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
