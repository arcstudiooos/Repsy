import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { newClientWorld, newOrg, runAs, type ClientWorld } from '../sessions/fixtures.test-helpers';
import { ASSISTANT_TOOLS, runAssistantTool } from './assistantTools';
import {
  appendAiExchange,
  createAiConversation,
  deleteAiConversation,
  getAiConversation,
  listAiConversations,
} from './conversations';
import { assertAiEnabled, getAiSetting, setAiSetting } from './settings';

/** PRD I15 against Postgres: the assistant's tools stay inside the workspace and the actor's role. */
let prisma: PrismaClient;
let drop: () => Promise<void>;
let a: ClientWorld;
let b: ClientWorld;
let assistant: ActorContext;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  a = await newClientWorld(prisma, await newOrg(prisma));
  b = await newClientWorld(prisma, await newOrg(prisma));
  const userId = await withSystem(async (tx) => {
    const u = await tx.user.create({ data: { email: 'asst@example.test', name: 'Asst' } });
    await tx.membership.create({
      data: { userId: u.id, organizationId: a.orgId, role: 'assistant' },
    });
    return u.id;
  }, prisma);
  assistant = { userId, orgId: a.orgId, role: 'assistant', isPlatformAdmin: false };
});
afterAll(async () => {
  await drop();
});

const tool = (actor: ActorContext, name: string, input: unknown) =>
  runAs(prisma, actor, (tx) => runAssistantTool(tx, actor, name, input));

describe('assistant tools', () => {
  it('every tool schema is strict-ready: all properties required, no extras', () => {
    for (const t of ASSISTANT_TOOLS) {
      expect(t.input_schema.additionalProperties).toBe(false);
      expect(Object.keys(t.input_schema.properties).sort()).toEqual([...t.input_schema.required].sort());
    }
  });

  it('list_clients sees only its own workspace', async () => {
    const res = await tool(a.coach, 'list_clients', { search: '', status: 'any' });
    expect(res.ok).toBe(true);
    const ids = (JSON.parse(res.content) as { clients: { id: string }[] }).clients.map((c) => c.id);
    expect(ids).toContain(a.clientId);
    expect(ids).not.toContain(b.clientId);
  });

  it("get_client cannot read another workspace's client", async () => {
    const res = await tool(a.coach, 'get_client', { clientId: b.clientId });
    expect(res).toEqual({ ok: false, content: 'No client with that id in this workspace.' });
    const own = await tool(a.coach, 'get_client', { clientId: a.clientId });
    expect(own.ok).toBe(true);
    expect(JSON.parse(own.content)).toMatchObject({ profile: { id: a.clientId } });
  });

  it('get_program returns the plan with exercises', async () => {
    const res = await tool(a.coach, 'get_program', { programId: a.templateId });
    expect(res.ok).toBe(true);
    expect((JSON.parse(res.content) as { days: unknown[] }).days.length).toBeGreaterThan(0);
  });

  it('an assistant-role user cannot see business numbers', async () => {
    const res = await tool(assistant, 'business_summary', { days: 30 });
    expect(res).toEqual({ ok: false, content: 'Your role cannot see this information.' });
    const owner = await tool(a.coach, 'business_summary', { days: 30 });
    expect(owner.ok).toBe(true);
  });

  it('unknown tools and bad dates come back as errors, not crashes', async () => {
    expect((await tool(a.coach, 'delete_everything', {})).ok).toBe(false);
    expect(await tool(a.coach, 'list_bookings', { fromDate: 'soon', toDate: 'later' })).toEqual({
      ok: false,
      content: 'Dates must be YYYY-MM-DD.',
    });
  });

  it('the other read tools run', async () => {
    for (const [name, input] of [
      ['list_programs', { search: '' }],
      ['workout_activity', { days: 30 }],
      ['list_checkins', { days: 30, state: 'any' }],
      ['recent_messages', { clientId: a.clientId, limit: 10 }],
      ['list_bookings', { fromDate: '2026-11-01', toDate: '2026-11-30' }],
    ] as const) {
      expect((await tool(a.coach, name, input)).ok, name).toBe(true);
    }
  });
});

describe('assistant settings and conversations', () => {
  it('is off by default and only managers can turn it on', async () => {
    expect(await runAs(prisma, a.coach, (tx) => getAiSetting(tx, a.coach))).toMatchObject({
      aiEnabled: false,
    });
    await expect(runAs(prisma, a.coach, (tx) => assertAiEnabled(tx, a.coach))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      runAs(prisma, assistant, (tx) => setAiSetting(tx, assistant, true)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await runAs(prisma, a.coach, (tx) => setAiSetting(tx, a.coach, true));
    await runAs(prisma, a.coach, (tx) => assertAiEnabled(tx, a.coach));
  });

  it('conversations are private to the user who started them', async () => {
    const id = await runAs(prisma, a.coach, (tx) => createAiConversation(tx, a.coach, 'Who trained?'));
    await runAs(prisma, a.coach, (tx) =>
      appendAiExchange(tx, a.coach, id, {
        question: 'Who trained?',
        answer: 'Everyone.',
        toolsUsed: ['workout_activity', 'workout_activity'],
      }),
    );
    const mine = await runAs(prisma, a.coach, (tx) => getAiConversation(tx, a.coach, id));
    expect(mine.messages.map((m) => [m.role, m.body, m.toolsUsed])).toEqual([
      ['user', 'Who trained?', []],
      ['assistant', 'Everyone.', ['workout_activity']],
    ]);
    expect(await runAs(prisma, assistant, (tx) => listAiConversations(tx, assistant))).toEqual([]);
    await expect(
      runAs(prisma, assistant, (tx) => getAiConversation(tx, assistant, id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      runAs(prisma, b.coach, (tx) => getAiConversation(tx, b.coach, id)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await runAs(prisma, a.coach, (tx) => deleteAiConversation(tx, a.coach, id));
    expect(await runAs(prisma, a.coach, (tx) => listAiConversations(tx, a.coach))).toEqual([]);
  });
});
