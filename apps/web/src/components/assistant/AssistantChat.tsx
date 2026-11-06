'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, MessageSquarePlus, Send, Sparkles, Trash2 } from 'lucide-react';
import type { AiConversationSummary, AiMessageView } from '@kinetic/core';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { askAssistant, loadConversation, removeConversation } from '@/lib/assistant-api';
import { AnswerText } from './AnswerText';

const TOOL_LABELS: Record<string, string> = {
  list_clients: 'clients',
  get_client: 'client profile',
  list_programs: 'programs',
  get_program: 'program',
  workout_activity: 'workouts',
  list_checkins: 'check-ins',
  recent_messages: 'messages',
  list_bookings: 'bookings',
  business_summary: 'business numbers',
};

const SUGGESTIONS = [
  'Who missed workouts this week?',
  'Which check-ins are waiting for my review?',
  'Summarise how my newest client is doing.',
  'How much did I collect in the last 30 days?',
];

/** PRD I15: the assistant screen. Conversations on the left (top on mobile), the chat on the right. */
export function AssistantChat({
  initialConversations,
}: {
  initialConversations: AiConversationSummary[];
}) {
  const router = useRouter();
  const inputId = useId();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessageView[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pendingQuestion]);

  async function open(id: string) {
    if (loading) return;
    const res = await loadConversation(id);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setActiveId(id);
    setMessages(res.data.messages);
  }

  function startNew() {
    setActiveId(null);
    setMessages([]);
    setDraft('');
  }

  async function remove(id: string) {
    const res = await removeConversation(id);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setConversations((list) => list.filter((c) => c.id !== id));
    if (activeId === id) startNew();
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setPendingQuestion(q);
    setDraft('');
    const res = await askAssistant({ conversationId: activeId ?? undefined, question: q });
    setLoading(false);
    setPendingQuestion(null);
    if (!res.ok) {
      setDraft(q);
      toast.error(res.message);
      return;
    }
    const { conversationId, messages: added } = res.data;
    setMessages((list) => [...list, ...added]);
    if (!activeId) {
      setActiveId(conversationId);
      setConversations((list) => [
        {
          id: conversationId,
          title: q.length > 60 ? `${q.slice(0, 57)}...` : q,
          updatedAt: new Date().toISOString(),
        },
        ...list,
      ]);
      router.refresh();
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside aria-label="Conversations" className="flex flex-col gap-2">
        <Button variant="secondary" onClick={startNew}>
          <MessageSquarePlus aria-hidden /> New conversation
        </Button>
        {conversations.length > 0 && (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto lg:max-h-[60vh]">
            {conversations.map((c) => (
              <li key={c.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => open(c.id)}
                  aria-current={c.id === activeId ? 'true' : undefined}
                  className="min-h-11 flex-1 truncate rounded-control px-3 text-left text-sm hover:bg-surface-2 aria-[current=true]:bg-brand-soft aria-[current=true]:text-brand-ink"
                >
                  {c.title}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete conversation: ${c.title}`}
                  onClick={() => remove(c.id)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section
        aria-label="Chat"
        className="flex min-h-[60vh] flex-col rounded-card border border-border bg-surface"
      >
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && !pendingQuestion && (
            <div className="flex flex-col items-start gap-3">
              <p className="flex items-center gap-2 font-semibold">
                <Sparkles aria-hidden className="size-4 text-brand" /> Ask about your clients,
                programs, check-ins or business.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="soft" size="sm" onClick={() => ask(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div
                key={m.id}
                className="ml-auto max-w-[85%] rounded-card bg-brand-soft px-4 py-2 text-brand-ink"
              >
                <p className="whitespace-pre-line">{m.body}</p>
              </div>
            ) : (
              <div key={m.id} className="max-w-full">
                <AnswerText text={m.body} />
                {m.toolsUsed.length > 0 && (
                  <p className="mt-2 text-caption text-secondary">
                    Looked at:{' '}
                    {[...new Set(m.toolsUsed.map((t) => TOOL_LABELS[t] ?? t))].join(', ')}
                  </p>
                )}
              </div>
            ),
          )}
          {pendingQuestion && (
            <>
              <div className="ml-auto max-w-[85%] rounded-card bg-brand-soft px-4 py-2 text-brand-ink">
                <p className="whitespace-pre-line">{pendingQuestion}</p>
              </div>
              <p className="flex items-center gap-2 text-secondary">
                <Loader2 aria-hidden className="size-4 animate-spin" /> Looking through your
                workspace...
              </p>
            </>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Your question
          </label>
          <textarea
            id={inputId}
            rows={2}
            maxLength={4000}
            value={draft}
            placeholder="Ask anything about your workspace"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            className="min-h-11 flex-1 resize-none rounded-control border border-input-border bg-surface px-3 py-2 text-base"
          />
          <Button type="submit" disabled={loading || !draft.trim()} aria-label="Send">
            {loading ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
          </Button>
        </form>
      </section>
    </div>
  );
}
