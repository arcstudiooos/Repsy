import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { ASSISTANT_MODEL, runAssistantTurn, type AssistantClient } from '@/server/assistant/run';

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

function fakeClient(replies: Partial<Anthropic.Beta.BetaMessage>[]) {
  const calls: Params[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Params) => {
          calls.push(structuredClone(params));
          const next = replies.shift();
          if (!next) throw new Error('no more replies');
          return next as Anthropic.Beta.BetaMessage;
        },
      },
    },
  } as unknown as AssistantClient;
  return { client, calls };
}

const context = { today: 'Friday, 2026-11-06', timezone: 'Asia/Kolkata', workspaceName: 'Gym' };

describe('runAssistantTurn (PRD I15)', () => {
  it('runs the tools Claude asks for, then returns the answer and the tools used', async () => {
    const { client, calls } = fakeClient([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'list_clients',
            input: { search: '', status: 'any' },
          },
          { type: 'tool_use', id: 't2', name: 'get_client', input: { clientId: 'x' } },
        ] as Anthropic.Beta.BetaContentBlock[],
      },
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Asha missed two workouts.' },
        ] as Anthropic.Beta.BetaContentBlock[],
      },
    ]);
    const ran: string[] = [];
    const result = await runAssistantTurn(client, {
      history: [
        { role: 'user', body: 'Hi' },
        { role: 'assistant', body: 'Hello' },
      ],
      question: 'Who missed workouts?',
      context,
      runTool: async (name) => {
        ran.push(name);
        return name === 'get_client'
          ? { ok: false, content: 'No client with that id in this workspace.' }
          : { ok: true, content: '{"clients":[]}' };
      },
    });
    expect(result).toEqual({
      answer: 'Asha missed two workouts.',
      toolsUsed: ['list_clients', 'get_client'],
      actionIds: [],
    });
    expect(ran).toEqual(['list_clients', 'get_client']);
    expect(calls[0]).toMatchObject({
      model: ASSISTANT_MODEL,
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    expect(calls[0]?.tools?.every((t) => 'strict' in t && t.strict === true)).toBe(true);
    // Without actions the model is not offered the propose tools.
    expect(calls[0]?.tools?.some((t) => 'name' in t && t.name.startsWith('propose_'))).toBe(false);
    // History first, then the question with today's date; tool results go back in one user turn.
    const second = calls[1]?.messages ?? [];
    expect(second[2]?.content).toContain('Today is Friday, 2026-11-06');
    const results = second[4]?.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ['t1', false],
      ['t2', true],
    ]);
  });

  it('answers politely on a refusal', async () => {
    const { client } = fakeClient([{ stop_reason: 'refusal', content: [] }]);
    const result = await runAssistantTurn(client, {
      history: [],
      question: 'x',
      context,
      runTool: async () => ({ ok: true, content: '{}' }),
    });
    expect(result.answer).toMatch(/can't help/);
  });

  it('stops after the round limit instead of looping forever', async () => {
    const loop = {
      stop_reason: 'tool_use' as const,
      content: [
        { type: 'tool_use', id: 't', name: 'list_programs', input: { search: '' } },
      ] as Anthropic.Beta.BetaContentBlock[],
    };
    const { client, calls } = fakeClient(Array.from({ length: 20 }, () => ({ ...loop })));
    const result = await runAssistantTurn(client, {
      history: [],
      question: 'x',
      context,
      runTool: async () => ({ ok: true, content: '[]' }),
    });
    expect(calls).toHaveLength(10);
    expect(result.answer).toMatch(/narrower question/);
  });

  it('offers the propose tools only when actions are allowed and collects the proposal ids', async () => {
    const { client, calls } = fakeClient([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'propose_nutrition_targets',
            input: { clientId: 'c' },
          },
          { type: 'tool_use', id: 't2', name: 'propose_meal_plan', input: { clientId: 'c' } },
        ] as Anthropic.Beta.BetaContentBlock[],
      },
      {
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Proposed. Press Confirm to apply.' },
        ] as Anthropic.Beta.BetaContentBlock[],
      },
    ]);
    const result = await runAssistantTurn(client, {
      history: [],
      question: 'Set Asha up',
      context,
      allowActions: true,
      runTool: async (name) =>
        name === 'propose_nutrition_targets'
          ? { ok: true, content: 'Proposed.', actionId: 'a1' }
          : { ok: false, content: 'Tuesday: calories 900 (-1100)' },
    });
    expect(result.actionIds).toEqual(['a1']);
    expect(calls[0]?.tools?.some((t) => 'name' in t && t.name === 'propose_meal_plan')).toBe(true);
    expect(calls[0]?.system).toBeDefined();
    expect(JSON.stringify(calls[0]?.system)).toMatch(/Confirm/);
  });
});
