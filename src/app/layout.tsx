import './globals.css';
import type { Metadata } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// Inter Display isn't on Google Fonts; Inter at heavier optical sizing is the
// closest free substitute and matches the Fundely look at H1/H2 weights (500).
const interDisplay = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter-display',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['500'],
  style: ['italic'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Task Response — Your inbox, on autopilot',
  description: 'Smart inbox automation: classify, draft, and send safe replies on your Gmail or Microsoft 365 — you stay in control.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interDisplay.variable} ${playfair.variable}`}
    >
      <body className="min-h-screen bg-white text-ink font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
