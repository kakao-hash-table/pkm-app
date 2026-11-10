import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const start = source.indexOf('async function chSend(){'), end = source.indexOf('async function chAnswer(', start);
assert.ok(start >= 0 && end > start);

test('챗봇 전송은 AI 연결에서 고른 provider·model·effort를 매번 읽어서 보낸다', async () => {
  let prefs = { provider: 'codex', model: 'gpt-test', effort: 'high' };
  const sent = [], box = { value: 'GPT로 답해 줘' }, CH = { sending: false, err: '', room: 'data', rooms: {}, view: 'log' };
  const ctx = vm.createContext({
    CH, PKMAI: { prefs: () => prefs }, $: () => box, LS: { set() {} }, chDraftKey: () => 'draft', chSum: () => ({}),
    capi: async (url, body) => { sent.push({ url, body: JSON.parse(JSON.stringify(body)) }); return { id: body.id, text: body.text, status: 'queued' }; },
    S: { profile:'개인' }, CH_MEDIA:new Map(), chMediaKey: () => 'media', chMediaDraft: () => [], chMediaPaint() {},
    chLoad: async () => {}, chPaint() {},
  });
  vm.runInContext(source.slice(start, end), ctx);
  await ctx.chSend();
  assert.equal(sent[0].url, '/data/send');
  assert.equal(sent[0].body.provider, 'codex'); assert.equal(sent[0].body.model, 'gpt-test'); assert.equal(sent[0].body.effort, 'high');
  prefs = { provider: 'claude', model: 'fable', effort: null }; box.value = 'Claude로 답해 줘';
  await ctx.chSend();
  assert.equal(sent[1].body.provider, 'claude'); assert.equal(sent[1].body.model, 'fable'); assert.equal(sent[1].body.effort, null);
  prefs = { provider: null }; box.value = '선택 안 함';
  await ctx.chSend();
  assert.equal(sent.length, 2); assert.match(CH.err, /쓸 AI를 먼저/); assert.equal(box.value, '선택 안 함');
});

test('다른 AI로 이어서 버튼은 선택한 AI와 다른 대기 요청에만 나온다', () => {
  const a = source.indexOf('function chHandoffHTML('), b = source.indexOf('function chTurn(', a);
  assert.ok(a >= 0 && b > a);
  const ctx = vm.createContext({ PKMAI: { prefs: () => ({ provider: 'codex' }) }, AI_NAME: { codex: 'GPT' }, CH: {}, esc: String });
  vm.runInContext(source.slice(a, b), ctx);
  assert.match(ctx.chHandoffHTML('data', { id: 'one', status: 'waiting', provider: 'claude' }), /GPT로 이어서/);
  assert.match(ctx.chHandoffHTML('data', { id: 'old', status: 'queued' }), /GPT로 이어서/, '옛 Claude 요청도 지원한다');
  for (const turn of [{ status: 'running', provider: 'claude' }, { status: 'waiting', provider: 'codex' }, { status: 'waiting', provider: 'claude', continued_by: 'new' }]) assert.equal(ctx.chHandoffHTML('data', turn), '');
});

test('전환 버튼은 대상 턴과 현재 AI 설정을 전환 API에 보낸다', async () => {
  const a = source.indexOf('async function chHandoff('), b = source.indexOf("document.addEventListener('click'", a);
  assert.ok(a >= 0 && b > a);
  const sent = [], CH = {}, ctx = vm.createContext({ CH, PKMAI: { prefs: () => ({ provider: 'codex', model: 'gpt-test', effort: 'high' }) },
    capi: async (url, body) => sent.push({ url, body }), chPaint() {}, chLoad: async () => {}, LS: { set() {} } });
  vm.runInContext(source.slice(a, b), ctx);
  await ctx.chHandoff('card-one', 'old-turn');
  assert.equal(sent[0].url, '/card-one/handoff');
  assert.equal(sent[0].body.turn_id, 'old-turn'); assert.equal(sent[0].body.provider, 'codex');
  assert.equal(sent[0].body.model, 'gpt-test'); assert.equal(sent[0].body.effort, 'high');
  assert.equal(CH.handoffBusy, false); assert.equal(CH.view, 'log');
});
