import type { ReactNode } from 'react';
import './styles.css';

export const metadata = { title: '과학 탐구 수업 설계기' };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
