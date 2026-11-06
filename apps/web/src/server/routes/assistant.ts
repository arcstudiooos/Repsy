import { z } from 'zod';
import {
  appendAiExchange,
  assertAiEnabled,
  cleanQuestion,
  createAiConversation,
  deleteAiConversation,
  DomainError,
  getAiConversation,
  getAiSetting,
  listAiConversations,
  runAssistantTool,
  setAiSetting,
} from '@kinetic/core';
import { ApiResult, type RouteDef } from '../api';
import { assistantClient, runAssistantTurn, type AssistantClient } from '../assistant/run';

/** Tests swap in a fake model client; production builds one from ANTHROPIC_API_KEY. */
let clientOverride: AssistantClient | null | undefined;
export function setAssistantClientForTests(client: AssistantClient | null | undefined) {
  clientOverride = client;
}

const settingSchema = z.object({ aiEnabled: z.boolean() });

/** `GET /api/v1/assistant/settings`: the workspace opt-in, and whether a provider key is set. */
export const assistantSettingsGetRoute: RouteDef<undefined, true> = {
  can: 'assistant:use',
  handler: async ({ actor, tenant }) => ({
    ...(await tenant((tx) => getAiSetting(tx, actor))),
    configured:
      clientOverride !== undefined ? clientOverride !== null : !!process.env.ANTHROPIC_API_KEY,
  }),
};

/** `PUT /api/v1/assistant/settings`: turn the assistant on or off. Managers only. */
export const assistantSettingsPutRoute: RouteDef<typeof settingSchema, true> = {
  can: 'settings:org:update',
  input: settingSchema,
  handler: ({ actor, input, tenant }) => tenant((tx) => setAiSetting(tx, actor, input.aiEnabled)),
};

/** `GET /api/v1/assistant/conversations`: the caller's own conversations. */
export const assistantConversationsRoute: RouteDef<undefined, true> = {
  can: 'assistant:use',
  handler: ({ actor, tenant }) => tenant((tx) => listAiConversations(tx, actor)),
};

/** `GET /api/v1/assistant/conversations/:id`. */
export const assistantConversationGetRoute: RouteDef<undefined, true> = {
  can: 'assistant:use',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => getAiConversation(tx, actor, params.id ?? '')),
};

/** `DELETE /api/v1/assistant/conversations/:id`. */
export const assistantConversationDeleteRoute: RouteDef<undefined, true> = {
  can: 'assistant:use',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => deleteAiConversation(tx, actor, params.id ?? '')),
};

const messageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  question: z.string().max(4000),
});

/**
 * `POST /api/v1/assistant/messages` (PRD I15): ask the assistant. Starts a conversation when no id is
 * given. Answers with the conversation id and the two new messages.
 */
export const assistantMessageRoute: RouteDef<typeof messageSchema, true> = {
  can: 'assistant:use',
  input: messageSchema,
  rateLimit: { capacity: 30, refillPerSecond: 30 / 3600 },
  handler: async ({ actor, input, tenant }) => {
    const question = cleanQuestion(input.question);
    const client = clientOverride !== undefined ? clientOverride : assistantClient();
    if (!client) {
      throw new DomainError('AI_UNAVAILABLE', 'The AI assistant is not set up on this server yet.');
    }
    const { org, history } = await tenant(async (tx) => {
      await assertAiEnabled(tx, actor);
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: actor.orgId },
        select: { name: true, timezone: true },
      });
      const history = input.conversationId
        ? (await getAiConversation(tx, actor, input.conversationId)).messages.slice(-20)
        : [];
      return { org, history };
    });

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: org.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).format(new Date());
    const result = await runAssistantTurn(client, {
      history: history.map((m) => ({ role: m.role, body: m.body })),
      question,
      context: {
        today,
        timezone: org.timezone,
        workspaceName: org.name,
      },
      runTool: (name, toolInput) => tenant((tx) => runAssistantTool(tx, actor, name, toolInput)),
    });

    const saved = await tenant(async (tx) => {
      const conversationId =
        input.conversationId ?? (await createAiConversation(tx, actor, question));
      const messages = await appendAiExchange(tx, actor, conversationId, {
        question,
        answer: result.answer,
        toolsUsed: result.toolsUsed,
      });
      return { conversationId, messages };
    });
    return new ApiResult(saved, { status: input.conversationId ? 200 : 201 });
  },
};
