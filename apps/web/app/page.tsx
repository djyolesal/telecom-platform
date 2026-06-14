import { redirect } from 'next/navigation';

/**
 * Page racine : redirige vers le tableau de bord.
 * Les utilisateurs non authentifiés sont interceptés en amont par le middleware
 * et renvoyés vers /login.
 */
export default function HomePage() {
  redirect('/dashboard');
}
