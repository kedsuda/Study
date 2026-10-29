export type GoalType = 'study_sessions' | 'study_minutes' | 'quiz_mastery';
export type GoalState = {
  goal_type: GoalType;
  target_sessions: number;
  target_minutes: number;
  target_questions: number;
  target_quiz_sets: number;
  current_activities: number;
  current_minutes: number;
  current_questions: number;
  current_quiz_sets: number;
  progress_percent: number;
  status: 'achieved' | 'not_achieved' | 'not_set';
};
export const goalTypes = {
  study_sessions: { label: 'กิจกรรมการเรียน', unit: 'กิจกรรม', field: 'target_sessions', max: 999, hint: 'นับบันทึกการเรียนและสรุปที่บันทึกไว้ รวมกับการส่งแบบทดสอบแต่ละครั้ง' },
  study_minutes: { label: 'เวลาเรียน', unit: 'นาที', field: 'target_minutes', max: 99999, hint: 'นับเวลาจากบันทึกการเรียนของวิชานี้ในช่วงเวลาที่เลือก' },
  quiz_mastery: { label: 'การทำแบบทดสอบ', unit: 'ชุด', field: 'target_quiz_sets', max: 999, hint: 'นับการส่งแบบทดสอบแต่ละครั้ง รวมการทำซ้ำ โดยไม่ใช้คะแนนผ่านเป็นเงื่อนไข' },
} as const;
export const describeGoal = (goal: GoalState) => {
  const type = goal.goal_type in goalTypes ? goal.goal_type : 'quiz_mastery';
  const metrics = type === 'study_minutes'
    ? [{ current: goal.current_minutes, target: goal.target_minutes, unit: 'นาที' }]
    : type === 'study_sessions'
      ? [{ current: goal.current_activities, target: goal.target_sessions, unit: 'กิจกรรม' }]
      : [
          { current: goal.current_quiz_sets, target: goal.target_quiz_sets, unit: 'ชุด' },
          { current: goal.current_questions, target: goal.target_questions, unit: 'ข้อ' },
        ];
  const hasTarget = goal.status !== 'not_set' && metrics.some(metric => metric.target > 0);
  return {
    type, ...goalTypes[type], metrics: metrics.filter(metric => metric.target > 0), hasTarget,
    completed: hasTarget && goal.status === 'achieved',
    statusLabel: !hasTarget ? 'ยังไม่ได้ตั้งเป้า' : goal.status === 'achieved' ? 'บรรลุเป้าหมายแล้ว' : 'กำลังสะสมความคืบหน้า',
    percent: hasTarget ? Math.max(0, Math.min(100, goal.progress_percent || 0)) : 0,
  };
};
