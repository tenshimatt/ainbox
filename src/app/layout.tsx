import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Ainbox',
  description: 'AI inbox operations — Gmail / Outlook drafting + classification',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900">{children}</body>
    </html>
  );
}
