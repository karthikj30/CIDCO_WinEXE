import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CIDCO AQI Compliance Portal',
  description:
    'City and Industrial Development Corporation — Air Quality Index reporting portal for empanelled architects.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
    // attributes like data-gr-ext-installed onto <html>/<body> before React
    // hydrates, which would otherwise trip a hydration mismatch warning.
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
