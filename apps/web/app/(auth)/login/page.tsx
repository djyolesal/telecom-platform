'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Loader2, LogIn, AlertCircle } from 'lucide-react';
import { LogoIcon, LogoWordmark } from '@/components/shared/Logo';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const res = await signIn('credentials', { email, password, redirect: false });

    setLoading(false);
    if (res?.error) {
      setError('Email ou mot de passe incorrect');
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl p-8">
      <div className="text-center mb-8">
        <div className="mb-3 flex justify-center"><LogoIcon size={56} /></div>
        <h1 className="text-2xl font-bold text-[#1B3F6B]"><LogoWordmark /></h1>
        <p className="text-sm text-gray-500 mt-1">Exploitation &amp; Maintenance · Operations Services</p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none"
            placeholder="vous@telecom.tg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none"
            placeholder="••••••••"
          />
        </div>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs text-[#2471A3] hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#1B3F6B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2471A3] transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-gray-400">
        Accès réservé au personnel autorisé
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="bg-white rounded-2xl shadow-2xl p-8 text-center text-sm text-gray-400">Chargement…</div>}>
      <LoginForm />
    </Suspense>
  );
}
