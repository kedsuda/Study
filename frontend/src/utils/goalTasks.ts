export type GoalTask = {
  id: number;
  title: string;
  description: string | null;
  task_date: string;
  start_time: string | null;
  end_time: string | null;
  completed: boolean;
};
export type TaskPeriod = 'day' | 'week' | 'month';

export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const shiftDate = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};
export const taskBounds = (value: string, period: TaskPeriod) => {
  const date = new Date(`${value}T12:00:00`);
  if (period === 'day') return { start: value, end: value };
  if (period === 'week') {
    const start = shiftDate(value, -((date.getDay() + 6) % 7));
    return { start, end: shiftDate(start, 6) };
  }
  return { start: dateKey(new Date(date.getFullYear(), date.getMonth(), 1)), end: dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)) };
};
export const tasksInPeriod = (tasks: GoalTask[], date: string, period: TaskPeriod) => {
  const { start, end } = taskBounds(date, period);
  return tasks.filter(task => task.task_date >= start && task.task_date <= end);
};
export const taskProgress = (tasks: GoalTask[]) => {
  const completed = tasks.filter(task => task.completed).length;
  return { total: tasks.length, completed, percent: tasks.length ? Math.round(completed / tasks.length * 100) : 0 };
};
