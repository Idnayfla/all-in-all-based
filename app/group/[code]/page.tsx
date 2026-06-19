'use client';

import { use, useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function ensureAuth(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    supabase.realtime.setAuth(session.access_token);
    return session.access_token;
  }
  // Anonymous sign-in for invite recipients who aren't Based users
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('[group] signInAnonymously failed:', error.message);
    return null;
  }
  const token = data.session?.access_token ?? null;
  if (token) supabase.realtime.setAuth(token);
  return token;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await ensureAuth();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

interface Message {
  id: string;
  display_name: string;
  content: string;
  is_based: boolean;
  created_at: string;
  user_id: string | null;
}

export default function GroupChatPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();

  const [room, setRoom] = useState<{ id: string; name: string; code: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameSet, setNameSet] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [chatError, setChatError] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [basedTyping, setBasedTyping] = useState(false);
  const [joining, setJoining] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const roomRef = useRef<{ id: string; name: string; code: string } | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const joinRoom = useCallback(
    async (name: string) => {
      setJoining(true);
      setChatError('');
      try {
        const headers = await authHeaders();
        if (!headers.Authorization) {
          setChatError('Could not authenticate. Try refreshing the page.');
          return;
        }

        const res = await fetch(`/api/group/rooms?code=${code}&name=${encodeURIComponent(name)}`, {
          headers,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          console.error('[group] joinRoom failed:', res.status, body);
          setJoinError(
            body.error === 'Room not found'
              ? 'Room not found. Check the invite link.'
              : `Error ${res.status} — try refreshing.`
          );
          return;
        }
        const data = (await res.json()) as { id: string; name: string; code: string };
        setRoom(data);
        roomRef.current = data;

        // Persist room so user can find it again
        try {
          const saved = JSON.parse(localStorage.getItem('based_group_rooms') ?? '[]') as {
            code: string;
            name: string;
          }[];
          const updated = [
            { code: data.code, name: data.name },
            ...saved.filter(r => r.code !== data.code),
          ].slice(0, 20);
          localStorage.setItem('based_group_rooms', JSON.stringify(updated));
        } catch {}

        // Load messages
        const msgRes = await fetch(`/api/group/messages?room_id=${data.id}`, { headers });
        if (msgRes.ok) {
          const msgData = (await msgRes.json()) as { messages: Message[] };
          setMessages(msgData.messages);
          setTimeout(scrollToBottom, 50);
        } else {
          console.error('[group] failed to load messages:', msgRes.status);
        }

        // Realtime subscription
        if (channelRef.current) {
          await supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }
        channelRef.current = supabase
          .channel(`group:${data.id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'group_messages',
              filter: `room_id=eq.${data.id}`,
            },
            payload => {
              const newMsg = payload.new as Message;
              setMessages(prev => {
                if (prev.find(m => m.id === newMsg.id)) return prev;
                // Replace optimistic message from same sender with the real one
                const optimisticIdx = prev.findIndex(
                  m =>
                    m.id.startsWith('optimistic-') &&
                    m.display_name === newMsg.display_name &&
                    m.content === newMsg.content
                );
                if (optimisticIdx !== -1) {
                  const next = [...prev];
                  next[optimisticIdx] = newMsg;
                  return next;
                }
                return [...prev, newMsg];
              });
              if (newMsg.is_based) setBasedTyping(false);
              setTimeout(scrollToBottom, 50);
            }
          )
          .subscribe();
      } catch (err) {
        console.error('[group] joinRoom error:', err);
        setChatError('Something went wrong joining the room. Try refreshing.');
      } finally {
        setJoining(false);
      }
    },
    [code, scrollToBottom]
  );

  useEffect(() => {
    const saved = sessionStorage.getItem(`group_name_${code}`);
    if (saved) {
      setDisplayName(saved);
      setNameSet(true);
      void joinRoom(saved);
    }
  }, [code, joinRoom]);

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  // Poll every 4s as Realtime fallback — merges in any messages Realtime missed
  useEffect(() => {
    const interval = setInterval(async () => {
      if (!roomRef.current) return;
      const headers = await authHeaders();
      const res = await fetch(`/api/group/messages?room_id=${roomRef.current.id}`, { headers });
      if (!res.ok) return;
      const { messages: fresh } = (await res.json()) as { messages: Message[] };
      setMessages(prev => {
        const realIds = new Set(prev.filter(m => !m.id.startsWith('optimistic-')).map(m => m.id));
        const newOnes = fresh.filter(m => !realIds.has(m.id));
        if (newOnes.length === 0) return prev;
        if (newOnes.some(m => m.is_based)) setBasedTyping(false);
        const withoutStale = prev.filter(m => {
          if (!m.id.startsWith('optimistic-')) return true;
          return !fresh.some(f => f.display_name === m.display_name && f.content === m.content);
        });
        return [...withoutStale, ...newOnes].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSetName = (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    sessionStorage.setItem(`group_name_${code}`, name);
    setNameSet(true);
    void joinRoom(name);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !room || sending) return;
    const content = input.trim();
    setInput('');
    setSending(true);

    if (/@based/i.test(content)) setBasedTyping(true);

    // Optimistic update — show message immediately without waiting for Realtime
    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      display_name: displayName,
      content,
      is_based: false,
      created_at: new Date().toISOString(),
      user_id: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setTimeout(scrollToBottom, 50);

    try {
      const res = await fetch('/api/group/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ room_id: room.id, content, display_name: displayName }),
      });
      if (!res.ok) {
        console.error('[group] send failed:', res.status, await res.text().catch(() => ''));
        // Remove optimistic message on failure
        setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
        setChatError('Failed to send. Try again.');
      }
      // On success, Realtime will push the real message with a real ID;
      // the dedup check (find by id) won't remove the optimistic one since IDs differ,
      // so replace optimistic with real when it arrives
    } catch (err) {
      console.error('[group] send error:', err);
      setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
      setChatError('Failed to send. Try again.');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend(e as unknown as React.FormEvent);
    }
  };

  const copyInvite = () => {
    const url = `${window.location.origin}/group/${code}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (!nameSet) {
    return (
      <div className="group-name-screen">
        <div className="group-name-card">
          <div className="group-name-title">⬡ Join Group Chat</div>
          <div className="group-name-hint">Room code: {code}</div>
          <form onSubmit={handleSetName} className="group-name-form">
            <input
              className="group-name-input"
              placeholder="Your name in this chat"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              maxLength={40}
              autoFocus
            />
            <button className="group-name-btn" type="submit" disabled={!displayName.trim()}>
              Enter
            </button>
          </form>
          {joinError && <div className="group-name-error">{joinError}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="group-chat-root">
      <div className="group-chat-header">
        <div className="group-chat-title">
          <span className="group-chat-name">{room?.name ?? code}</span>
          <span className="group-chat-code">#{code}</span>
        </div>
        <button className="group-invite-btn" onClick={copyInvite} title="Copy invite link">
          {copied ? '◈ Copied!' : '⬡ Invite'}
        </button>
      </div>

      <div className="group-chat-hint">
        Type <strong>@based</strong> to ask Based a question
      </div>

      {chatError && (
        <div className="group-chat-error">
          {chatError}{' '}
          <button
            onClick={() => {
              setChatError('');
              void joinRoom(displayName);
            }}
            className="group-chat-error-retry"
          >
            Retry
          </button>
        </div>
      )}

      {joining && !room && <div className="group-joining">Joining room…</div>}

      <div className="group-messages">
        {!joining && messages.length === 0 && (
          <div className="group-empty">No messages yet. Say something.</div>
        )}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`group-message${msg.is_based ? ' group-message--based' : ''}${msg.id.startsWith('optimistic-') ? ' group-message--optimistic' : ''}`}
          >
            <div className="group-message-meta">
              <span className="group-message-name">
                {msg.is_based ? '◈ Based' : msg.display_name}
              </span>
              <span className="group-message-time">{formatTime(msg.created_at)}</span>
            </div>
            <div className="group-message-content">{msg.content}</div>
          </div>
        ))}
        {basedTyping && (
          <div className="group-message group-message--based group-message--typing">
            <div className="group-message-meta">
              <span className="group-message-name">◈ Based</span>
            </div>
            <div className="group-typing-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="group-input-form" onSubmit={handleSend}>
        <textarea
          ref={inputRef}
          className="group-input"
          placeholder={
            room ? `Message as ${displayName} — @based to ask Based` : 'Connecting to room…'
          }
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={sending || !room}
        />
        <button
          className="group-send-btn"
          type="submit"
          disabled={!input.trim() || sending || !room}
        >
          ◈
        </button>
      </form>
    </div>
  );
}
