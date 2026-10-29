import test from 'node:test';
import assert from 'node:assert/strict';
import { startLiveTranscription } from '../src/utils/liveTranscription.ts';

test('interim results update immediately, revisions do not duplicate, and sessions restart', () => {
  let recognition;
  class Recognition {
    constructor() { recognition = this; }
    start() {}
    abort() {}
  }
  const texts = [];
  const stop = startLiveTranscription({ Recognition, stream: {}, mimeType: 'audio/webm',
    onText: text => texts.push(text), onStatus() {}, transcribe: async () => '' });
  const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });
  recognition.onresult({ results: [result('สวัสดี', false)] });
  recognition.onresult({ results: [result('สวัสดีครับ', true)] });
  recognition.onresult({ results: [result('สวัสดีครับ', true), result('วันนี้', false)] });
  assert.deepEqual(texts, ['สวัสดี', 'สวัสดีครับ', 'สวัสดีครับ วันนี้']);
  recognition.onend();
  recognition.onresult({ results: [result('เรียน', true)] });
  assert.equal(texts.at(-1), 'สวัสดีครับ เรียน');
  stop();
  assert.equal(recognition.onend, null);
});

test('unavailable recognition uses complete audio clips and ignores late responses after stop', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let recorder;
  class Recorder {
    state = 'inactive';
    constructor() { recorder = this; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob(['complete audio']) });
      this.onstop?.();
    }
  }
  const previous = globalThis.MediaRecorder;
  globalThis.MediaRecorder = Recorder;
  t.after(() => { globalThis.MediaRecorder = previous; });
  let resolve;
  let signal;
  let calls = 0;
  const texts = [];
  const stop = startLiveTranscription({ stream: {}, mimeType: 'audio/webm',
    onText: text => texts.push(text), onStatus() {},
    transcribe: (audio, abortSignal) => {
      assert.equal(audio.size, 14);
      signal = abortSignal;
      calls++;
      return new Promise(done => { resolve = done; });
    } });
  t.mock.timers.tick(5000);
  assert.equal(calls, 1);
  assert.equal(recorder.state, 'recording');
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
  resolve('ข้อความสด');
  await Promise.resolve();
  assert.deepEqual(texts, ['ข้อความสด']);
  t.mock.timers.tick(5000);
  assert.equal(calls, 2);
  stop();
  resolve('ผลลัพธ์เก่า');
  await Promise.resolve();
  assert.deepEqual(texts, ['ข้อความสด']);
  assert.equal(signal.aborted, true);
  assert.equal(recorder.state, 'inactive');
});

for (const trigger of ['error', 'timeout']) {
  test(`browser recognition ${trigger} switches to server preview without restarting recognition`, t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    let recognition;
    let starts = 0;
    let previews = 0;
    class Recognition {
      constructor() { recognition = this; }
      start() { starts++; }
      abort() {}
    }
    const previous = globalThis.MediaRecorder;
    globalThis.MediaRecorder = class {
      state = 'inactive';
      start() { this.state = 'recording'; previews++; }
      stop() { this.state = 'inactive'; }
    };
    t.after(() => { globalThis.MediaRecorder = previous; });
    const stop = startLiveTranscription({ Recognition, stream: {}, mimeType: 'audio/webm',
      onText() {}, onStatus() {}, transcribe: async () => '' });
    if (trigger === 'error') recognition.onerror({ error: 'network' });
    else t.mock.timers.tick(8000);
    assert.equal(previews, 1);
    assert.equal(starts, 1);
    assert.equal(recognition.onend, null);
    stop();
  });
}
