/**
 * TASKRESPONSE-46 / Personalization L4 — Skills library.
 *
 * A skill is a user-toggleable writing behaviour that gets injected as an
 * instruction clause into the draft system prompt when enabled.
 *
 * Skill IDs are stable — they are stored as-is in `user_skills.skill_id`.
 * Adding a new skill is non-breaking (old rows are simply absent → disabled).
 * Removing a skill id causes its rows to be ignored at query time.
 */

export interface Skill {
  id: string;
  label: string;
  description: string;
  /** Appended to the draft system prompt when the skill is enabled. */
  prompt_instruction: string;
}

export const SKILLS_LIBRARY: readonly Skill[] = [
  {
    id: 'formal_tone',
    label: 'Formal tone',
    description: 'Use professional, formal language in all replies',
    prompt_instruction:
      'Use formal language throughout. Greet with "Dear [Name]" and close with "Kind regards" or "Sincerely".',
  },
  {
    id: 'concise_replies',
    label: 'Concise replies',
    description: 'Keep every reply to 2–3 sentences maximum',
    prompt_instruction:
      'Keep the reply to 2-3 sentences maximum. Cut every filler phrase.',
  },
  {
    id: 'bullet_structure',
    label: 'Bullet-point structure',
    description: 'Use bullet points whenever the reply covers multiple items',
    prompt_instruction:
      'When addressing more than one point, use a short bulleted list rather than run-on sentences.',
  },
  {
    id: 'empathy_opening',
    label: 'Empathy opening',
    description: 'Start with a brief empathetic acknowledgement before answering',
    prompt_instruction:
      'Open with a brief empathetic acknowledgement (e.g. "Thanks for reaching out — ") before the substance.',
  },
  {
    id: 'next_step_close',
    label: 'Next-step closing',
    description: 'Always end with a clear next step or call to action',
    prompt_instruction:
      "Always close with one clear next step or call to action (e.g. \"Let me know if [X]\" or \"I'll follow up by [date]\").",
  },
  {
    id: 'no_sign_off',
    label: 'Skip sign-off',
    description: 'Omit the closing signature line from every reply',
    prompt_instruction:
      'Do not include any closing salutation or signature line — end at the last substantive sentence.',
  },
] as const;

/** Stable set of all valid skill ids. Used for input validation. */
export const SKILL_IDS: readonly string[] = SKILLS_LIBRARY.map((s) => s.id);

/**
 * Build the skills instruction block to inject into the draft system prompt.
 *
 * Pure function — easy to test without any I/O.
 * Returns an empty string when no skills are enabled so the caller can
 * concatenate unconditionally.
 */
export function buildSkillsBlock(enabledSkillIds: string[]): string {
  if (enabledSkillIds.length === 0) return '';

  const instructions = enabledSkillIds
    .map((id) => SKILLS_LIBRARY.find((s) => s.id === id)?.prompt_instruction)
    .filter((i): i is string => typeof i === 'string' && i.length > 0);

  if (instructions.length === 0) return '';

  return (
    '\n\nWriting style rules the user has enabled — follow these strictly:\n' +
    instructions.map((i) => `- ${i}`).join('\n')
  );
}
