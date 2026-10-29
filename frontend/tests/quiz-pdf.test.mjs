import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the page's extraction helper with browser/PDF/network boundaries mocked.
const source = readFileSync(new URL('../src/pages/dashboard/QuizLibraryPage.tsx', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('const extractPdfTextInBrowser ='), source.indexOf('const extractErrorMessage ='));
const js = ts.transpile(helper.replace("await import('pdfjs-dist')", 'pdfjsMock'), { target: ts.ScriptTarget.ES2022 });

function setup(texts, ocrError = null) {
  const calls = [];
  const state = { destroyed: false, cleaned: 0 };
  const pdf = {
    numPages: texts.length,
    async getPage(number) {
      return {
        getTextContent: async () => ({ items: [{ str: texts[number - 1] }] }),
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => { state.cleaned++; },
      };
    },
  };
  const pdfjs = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => { state.destroyed = true; } }) };
  const api = { post: async (url, form) => {
    calls.push({ url, file: form.get('images[]') });
    if (ocrError) throw ocrError;
    return { data: { text: 'ข้อความจากภาพ' } };
  } };
  const document = { createElement: () => ({ getContext: () => ({}), toBlob: callback => callback(new Blob(['image'], { type: 'image/jpeg' })) }) };
  const extract = new Function('pdfjsMock', 'PdfWorker', 'api', 'document', `${js}; return extractPdfTextInBrowser;`)(pdfjs, class {}, api, document);
  return { extract: () => extract(new Blob(['pdf']), () => {}), calls, state };
}

test('text PDF uses its text without requesting OCR', async () => {
  const run = setup(['เนื้อหาเอกสาร']);
  assert.equal(await run.extract(), 'เนื้อหาเอกสาร');
  assert.equal(run.calls.length, 0);
  assert.equal(run.state.destroyed, true);
});

test('mixed PDF retains text and OCR pages in document order', async () => {
  const run = setup(['หน้าแรก', '', 'หน้าสุดท้าย']);
  assert.equal(await run.extract(), 'หน้าแรก\n\nข้อความจากภาพ\n\nหน้าสุดท้าย');
  assert.equal(run.calls[0].url, '/ai/analyze/document');
  assert.equal(run.calls[0].file.name, 'pdf-page-2.jpg');
  assert.equal(run.calls[0].file.type, 'image/jpeg');
  assert.equal(run.state.cleaned, 3);
  assert.equal(run.state.destroyed, true);
});

test('scanned PDF uses OCR', async () => {
  const run = setup(['']);
  assert.equal(await run.extract(), 'ข้อความจากภาพ');
  assert.equal(run.calls.length, 1);
});

test('OCR failure rejects extraction and releases the PDF', async () => {
  const run = setup([''], new Error('OCR unavailable'));
  await assert.rejects(run.extract, /OCR unavailable/);
  assert.equal(run.state.destroyed, true);
});
