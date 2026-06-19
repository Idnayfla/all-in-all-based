'use client';

import { use, useEffect, useRef, useState, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return {};
  return { Authorization: `Bearer ${session.access_token}` };
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
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [basedTyping, setBasedTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Join room and load messages
  const joinRoom = useCallback(
    async (name: string) => {
      const headers = await authHeaders();
      const res = await fetch(`/api/group/rooms?code=${code}&name=${encodeURIComponent(name)}`, {
        headers,
      });
      if (!res.ok) {
        setError('Room not found. Check the invite link.');
        return;
      }
      const data = (await res.json()) as { id: string; name: string; code: string };
      setRoom(data);

      // Persist room to localStorage so user can find it again later
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

      // Load existing messages
      const msgRes = await fetch(`/api/group/messages?room_id=${data.id}`, { headers });
      if (msgRes.ok) {
        const msgData = (await msgRes.json()) as { messages: Message[] };
        setMessages(msgData.messages);
        setTimeout(scrollToBottom, 50);
      }

      // Clean up any existing subscription before creating a new one
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
              return [...prev, newMsg];
            });
            if (newMsg.is_based) setBasedTyping(false);
            setTimeout(scrollToBottom, 50);
          }
        )
        .subscribe();
    },
    [code, scrollToBottom]
  );

  useEffect(() => {
    // Check if name already stored for this room
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

    await fetch('/api/group/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ room_id: room.id, content, display_name: displayName }),
    });

    setSending(false);
    inputRef.current?.focus();
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
          {error && <div className="group-name-error">{error}</div>}
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

      <div className="group-messages">
        {messages.length === 0 && (
          <div className="group-empty">No messages yet. Say something.</div>
        )}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`group-message${msg.is_based ? ' group-message--based' : ''}`}
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
          placeholder={`Message as ${displayName} — @based to ask Based`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={sending}
        />
        <button className="group-send-btn" type="submit" disabled={!input.trim() || sending}>
          ◈
        </button>
      </form>
    </div>
  );
}
