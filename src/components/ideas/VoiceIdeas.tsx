'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type IdeaEntry = {
  id: string;
  text: string;
  created_at: string;
};

function buildSmsLink(text: string): string {
  // sms: deep-link opens iMessage on iOS with pre-filled body
  return `sms:?body=${encodeURIComponent(`Feature idea: ${text}`)}`;
}

function genId(): string {
  return `idea-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const STORAGE_KEY = 'ainbox_voice_ideas';

function loadIdeas(): IdeaEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IdeaEntry[]) : [];
  } catch {
    return [];
  }
}

function saveIdeas(ideas: IdeaEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas));
  } catch {
    // storage quota exceeded — fail silently
  }
}

// Browser SpeechRecognition type shim
type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionInstance }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionInstance }).webkitSpeechRecognition ??
    null
  );
}

export function VoiceIdeas() {
  const [ideas, setIdeas] = useState<IdeaEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const recogRef = useRef<SpeechRecognitionInstance | null>(null);

  // Hydrate from localStorage once on mount
  useEffect(() => {
    setIdeas(loadIdeas());
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const startRecording = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) return;

    const recog = new SR();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = 'en-US';

    recog.onresult = (e) => {
      const transcript = Array.from(
        { length: (e.results as unknown as { length: number }).length },
        (_, i) => e.results[i][0].transcript,
      ).join(' ');
      setDraft((prev) => (prev ? `${prev} ${transcript}` : transcript).trim());
    };

    recog.onerror = () => setRecording(false);
    recog.onend = () => setRecording(false);

    recog.start();
    recogRef.current = recog;
    setRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    recogRef.current?.stop();
    recogRef.current = null;
    setRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recording, startRecording, stopRecording]);

  const saveIdea = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const entry: IdeaEntry = { id: genId(), text, created_at: new Date().toISOString() };
    setIdeas((prev) => {
      const next = [entry, ...prev];
      saveIdeas(next);
      return next;
    });
    setDraft('');
  }, [draft]);

  const deleteIdea = useCallback((id: string) => {
    setIdeas((prev) => {
      const next = prev.filter((i) => i.id !== id);
      saveIdeas(next);
      return next;
    });
  }, []);

  return (
    <div data-testid="voice-ideas-panel">
      {/* Voice capture card */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm text-slate-600">
          {supported
            ? 'Tap the mic to dictate your idea, then save or share via iMessage.'
            : 'Voice input is not supported in this browser. Type your idea below.'}
        </p>

        {/* Transcript textarea */}
        <textarea
          data-testid="idea-input"
          aria-label="Feature idea text"
          className="w-full resize-none rounded-md border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          rows={3}
          placeholder="Your feature idea…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Mic toggle — hidden if Speech API unavailable */}
          {supported && (
            <button
              data-testid="mic-button"
              aria-label={recording ? 'Stop recording' : 'Start voice recording'}
              onClick={toggleRecording}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                recording
                  ? 'animate-pulse bg-red-500 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <svg
                className="h-4 w-4"
                fill={recording ? 'currentColor' : 'none'}
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
                />
              </svg>
              {recording ? 'Stop' : 'Record'}
            </button>
          )}

          <button
            data-testid="save-idea-button"
            aria-label="Save idea"
            disabled={!draft.trim()}
            onClick={saveIdea}
            className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save idea
          </button>

          {draft.trim() && (
            <a
              data-testid="imessage-share-link"
              href={buildSmsLink(draft.trim())}
              aria-label="Share via iMessage"
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              {/* Apple Messages bubble icon */}
              <svg className="h-4 w-4 text-green-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
              </svg>
              Send via iMessage
            </a>
          )}
        </div>
      </div>

      {/* Saved ideas list */}
      {ideas.length > 0 && (
        <section aria-label="Saved ideas" className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Saved ideas ({ideas.length})
          </h2>
          <ul data-testid="ideas-list" className="flex flex-col gap-3">
            {ideas.map((idea) => (
              <li
                key={idea.id}
                data-idea-id={idea.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="text-sm text-slate-900">{idea.text}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                  <a
                    data-testid={`imessage-link-${idea.id}`}
                    href={buildSmsLink(idea.text)}
                    aria-label="Share via iMessage"
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <svg className="h-3.5 w-3.5 text-green-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z" />
                    </svg>
                    Send via iMessage
                  </a>
                  <button
                    data-testid={`delete-idea-${idea.id}`}
                    aria-label="Delete idea"
                    onClick={() => deleteIdea(idea.id)}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    Delete
                  </button>
                  <span className="ml-auto text-xs text-slate-400">
                    {new Date(idea.created_at).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ideas.length === 0 && (
        <div
          data-testid="ideas-empty-state"
          className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center"
        >
          <p className="text-sm text-slate-500">No ideas saved yet. Record or type your first one above.</p>
        </div>
      )}
    </div>
  );
}
