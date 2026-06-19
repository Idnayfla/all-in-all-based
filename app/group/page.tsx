'use client';

import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) return { Authorization: `Bearer ${session.access_token}` };
  const { data } = await supabase.auth.signInAnonymously();
  if (!data.session) return {};
  return { Authorization: `Bearer ${data.session.access_token}` };
}

export default function GroupLandingPage() {
  const router = useRouter();

  const [createName, setCreateName] = useState('');
  const [createRoom, setCreateRoom] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const [myRooms, setMyRooms] = useState<{ code: string; name: string }[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('based_group_rooms') ?? '[]') as {
        code: string;
        name: string;
      }[];
      setMyRooms(saved);
    } catch {}
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/api/group/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          name: createRoom.trim() || 'Group Chat',
          displayName: createName.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed to create room');
      const { code } = (await res.json()) as { code: string };
      sessionStorage.setItem(`group_name_${code}`, createName.trim());
      router.push(`/group/${code}`);
    } catch {
      setCreateError('Could not create room. Try again.');
      setCreating(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code || !joinName.trim()) return;
    setJoining(true);
    setJoinError('');
    try {
      const res = await fetch(
        `/api/group/rooms?code=${code}&name=${encodeURIComponent(joinName.trim())}`,
        { headers: await authHeaders() }
      );
      if (!res.ok) throw new Error('Room not found');
      sessionStorage.setItem(`group_name_${code}`, joinName.trim());
      router.push(`/group/${code}`);
    } catch {
      setJoinError('Room not found. Check the code and try again.');
      setJoining(false);
    }
  };

  return (
    <div className="group-landing-root">
      <div className="group-landing-header">
        <div className="group-landing-title">⬡ Group Chat</div>
        <div className="group-landing-sub">
          Chat with others — Based joins as a silent observer. Type <strong>@based</strong> to ask
          it anything.
        </div>
      </div>

      {myRooms.length > 0 && (
        <div className="group-my-rooms">
          <div className="group-my-rooms-heading">Your Rooms</div>
          {myRooms.map(r => (
            <button
              key={r.code}
              className="group-my-room-btn"
              onClick={() => router.push(`/group/${r.code}`)}
            >
              <span className="group-my-room-name">{r.name}</span>
              <span className="group-my-room-code">#{r.code}</span>
            </button>
          ))}
        </div>
      )}

      <div className="group-landing-cards">
        <div className="group-landing-card">
          <div className="group-card-heading">Start a Room</div>
          <form onSubmit={handleCreate} className="group-card-form">
            <input
              className="group-name-input"
              placeholder="Your name"
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              maxLength={40}
              required
              autoFocus
            />
            <input
              className="group-name-input"
              placeholder="Room name (optional)"
              value={createRoom}
              onChange={e => setCreateRoom(e.target.value)}
              maxLength={60}
            />
            <button
              className="group-name-btn"
              type="submit"
              disabled={!createName.trim() || creating}
            >
              {creating ? 'Creating…' : '◈ Start'}
            </button>
          </form>
          {createError && <div className="group-name-error">{createError}</div>}
        </div>

        <div className="group-landing-divider">or</div>

        <div className="group-landing-card">
          <div className="group-card-heading">Join with Code</div>
          <form onSubmit={handleJoin} className="group-card-form">
            <input
              className="group-name-input"
              placeholder="Your name"
              value={joinName}
              onChange={e => setJoinName(e.target.value)}
              maxLength={40}
              required
            />
            <input
              className="group-name-input"
              placeholder="Invite code (e.g. AB3KXYZ9)"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={12}
              required
            />
            <button
              className="group-name-btn"
              type="submit"
              disabled={!joinCode.trim() || !joinName.trim() || joining}
            >
              {joining ? 'Joining…' : '→ Join'}
            </button>
          </form>
          {joinError && <div className="group-name-error">{joinError}</div>}
        </div>
      </div>
    </div>
  );
}
