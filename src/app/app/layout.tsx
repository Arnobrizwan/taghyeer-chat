import { Providers } from '../providers';
import { AppShell } from '@/features/app-shell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
