import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

/**
 * Inter para toda la interfaz (es la que asume la escala tipografica de
 * shadcn) y JetBrains Mono para claves y cifras. Space Grotesk queda reservada
 * al nombre de la marca: es parte del logo, no de la UI.
 *
 * Las tres van locales y no desde Google Fonts a proposito: el panel tiene que
 * abrir igual en una maquina sin internet, que es media razon de ser de un POS
 * offline.
 */
const sans = localFont({
  src: '../fonts/inter.woff2',
  weight: '100 900',
  variable: '--fuente-sans',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

const mono = localFont({
  src: '../fonts/jetbrains-mono.woff2',
  weight: '100 800',
  variable: '--fuente-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'Consolas', 'monospace'],
});

const marca = localFont({
  src: '../fonts/space-grotesk.woff2',
  weight: '300 700',
  variable: '--fuente-marca',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: {
    default: 'Binario Dev Labs — Panel',
    template: '%s · Binario Dev Labs',
  },
  description: 'Administración de licencias, suscripciones y cobranza del sistema POS.',
  icons: { icon: '/logo-mark.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // El panel es oscuro siempre: la clase `dark` va fija, no hay selector de tema.
    <html lang="es-AR" className={`dark ${sans.variable} ${mono.variable} ${marca.variable}`}>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
