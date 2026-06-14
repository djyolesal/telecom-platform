'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Mail, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
    } catch {
      /* réponse volontairement identique (anti-énumération) */
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl p-8">
      <Link href="/login" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={14} /> Retour à la connexion
      </Link>

      {sent ? (
        <div className="text-center py-4">
          <CheckCircle2 size={40} className="mx-auto text-green-500 mb-3" />
          <h1 className="text-lg font-bold text-gray-800">Email envoyé</h1>
          <p className="text-sm text-gray-500 mt-2">
            Si un compte est associé à <b>{email}</b>, un lien de réinitialisation vient d&apos;être envoyé.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-xl font-bold text-[#1B3F6B] mb-1">Mot de passe oublié</h1>
          <p className="text-sm text-gray-500 mb-6">Saisissez votre email pour recevoir un lien de réinitialisation.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none"
                placeholder="vous@telecom.tg"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#1B3F6B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#2471A3] transition-colors disabled:opacity-60"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              Envoyer le lien
            </button>
          </form>
        </>
      )}
    </div>
  );
}
