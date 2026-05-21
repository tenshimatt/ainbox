import { VoiceIdeas } from '@/components/ideas/VoiceIdeas';

export const dynamic = 'force-dynamic';

/**
 * /ideas — Voice-note feature ideas and share via iMessage (TASK7544-5).
 *
 * Server component shell; the client `<VoiceIdeas>` handles recording via
 * the Web Speech Recognition API, stores ideas in localStorage, and surfaces
 * an `sms:` deep-link for each idea so the user can send it via iMessage.
 */
export default function IdeasPage() {
  return (
    <main className="mx-auto w-full max-w-full px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">Feature Ideas</h1>
        <p className="mt-1 text-sm text-slate-600">
          Record a voice note or type a feature idea, then share it via iMessage.
        </p>
      </header>
      <VoiceIdeas />
    </main>
  );
}
