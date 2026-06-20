'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
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

async function uploadFile(file: File): Promise<string | null> {
  const headers = await authHeaders();
  const res = await fetch('/api/group/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ filename: file.name, content_type: file.type }),
  });
  if (!res.ok) return null;
  const { upload_url, public_url, content_type } = (await res.json()) as {
    upload_url: string;
    public_url: string;
    content_type: string;
  };
  const put = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': content_type },
  });
  return put.ok ? public_url : null;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
function isImageFilename(name: string | null | undefined): boolean {
  if (!name) return false;
  const dot = name.lastIndexOf('.');
  return dot !== -1 && IMAGE_EXTS.has(name.slice(dot).toLowerCase());
}
function extractFilename(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    return last.replace(/^\d+_/, '');
  } catch {
    return 'file';
  }
}

interface Message {
  id: string;
  display_name: string;
  content: string;
  is_based: boolean;
  created_at: string;
  user_id: string | null;
  media_url?: string | null;
  media_filename?: string | null;
}

interface SystemEvent {
  id: string;
  type: 'join' | 'leave';
  display_name: string;
  timestamp: string;
}

export default function GroupChatPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = use(params);
  const code = rawCode.toUpperCase();
  const router = useRouter();

  const [room, setRoom] = useState<{ id: string; name: string; code: string } | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [systemEvents, setSystemEvents] = useState<SystemEvent[]>([]);
  const [input, setInput] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [nameSet, setNameSet] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [chatError, setChatError] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [basedTyping, setBasedTyping] = useState(false);
  const [joining, setJoining] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const roomRef = useRef<{ id: string; name: string; code: string } | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const displayNameRef = useRef('');

  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

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
          setJoinError(
            body.error === 'Room not found'
              ? 'Room not found. Check the invite link.'
              : `Error ${res.status} — try refreshing.`
          );
          return;
        }
        const data = (await res.json()) as {
          id: string;
          name: string;
          code: string;
          is_creator?: boolean;
        };
        setRoom(data);
        roomRef.current = data;
        setIsCreator(data.is_creator ?? false);

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

        const msgRes = await fetch(`/api/group/messages?room_id=${data.id}`, { headers });
        if (msgRes.ok) {
          const msgData = (await msgRes.json()) as { messages: Message[] };
          setMessages(msgData.messages);
          setTimeout(scrollToBottom, 50);
        }

        if (channelRef.current) {
          await supabase.removeChannel(channelRef.current);
          channelRef.current = null;
        }

        const channel = supabase.channel(`group:${data.id}`);

        channel
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
          // Broadcast: typing indicator
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            const { display_name: dn, typing } = payload as {
              display_name: string;
              typing: boolean;
            };
            if (dn === displayNameRef.current) return;
            const existing = typingTimersRef.current.get(dn);
            if (existing) clearTimeout(existing);
            if (typing) {
              setTypingUsers(prev => [...new Set([...prev, dn])]);
              const timer = setTimeout(() => {
                setTypingUsers(prev => prev.filter(u => u !== dn));
                typingTimersRef.current.delete(dn);
              }, 3000);
              typingTimersRef.current.set(dn, timer);
            } else {
              setTypingUsers(prev => prev.filter(u => u !== dn));
              typingTimersRef.current.delete(dn);
            }
          })
          // Presence: reliable join/leave tied to WebSocket — auto-fires on tab close
          .on('presence', { event: 'sync' }, () => {
            const state = channel.presenceState<{ display_name?: string }>();
            setOnlineCount(Object.values(state).flat().length);
          })
          .on('presence', { event: 'join' }, ({ newPresences }) => {
            (newPresences as { display_name?: string }[]).forEach(p => {
              if (p.display_name && p.display_name !== displayNameRef.current) {
                setSystemEvents(prev => [
                  ...prev,
                  {
                    id: `join-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    type: 'join' as const,
                    display_name: p.display_name!,
                    timestamp: new Date().toISOString(),
                  },
                ]);
              }
            });
            const state = channel.presenceState<{ display_name?: string }>();
            setOnlineCount(Object.values(state).flat().length);
          })
          .on('presence', { event: 'leave' }, ({ leftPresences }) => {
            (leftPresences as { display_name?: string }[]).forEach(p => {
              if (p.display_name) {
                setSystemEvents(prev => [
                  ...prev,
                  {
                    id: `leave-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    type: 'leave' as const,
                    display_name: p.display_name!,
                    timestamp: new Date().toISOString(),
                  },
                ]);
                setTypingUsers(prev => prev.filter(u => u !== p.display_name));
              }
            });
            const state = channel.presenceState<{ display_name?: string }>();
            setOnlineCount(Object.values(state).flat().length);
          })
          .subscribe(status => {
            if (status === 'SUBSCRIBED') {
              void channel.track({ display_name: name });
            }
          });

        channelRef.current = channel;
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
    const saved = localStorage.getItem(`group_name_${code}`);
    if (saved) {
      setDisplayName(saved);
      setNameSet(true);
      void joinRoom(saved);
    }
  }, [code, joinRoom]);

  useEffect(() => {
    return () => {
      if (channelRef.current) void supabase.removeChannel(channelRef.current);
      typingTimersRef.current.forEach(t => clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Poll every 4s as Realtime fallback
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

  const broadcastTyping = useCallback((isTyping: boolean) => {
    if (!channelRef.current) return;
    void channelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { display_name: displayNameRef.current, typing: isTyping },
    });
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    broadcastTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => broadcastTyping(false), 2000);
  };

  const handleSetName = (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    localStorage.setItem(`group_name_${code}`, name);
    setNameSet(true);
    void joinRoom(name);
  };

  const handleFile = async (file: File) => {
    const isImg = file.type.startsWith('image/');
    setFilePreview(isImg ? URL.createObjectURL(file) : null);
    setFileName(file.name);
    setUploading(true);
    const url = await uploadFile(file);
    if (url) {
      setFileUrl(url);
    } else {
      setFilePreview(null);
      setFileName(null);
    }
    setUploading(false);
  };

  const clearFile = () => {
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(null);
    setFileUrl(null);
    setFileName(null);
  };

  const handleLeave = useCallback(() => {
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    router.push('/group');
  }, [router]);

  const handleDelete = useCallback(async () => {
    if (!room) return;
    if (!window.confirm('Delete this room for everyone? This cannot be undone.')) return;
    await fetch(`/api/group/rooms?room_id=${room.id}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    try {
      const saved = JSON.parse(localStorage.getItem('based_group_rooms') ?? '[]') as {
        code: string;
        name: string;
      }[];
      localStorage.setItem('based_group_rooms', JSON.stringify(saved.filter(r => r.code !== code)));
      localStorage.removeItem(`group_name_${code}`);
    } catch {}
    if (channelRef.current) {
      void supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    router.push('/group');
  }, [room, code, router]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !fileUrl) || !room || sending || uploading) return;

    broadcastTyping(false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    const content = input.trim();
    const mediaUrl = fileUrl;
    const mediaFilename = fileName;
    setInput('');
    clearFile();
    setSending(true);

    if (/@based/i.test(content)) setBasedTyping(true);

    const optimisticMsg: Message = {
      id: `optimistic-${Date.now()}`,
      display_name: displayName,
      content,
      is_based: false,
      created_at: new Date().toISOString(),
      user_id: null,
      media_url: filePreview ?? mediaUrl,
      media_filename: mediaFilename,
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setTimeout(scrollToBottom, 50);

    try {
      const res = await fetch('/api/group/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          room_id: room.id,
          content,
          display_name: displayName,
          media_url: mediaUrl,
          media_filename: mediaFilename,
        }),
      });
      if (!res.ok) {
        setMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
        setChatError('Failed to send. Try again.');
      }
    } catch {
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

  const handlePaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      void handleFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
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

  const mergedItems = useMemo(() => {
    type Item = { kind: 'message'; data: Message } | { kind: 'system'; data: SystemEvent };
    const items: Item[] = [
      ...messages.map(m => ({ kind: 'message' as const, data: m })),
      ...systemEvents.map(e => ({ kind: 'system' as const, data: e })),
    ];
    return items.sort((a, b) => {
      const ta = a.kind === 'message' ? a.data.created_at : a.data.timestamp;
      const tb = b.kind === 'message' ? b.data.created_at : b.data.timestamp;
      return new Date(ta).getTime() - new Date(tb).getTime();
    });
  }, [messages, systemEvents]);

  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0]} is typing…`
        : typingUsers.length === 2
          ? `${typingUsers[0]} and ${typingUsers[1]} are typing…`
          : `${typingUsers[0]} and ${typingUsers.length - 1} others are typing…`;

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
    <div
      className="group-chat-root"
      onDragOver={e => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {dragging && <div className="group-drop-overlay">Drop file to share</div>}

      <div className="group-chat-header">
        <div className="group-chat-title">
          <span className="group-chat-name">{room?.name ?? code}</span>
          <span className="group-chat-code">#{code}</span>
          {onlineCount > 0 && <span className="group-online-count">{onlineCount} online</span>}
        </div>
        <div className="group-chat-actions">
          <button className="group-invite-btn" onClick={copyInvite} title="Copy invite link">
            {copied ? '◈ Copied!' : '⬡ Invite'}
          </button>
          <button className="group-leave-btn" onClick={handleLeave} title="Leave room">
            Leave
          </button>
          {isCreator && (
            <button
              className="group-delete-btn"
              onClick={() => void handleDelete()}
              title="Delete room for everyone"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="group-chat-hint">
        Type <strong>@based</strong> to ask Based · chatting as <strong>{displayName}</strong> · go
        to /group to change name
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
        {!joining && mergedItems.length === 0 && (
          <div className="group-empty">No messages yet. Say something.</div>
        )}
        {mergedItems.map(item => {
          if (item.kind === 'system') {
            return (
              <div key={item.data.id} className="group-system-event">
                {item.data.display_name} {item.data.type === 'join' ? 'joined' : 'left'} the chat
              </div>
            );
          }
          const msg = item.data;
          const fn = msg.media_filename ?? (msg.media_url ? extractFilename(msg.media_url) : null);
          return (
            <div
              key={msg.id}
              className={[
                'group-message',
                msg.is_based ? 'group-message--based' : '',
                msg.id.startsWith('optimistic-') ? 'group-message--optimistic' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="group-message-meta">
                <span className="group-message-name">
                  {msg.is_based ? '◈ Based' : msg.display_name}
                </span>
                <span className="group-message-time">{formatTime(msg.created_at)}</span>
              </div>
              {msg.content && <div className="group-message-content">{msg.content}</div>}
              {msg.media_url &&
                (isImageFilename(fn) ? (
                  <img
                    src={msg.media_url}
                    alt={fn ?? 'image'}
                    className="group-message-img"
                    onClick={() => {
                      if (/^https?:\/\//i.test(msg.media_url ?? '')) {
                        window.open(msg.media_url!, '_blank', 'noopener,noreferrer');
                      }
                    }}
                  />
                ) : (
                  <a
                    href={msg.media_url}
                    download={fn ?? undefined}
                    className="group-file-card"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14,2 14,8 20,8" />
                    </svg>
                    {fn ?? 'Download file'}
                  </a>
                ))}
            </div>
          );
        })}
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

      {typingLabel && <div className="group-typing-label">{typingLabel}</div>}

      {(filePreview ?? (fileName && !filePreview)) && (
        <div className="group-img-preview">
          {filePreview ? (
            <img src={filePreview} alt="preview" />
          ) : (
            <div className="group-file-pending">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
              <span>{fileName}</span>
            </div>
          )}
          {uploading && <span className="group-img-uploading">Uploading…</span>}
          <button className="group-img-preview-remove" onClick={clearFile}>
            ×
          </button>
        </div>
      )}

      <form className="group-input-form" onSubmit={handleSend}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.zip,.rar,.7z,.tar,.gz"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="group-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file or image"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          className="group-input"
          placeholder={room ? `Message as ${displayName}` : 'Connecting to room…'}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          disabled={sending || !room}
        />
        <button
          className="group-send-btn"
          type="submit"
          disabled={(!input.trim() && !fileUrl) || sending || uploading || !room}
        >
          →
        </button>
      </form>
    </div>
  );
}
