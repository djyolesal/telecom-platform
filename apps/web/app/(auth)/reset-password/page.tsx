'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (password !== confirm) { setError('Les deux mots de passe ne correspondent pas.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: password });
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Lien invalide ou expiré. Redemandez une réinitialisation.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center py-4">
        <AlertCircle size={40} className="mx-auto text-red-400 mb-3" />
        <h1 className="text-lg font-bold text-gray-800">Lien invalide</h1>
        <p className="text-sm text-gray-500 mt-2">Ce lien de réinitialisation est incomplet.</p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm text-[#2471A3] hover:underline">Redemander un lien</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
        <h1 className="text-lg font-bold text-gray-800">Mot de passe réinitialisé</h1>
        <p className="text-sm text-gray-500 mt-2">Vous allez être redirigé vers la connexion…</p>
      </div>
    );
  }

  return (
    <>
      <Link href="/login" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={14} /> Retour à la connexion
      </Link>
      <h1 className="text-xl font-bold text-[#1B3F6B] mb-1">Nouveau mot de passe</h1>
      <p className="text-sm text-gray-500 mb-6">Choisissez un mot de passe d&apos;au moins 8 caractères.</p>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nouveau mot de passe</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none"
            placeholder="••••••••"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirmer</label>
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none"
            placeholder="••••••••"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#1B3F6B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2471A3] transition-colors disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          Réinitialiser
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="bg-white rounded-2xl shadow-2xl p-8">
      <Suspense fallback={<div className="py-8 text-center text-sm text-gray-400">Chargement…</div>}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
