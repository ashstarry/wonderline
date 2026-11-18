import type { Metadata } from 'next';
import './globals.css';
import {LanguageProvider} from '../components/LanguageProvider';
export const metadata: Metadata = {
 title: 'Wonderline · Keep talking while we draw',
 description: 'Keep talking while we draw. Add new ideas while the brushes are still busy, and watch your picture grow, stroke by stroke, in crayon, colored pencil or watercolor.',
 metadataBase: new URL('https://softspoken-paper-garden.neonolm3.chatgpt.site'),
 icons: { icon: '/favicon.svg' },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><LanguageProvider>{children}</LanguageProvider></body></html>;}
