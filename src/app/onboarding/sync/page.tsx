/**
 * /onboarding/sync — replaced by /onboarding/wait (TASK7544-23).
 * This redirect preserves any existing bookmarks / links.
 */
import { redirect } from 'next/navigation';

export default function SyncRedirect() {
  redirect('/onboarding/wait');
}
