/**
 * Synthesised user fixtures for auth specs.
 *
 * Per factory-rules.md hard rule #8 and CLAUDE.md anti-pattern #3:
 * NO real-looking email addresses. We use the `@taskresponse.test` domain
 * which is reserved for synthesised test fixtures and bounced by
 * the pre-commit hook for any other content.
 */

export type SynthUser = {
  id: string;
  email: string;
  display: string;
};

export const SYNTH_USER_GOOGLE: SynthUser = {
  id: '00000000-0000-4000-8000-00000000ainb',
  email: 'alpha@taskresponse.test',
  display: 'Alpha Tester',
};

export const SYNTH_USER_DENIED: SynthUser = {
  id: '00000000-0000-4000-8000-00000000denx',
  email: 'denied@taskresponse.test',
  display: 'Denied Tester',
};
