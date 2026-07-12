'use client';

import { useState } from 'react';
import { SessionProvider } from 'next-auth/react';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { Toaster } from '@/components/shared/Toaster';
import { toast, errorMessage } from '@/lib/toast';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
        // Filet de sécurité : toute mutation qui échoue sans onError dédié affiche
        // un toast (plus d'échec 100 % silencieux — le spinner s'arrêtait sans rien).
        // Le 401 est déjà géré par l'intercepteur axios (déconnexion).
        mutationCache: new MutationCache({
          onError: (err, _vars, _ctx, mutation) => {
            if ((err as { response?: { status?: number } })?.response?.status === 401) return;
            if (mutation.options.onError) return; // déjà géré localement
            toast(errorMessage(err), 'error');
          },
        }),
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </SessionProvider>
  );
}
