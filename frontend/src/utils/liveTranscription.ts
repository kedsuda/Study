// Each server preview is a complete recording, including its container header.
// MediaRecorder timeslice fragments alone are not independently decodable.
export function startLiveTranscription(options: {
  stream: MediaStream;
  mimeType: string;
  Recognition?: any;
  transcribe: (audio: Blob, signal: AbortSignal) => Promise<string>;
  onText: (text: string) => void;
  onStatus: (text: string) => void;
}) {
  let stopped = false;
  let fallback = false;
  let committed = '';
  let recognition: any;
  let preview: MediaRecorder | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  const controller = new AbortController();
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const detachRecognition = () => {
    if (!recognition) return;
    recognition.onend = recognition.onerror = recognition.onresult = null;
    try { recognition.abort(); } catch { /* Already ended. */ }
  };
  const startFallback = () => {
    if (stopped || fallback) return;
    fallback = true;
    clearTimeout(watchdog);
    detachRecognition();
    options.onStatus('กำลังบันทึกเสียงและถอดเสียงผ่านเซิร์ฟเวอร์ ข้อความจะอัปเดตเป็นช่วงสั้น ๆ...');
    try {
      preview = new MediaRecorder(options.stream, { mimeType: options.mimeType });
      let parts: Blob[] = [];
      preview.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      preview.onstop = async () => {
        if (stopped) return;
        const audio = new Blob(parts, { type: options.mimeType });
        parts = [];
        busy = true;
        try {
          preview!.start();
          const text = normalize(await options.transcribe(audio, controller.signal));
          if (!stopped && text) {
            committed = normalize(`${committed} ${text}`);
            options.onText(committed);
            options.onStatus('กำลังบันทึกเสียงและถอดเสียงผ่านเซิร์ฟเวอร์...');
          }
        } catch {
          if (!stopped) options.onStatus('ยังถอดเสียงช่วงนี้ไม่ได้ กำลังลองช่วงถัดไป และจะถอดเสียงทั้งหมดอีกครั้งเมื่อหยุดอัด');
        } finally { busy = false; }
      };
      preview.start();
      interval = setInterval(() => {
        if (!busy && preview?.state === 'recording') preview.stop();
      }, 5000);
    } catch {
      options.onStatus('ถอดเสียงสดไม่พร้อมใช้งาน ระบบจะถอดเสียงเมื่อหยุดอัด');
    }
  };
  if (options.Recognition) {
    try {
      recognition = new options.Recognition();
      recognition.lang = 'th-TH';
      recognition.continuous = true;
      recognition.interimResults = true;
      let sessionBase = '';
      recognition.onresult = (event: any) => {
        if (stopped || fallback) return;
        clearTimeout(watchdog);
        const finals: string[] = [];
        const interim: string[] = [];
        // Rebuild the current session so revised results never duplicate text.
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          (result.isFinal ? finals : interim).push(result[0]?.transcript ?? '');
        }
        committed = normalize([sessionBase, ...finals].join(' '));
        options.onText(normalize([committed, ...interim].join(' ')));
      };
      recognition.onerror = startFallback;
      recognition.onend = () => {
        if (stopped || fallback) return;
        sessionBase = committed;
        try { recognition.start(); } catch { startFallback(); }
      };
      recognition.start();
      // Some browsers expose the API but never deliver results or errors.
      watchdog = setTimeout(startFallback, 8000);
    } catch { startFallback(); }
  } else { startFallback(); }
  return () => {
    stopped = true;
    clearTimeout(watchdog);
    clearInterval(interval);
    controller.abort();
    detachRecognition();
    if (preview) {
      preview.onstop = preview.ondataavailable = null;
      if (preview.state !== 'inactive') preview.stop();
    }
  };
}
