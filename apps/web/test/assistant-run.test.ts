import { describe, expect, it } from 'vitest';
import type OpenAI from 'openai';
import {
  DEFAULT_ASSISTANT_MODEL,
  assistantClient,
  runAssistantTurn,
  type AssistantClient,
} from '@/server/assistant/run';

type Params = OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
type Reply = {
  finish_reason: OpenAI.Chat.ChatCompletion.Choice['finish_reason'];
  content?: string | null;
  refusal?: string | null;
  tool_calls?: { id: string; name: string; args: unknown }[];
};

function fakeClient(replies: Reply[], model?: string) {
  const calls: Params[] = [];
  const client = {
    model,
    chat: {
      completions: {
        create: async (params: Params) => {
          calls.push(structuredClone(params));
          const next = replies.shift();
          if (!next) throw new Error('no more replies');
          return {
            choices: [
              {
                index: 0,
                finish_reason: next.finish_reason,
                message: {
                  role: 'assistant',
                  content: next.content ?? null,
                  refusal: next.refusal ?? null,
                  tool_calls: next.tool_calls?.map((c) => ({
                    id: c.id,
                    type: 'function',
                    function: {
                      name: c.name,
                      arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args),
                    },
                  })),
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as AssistantClient;
  return { client, calls };
}

const context = { today: 'Friday, 2026-11-06', timezone: 'Asia/Kolkata', workspaceName: 'Gym' };
const toolNames = (p?: Params) =>
  (p?.tools ?? []).map((t) => (t.type === 'function' ? t.function.name : ''));

describe('runAssistantTurn (PRD I15, D-021)', () => {
  it('runs the tools the model asks for, then returns the answer and the tools used', async () => {
    const { client, calls } = fakeClient([
      {
        finish_reason: 'tool_calls',
        tool_calls: [
          { id: 't1', name: 'list_clients', args: { search: '', status: 'any' } },
          { id: 't2', name: 'get_client', args: { clientId: 'x' } },
        ],
      },
      { finish_reason: 'stop', content: 'Asha missed two workouts.' },
    ]);
    const ran: [string, unknown][] = [];
    const result = await runAssistantTurn(client, {
      history: [
        { role: 'user', body: 'Hi' },
        { role: 'assistant', body: 'Hello' },
      ],
      question: 'Who missed workouts?',
      context,
      runTool: async (name, input) => {
        ran.push([name, input]);
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
    expect(ran).toEqual([
      ['list_clients', { search: '', status: 'any' }],
      ['get_client', { clientId: 'x' }],
    ]);
    expect(calls[0]?.model).toBe(DEFAULT_ASSISTANT_MODEL);
    const tools = calls[0]?.tools ?? [];
    expect(tools.every((t) => t.type === 'function' && t.function.strict === true)).toBe(true);
    // Without actions the model is not offered the propose tools.
    expect(toolNames(calls[0]).some((n) => n.startsWith('propose_'))).toBe(false);
    // System prompt first, then history, then the question with today's date; one tool message per call.
    const second = calls[1]?.messages ?? [];
    expect(second[0]?.role).toBe('system');
    expect(second[3]?.content).toContain('Today is Friday, 2026-11-06');
    expect(
      second.slice(5).map((m) => [m.role, (m as { tool_call_id?: string }).tool_call_id]),
    ).toEqual([
      ['tool', 't1'],
      ['tool', 't2'],
    ]);
    expect(second[6]?.content).toMatch(/^Error: No client/);
  });

  it('answers politely on a refusal', async () => {
    const { client } = fakeClient([{ finish_reason: 'stop', refusal: 'No.' }]);
    const result = await runAssistantTurn(client, {
      history: [],
      question: 'x',
      context,
      runTool: async () => ({ ok: true, content: '{}' }),
    });
    expect(result.answer).toMatch(/can't help/);
  });

  it('sends malformed tool arguments back as an error without running the tool', async () => {
    const { client, calls } = fakeClient([
      { finish_reason: 'tool_calls', tool_calls: [{ id: 't', name: 'get_client', args: '{bad' }] },
      { finish_reason: 'stop', content: 'Done.' },
    ]);
    let ran = 0;
    await runAssistantTurn(client, {
      history: [],
      question: 'x',
      context,
      runTool: async () => {
        ran++;
        return { ok: true, content: '{}' };
      },
    });
    expect(ran).toBe(0);
    expect(calls[1]?.messages.at(-1)?.content).toMatch(/not valid JSON/);
  });

  it('stops after the round limit instead of looping forever', async () => {
    const loop: Reply = {
      finish_reason: 'tool_calls',
      tool_calls: [{ id: 't', name: 'list_programs', args: { search: '' } }],
    };
    const { client, calls } = fakeClient(
      Array.from({ length: 20 }, () => structuredClone(loop)),
      'gpt-test',
    );
    const result = await runAssistantTurn(client, {
      history: [],
      question: 'x',
      context,
      runTool: async () => ({ ok: true, content: '[]' }),
    });
    expect(calls).toHaveLength(10);
    expect(calls[0]?.model).toBe('gpt-test');
    expect(result.answer).toMatch(/narrower question/);
  });

  it('offers the propose tools only when actions are allowed and collects the proposal ids', async () => {
    const { client, calls } = fakeClient([
      {
        finish_reason: 'tool_calls',
        tool_calls: [
          { id: 't1', name: 'propose_nutrition_targets', args: { clientId: 'c' } },
          { id: 't2', name: 'propose_meal_plan', args: { clientId: 'c' } },
        ],
      },
      { finish_reason: 'stop', content: 'Proposed. Press Confirm to apply.' },
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
    expect(toolNames(calls[0])).toContain('propose_meal_plan');
    expect(calls[0]?.messages[0]?.content).toMatch(/Confirm/);
  });

  it('builds a client only when OPENAI_API_KEY is set, with OPENAI_MODEL when given', () => {
    expect(assistantClient({})).toBeNull();
    expect(assistantClient({ OPENAI_API_KEY: 'k' })?.model).toBe(DEFAULT_ASSISTANT_MODEL);
    expect(assistantClient({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-x' })?.model).toBe('gpt-x');
  });
});
