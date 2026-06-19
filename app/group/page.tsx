'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch('/api/group/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        `/api/group/rooms?code=${code}&name=${encodeURIComponent(joinName.trim())}`
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
