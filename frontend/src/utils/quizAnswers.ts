export const displayQuizAnswer = (value?: string | null, type?: string) => {
  if (!value?.trim()) return 'ไม่ได้ตอบ';
  if (type === 'true_false') {
    const answer = value.trim().toLowerCase();
    if (['true', 'ถูก', 'จริง', 'ใช่', 'yes'].includes(answer)) return 'ถูก';
    if (['false', 'ผิด', 'เท็จ', 'ไม่ใช่', 'no'].includes(answer)) return 'ผิด';
  }
  return value;
};
