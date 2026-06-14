'use client';

import { useEffect, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { fmtDateTime } from '@/lib/utils';

interface Notif {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken;

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications', { params: { limit: 10 } }).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const notifs: Notif[] = data?.data ?? [];
  const unread: number = data?.unread ?? 0;

  // Rafraîchissement temps réel via socket /notif
  useEffect(() => {
    if (!token) return;
    const socket = getSocket('/notif', token);
    const onNew = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
    socket.on('notification:new', onNew);
    return () => { socket.off('notification:new', onNew); };
  }, [token, queryClient]);

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={18} className="text-gray-600" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-lg z-20">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <span className="text-sm font-semibold text-gray-700">Notifications</span>
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  className="flex items-center gap-1 text-xs text-[#2471A3] hover:underline"
                >
                  <Check size={12} /> Tout marquer lu
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifs.length === 0 && (
                <p className="px-4 py-8 text-center text-xs text-gray-400">Aucune notification</p>
              )}
              {notifs.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.isRead && markOne.mutate(n.id)}
                  className={`block w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 ${n.isRead ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#2471A3]" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{n.title}</p>
                      <p className="text-xs text-gray-500 line-clamp-2">{n.body}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">{fmtDateTime(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
