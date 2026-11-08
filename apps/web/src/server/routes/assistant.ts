import { z } from 'zod';
import {
  ACTION_TOOL_NAMES,
  appendAiExchange,
  applyAiAction,
  assertAiEnabled,
  canUseAssistantActions,
  cancelAiAction,
  linkAiActions,
  listAiActions,
  markAiActionFailed,
  runActionTool,
  setAiActionsEnabled,
  cleanQuestion,
  createAiConversation,
  deleteAiConversation,
  DomainError,
  getAiConversation,
  getAiSetting,
  listAiConversations,
  runAssistantTool,
  setAiSetting,
} from '@repsy/core';
import { ApiResult, type RouteDef } from '../api';
import {
  assistantClient,
  assistantConfigured,
  runAssistantTurn,
  type AssistantClient,
} from '../assistant/run';

/** Tests swap in a fake model client; production builds one from OPENAI_API_KEY. */
let clientOverride: AssistantClient | null | undefined;
export function setAssistantClientForTests(client: AssistantClient | null | undefined) {
  clientOverride = client;
}

const settingSchema = z.object({
  aiEnabled: z.boolean().optional(),
  actionsEnabled: z.boolean().optional(),
});

/** `GET /api/v1/assistant/settings`: the workspace opt-in, and whether a provider key is set. */
export const assistantSettingsGetRoute: RouteDef<undefined, true> = {
  can: 'assistant:use',
  handler: async ({ actor, tenant }) => ({
    ...(await tenant((tx) => getAiSetting(tx, actor))),
    configured: clientOverride !== undefined ? clientOverride !== null : assistantConfigured(),
  }),
};

/** `PUT /api/v1/assistant/settings`: turn the assistant on or off. Managers only. */
export const assistantSettingsPutRoute: RouteDef<typeof settingSchema, true> = {
  can: 'settings:org:update',
  input: settingSchema,
  handler: ({ actor, input, tenant }) =>
    tenant(async (tx) => {
      let setting = await getAiSetting(tx, actor);
      if (input.aiEnabled !== undefined) setting = await setAiSetting(tx, actor, input.aiEnabled);
      if (input.actionsEnabled !== undefined) {
        setting = await setAiActionsEnabled(tx, actor, input.actionsEnabled);
      }
      return setting;
    }),
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
    tenant(async (tx) => ({
      ...(await getAiConversation(tx, actor, params.id ?? '')),
      actions: await listAiActions(tx, actor, params.id ?? ''),
    })),
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
    const { org, history, allowActions, conversationId, created } = await tenant(async (tx) => {
      await assertAiEnabled(tx, actor);
      const setting = await getAiSetting(tx, actor);
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: actor.orgId },
        select: { name: true, timezone: true },
      });
      const history = input.conversationId
        ? (await getAiConversation(tx, actor, input.conversationId)).messages.slice(-20)
        : [];
      // Proposals belong to a conversation, so a new one is created before the model runs.
      const conversationId =
        input.conversationId ?? (await createAiConversation(tx, actor, question));
      return {
        org,
        history,
        allowActions: setting.actionsEnabled && canUseAssistantActions(actor),
        conversationId,
        created: !input.conversationId,
      };
    });

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: org.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'long',
    }).format(new Date());
    let result;
    try {
      result = await runAssistantTurn(client, {
        history: history.map((m) => ({ role: m.role, body: m.body })),
        question,
        context: {
          today,
          timezone: org.timezone,
          workspaceName: org.name,
        },
        allowActions,
        runTool: (name, toolInput) =>
          tenant((tx) =>
            ACTION_TOOL_NAMES.includes(name)
              ? runActionTool(tx, actor, name, toolInput, { conversationId })
              : runAssistantTool(tx, actor, name, toolInput),
          ),
      });
    } catch (err) {
      // A brand-new conversation with no answer is not worth keeping.
      if (created) await tenant((tx) => deleteAiConversation(tx, actor, conversationId));
      throw err;
    }

    const saved = await tenant(async (tx) => {
      const messages = await appendAiExchange(tx, actor, conversationId, {
        question,
        answer: result.answer,
        toolsUsed: result.toolsUsed,
      });
      const answerId = messages.find((m) => m.role === 'assistant')?.id;
      if (answerId) await linkAiActions(tx, actor, result.actionIds, answerId);
      const actions = (await listAiActions(tx, actor, conversationId)).filter((a) =>
        result.actionIds.includes(a.id),
      );
      return { conversationId, messages, actions };
    });
    return new ApiResult(saved, { status: input.conversationId ? 200 : 201 });
  },
};

/**
 * `POST /api/v1/assistant/actions/:id/confirm`: applies a proposal for the coach who asked for it. Uses the same
 * domain functions and permissions as the screens. A failed check rolls the change back and marks the proposal failed.
 */
export const assistantActionConfirmRoute: RouteDef<undefined, true> = {
  can: 'assistant:use',
  rateLimit: { capacity: 60, refillPerSecond: 60 / 3600 },
  handler: async ({ actor, params, tenant, requestId }) => {
    const id = params.id ?? '';
    try {
      return await tenant((tx) => applyAiAction(tx, actor, id, { requestId }));
    } catch (err) {
      if (err instanceof DomainError && err.code !== 'NOT_FOUND' && err.code !== 'CONFLICT') {
        await tenant((tx) => markAiActionFailed(tx, actor, id, err.message));
      }
      throw err;
    }
  },
};

/** `POST /api/v1/assistant/actions/:id/cancel`. */
export const assistantActionCancelRoute: RouteDef<undefined, true> = {
  can: 'assistant:use',
  handler: ({ actor, params, tenant }) =>
    tenant((tx) => cancelAiAction(tx, actor, params.id ?? '')),
};
