import type { Metadata } from 'next';
import { connection } from 'next/server';
import { getAiSetting, isManager, listAiConversations } from '@repsy/core';
import { AssistantChat } from '@/components/assistant/AssistantChat';
import { AssistantActionsToggle, AssistantToggle } from '@/components/assistant/AssistantToggle';
import { EmptyState } from '@/components/states/EmptyState';
import { assistantConfigured } from '@/server/assistant/run';
import { withServerTenant } from '@/server/serverActor';

export const metadata: Metadata = { title: 'AI assistant | Repsy' };

/** PRD I15: ask questions about the workspace; the assistant reads through read-only tools. */
export default async function AssistantPage() {
  await connection();
  const { setting, conversations, manager } = await withServerTenant(async (tx, actor) => ({
    setting: await getAiSetting(tx, actor),
    conversations: await listAiConversations(tx, actor),
    manager: isManager(actor.role),
  }));
  const configured = assistantConfigured();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-semibold md:text-display">AI assistant</h1>
        {manager && setting.aiEnabled && (
          <div className="flex flex-wrap gap-2">
            <AssistantActionsToggle enabled={setting.actionsEnabled} />
            <AssistantToggle enabled />
          </div>
        )}
      </div>
      {!configured ? (
        <EmptyState
          title="The assistant is not set up yet"
          body="This server has no AI provider key. Add OPENAI_API_KEY to the web service to use the assistant."
        />
      ) : !setting.aiEnabled ? (
        <EmptyState
          title="The AI assistant is off"
          body={
            manager
              ? 'When it is on, anyone on your team can ask questions about clients, programs, nutrition, check-ins and the business. To answer, Repsy sends the workspace data it needs to OpenAI, which processes it on our behalf and does not train on it. It only reads, unless you also let it propose changes (assigning programs, nutrition targets and meal plans); each change then waits for the coach to press Confirm. It never messages anyone.'
              : 'An owner or admin can turn it on for your workspace.'
          }
          action={manager ? <AssistantToggle enabled={false} /> : undefined}
        />
      ) : (
        <AssistantChat
          initialConversations={conversations}
          actionsEnabled={setting.actionsEnabled}
        />
      )}
    </>
  );
}
