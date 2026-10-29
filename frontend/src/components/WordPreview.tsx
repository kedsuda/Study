import { useEffect, useState } from 'react';

type WordPreviewProps = {
  url: string;
  name: string;
};

export function WordPreview({ url, name }: WordPreviewProps) {
  const [documentHtml, setDocumentHtml] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setDocumentHtml('');
    setFailed(false);

    async function loadDocument() {
      try {
        const [response, { renderAsync }] = await Promise.all([
          fetch(url, { signal: controller.signal }),
          import('docx-preview'),
        ]);
        if (!response.ok) throw new Error(`Document request failed: ${response.status}`);
        const data = await response.arrayBuffer();
        if (!active) return;

        // Render away from the app DOM; document styles belong only in the sandboxed frame.
        const content = document.createElement('div');
        const styles = document.createElement('div');
        await renderAsync(data, content, styles, {
          useBase64URL: true,
          renderAltChunks: false,
          ignoreLastRenderedPageBreak: false,
        });
        if (!active) return;

        setDocumentHtml(`<!doctype html><html><head><meta charset="utf-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline';">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          ${styles.innerHTML}
          <style>body{margin:0;background:#f1f5f9}.docx-wrapper{padding:24px;min-width:fit-content} .docx-wrapper>section.docx{margin-bottom:24px}</style>
          </head><body>${content.innerHTML}</body></html>`);
      } catch {
        if (active) setFailed(true);
      }
    }

    void loadDocument();
    return () => {
      active = false;
      controller.abort();
    };
  }, [url]);

  if (failed) {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="font-semibold text-slate-800">ไม่สามารถแสดงตัวอย่างไฟล์ Word นี้ได้</p>
        <p className="text-sm text-slate-500">กรุณาลองเปิดใหม่ หรือคลิก "เปิดไฟล์เต็ม" เพื่อดาวน์โหลด</p>
      </div>
    );
  }

  if (!documentHtml) {
    return <div role="status" className="flex h-full items-center justify-center text-sm text-slate-500">กำลังโหลดไฟล์ Word...</div>;
  }

  return <iframe title={name} sandbox="" srcDoc={documentHtml} className="h-full w-full border-0" />;
}
