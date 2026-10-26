import type { Metadata, Viewport } from 'next';
import { Baloo_2, Nunito } from 'next/font/google';
import { MotionProvider } from '@/components/motion-provider';
import './globals.css';

/*
 * Fonts are fetched at build time and self-hosted from our own origin, so the
 * running app makes no third-party request and there is no layout shift while
 * a webfont loads.
 *
 * Baloo 2 carries the personality — rounded terminals, very heavy top weight,
 * the kind of type that reads as "game" from the back of a room. Nunito does
 * the reading work: same rounded family feel, far more legible at small sizes
 * on a phone.
 */
const display = Baloo_2({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-baloo',
  display: 'swap',
});

const body = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Feyi — Learning, but make it a game',
  description:
    'Create live quiz games, host them on any screen, and let players join from their phones with a PIN.',
};

export const viewport: Viewport = {
  themeColor: '#46178f',
  width: 'device-width',
  initialScale: 1,
  // Player screens are full-height layouts with large tap targets; letting the
  // browser zoom on double-tap breaks them mid-question.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-full bg-slate-50 font-body text-slate-900 antialiased">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
