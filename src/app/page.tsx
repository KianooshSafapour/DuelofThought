'use client';

import { AppShell } from '@/components/shared/AppShell';
import { Toaster } from '@/components/ui/sonner';

export default function Page() {
  return (
    <>
      <AppShell />
      <Toaster position="top-center" richColors theme="dark" />
    </>
  );
}
