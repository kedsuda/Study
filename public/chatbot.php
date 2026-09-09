<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>เครื่องมือเพิ่มตารางเรียน</title>
  <style>
    :root {
      --bg: #f3f6fb;
      --panel: #ffffff;
      --primary: #0f766e;
      --text: #0f172a;
      --muted: #64748b;
      --border: #d9e2ec;
      --user: #134e4a;
      --assistant: #1e293b;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, sans-serif;
      background: radial-gradient(circle at top left, #e2f4ff 0%, var(--bg) 45%, #edf8f3 100%);
      min-height: 100vh;
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .chat-shell {
      width: min(1080px, 100%);
      height: min(90vh, 860px);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 20px 45px rgba(2, 32, 71, 0.15);
      display: grid;
      grid-template-rows: auto 1fr auto;
      overflow: hidden;
    }

    .chat-header {
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .chat-title {
      font-size: 18px;
      font-weight: 700;
      margin: 0;
    }

    .chat-sub {
      margin: 4px 0 0;
      font-size: 13px;
      color: var(--muted);
    }

    .model-select {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
      background: #fff;
      font-size: 13px;
      color: var(--text);
    }

    .messages {
      padding: 18px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: linear-gradient(180deg, #fafcff 0%, #f8fbff 45%, #f7fff9 100%);
    }

    .msg {
      max-width: 82%;
      padding: 11px 14px;
      border-radius: 12px;
      white-space: pre-wrap;
      line-height: 1.5;
      font-size: 14px;
    }

    .msg.user {
      align-self: flex-end;
      background: #d2f7f2;
      color: var(--user);
      border: 1px solid #b7efe7;
    }

    .msg.assistant {
      align-self: flex-start;
      background: #fff;
      color: var(--assistant);
      border: 1px solid #d8e2f1;
    }

    .msg.system {
      align-self: center;
      background: #ecfeff;
      color: #155e75;
      border: 1px solid #c8edf3;
      font-size: 13px;
    }

    .composer {
      border-top: 1px solid var(--border);
      padding: 14px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      background: #fff;
    }

    .input {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      font-size: 14px;
      resize: none;
      min-height: 52px;
      max-height: 160px;
      outline: none;
    }

    .input:focus {
      border-color: #7dd3fc;
      box-shadow: 0 0 0 3px rgba(125, 211, 252, 0.25);
    }

    .send {
      border: none;
      border-radius: 12px;
      padding: 0 18px;
      background: var(--primary);
      color: white;
      font-weight: 600;
      cursor: pointer;
      min-width: 96px;
    }

    .send:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    @media (max-width: 768px) {
      body { padding: 10px; }
      .chat-shell { height: 94vh; border-radius: 14px; }
      .chat-header { flex-direction: column; align-items: flex-start; }
      .msg { max-width: 92%; }
      .composer { grid-template-columns: 1fr; }
      .send { height: 44px; }
    }
  </style>
</head>
<body>
  <div class="chat-shell">
    <div class="chat-header">
      <div>
        <h1 class="chat-title">เครื่องมือเพิ่มตารางเรียน</h1>
        <p class="chat-sub">เพิ่มได้หลายวิชา ตรวจภาคเรียนของรายวิชา และใช้รูปแบบวัน/เดือน/ปี เวลา ห้องเรียน และภาคเรียน</p>
      </div>
      <select id="model" class="model-select">
        <option value="openai/gpt-oss-20b">GPT-OSS 20B</option>
        <option value="openai/gpt-oss-120b">GPT-OSS 120B</option>
      </select>
    </div>

    <div id="messages" class="messages"></div>

    <form id="chatForm" class="composer">
      <textarea id="input" class="input" placeholder="เช่น เพิ่มวิชา คณิต วันจันทร์ วันที่ 12/08/2569 09:00-12:00 ห้อง 102 ภาคเรียนที่ 1 ปีการศึกษา 2569" required></textarea>
      <button id="sendBtn" class="send" type="submit">ส่ง</button>
    </form>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const chatForm = document.getElementById('chatForm');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const modelEl = document.getElementById('model');

    const history = [];

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = `msg ${role}`;
      div.textContent = content;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    addMessage('system', 'พร้อมใช้งาน: เพิ่มวิชาได้หลายรายการโดยแยกคนละบรรทัด และถามได้ว่าวิชาไหนอยู่เทอมอะไร');

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.requestSubmit();
      }
    });

    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const message = inputEl.value.trim();
      if (!message) {
        return;
      }

      addMessage('user', message);
      history.push({ role: 'user', content: message });
      inputEl.value = '';
      inputEl.style.height = '52px';
      sendBtn.disabled = true;

      try {
        const res = await fetch('chatbot_api.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            model: modelEl.value,
            history: history.slice(-12)
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Unknown error');
        }

        const reply = data.reply || '(ไม่มีข้อความตอบกลับ)';
        addMessage('assistant', reply);
        history.push({ role: 'assistant', content: reply });
      } catch (err) {
        addMessage('system', 'เกิดข้อผิดพลาด: ' + err.message);
      } finally {
        sendBtn.disabled = false;
        inputEl.focus();
      }
    });

    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
    });
  </script>
</body>
</html>
