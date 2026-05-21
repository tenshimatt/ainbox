import { PublicShell } from '@/components/brand/PublicShell';
import { EyebrowChip } from '@/components/brand/EyebrowChip';
import { WaveBackground } from '@/components/brand/WaveBackground';

export const metadata = { title: 'Privacy — Task Response' };

export default function Page() {
  return (
    <PublicShell>
      <section className="relative overflow-hidden">
        <WaveBackground variant="top" />
        <div className="relative z-10 mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
          <EyebrowChip>Legal</EyebrowChip>
          <h1 className="mt-6 font-display text-display text-ink">
            <span className="font-serif italic text-brand-500">Privacy</span>{' '}
            policy
          </h1>
          <p className="mt-5 text-base text-muted">Coming soon.</p>
        </div>
      </section>
    </PublicShell>
  );
}
