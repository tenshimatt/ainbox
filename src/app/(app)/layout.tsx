/**
 * (app) route group layout — wraps all authenticated pages in AppLayout
 * (nav rail + topbar). URLs don't change because parentheses are stripped
 * from the route.
 */
import AppLayout from '@/components/AppLayout';

export default function AuthenticatedAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppLayout>{children}</AppLayout>;
}
