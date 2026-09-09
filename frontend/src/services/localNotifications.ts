export type LocalStudyNotification = {
  id: number;
  title: string;
  message: string;
  notify_at: string;
  delivered_at?: string | null;
  is_read: boolean;
  type: string;
  status?: string | null;
  channel?: string | null;
};

export const LOCAL_NOTIFICATIONS_EVENT = 'slt:local-notifications:changed';
export const REMOTE_NOTIFICATIONS_EVENT = 'slt:remote-notifications:changed';

const MAX_LOCAL_NOTIFICATIONS = 50;

const getLocalNotificationsKey = (userId?: number | null) =>
  `slt::localNotifications::user:${userId ?? 'guest'}`;

const safeJsonParse = (raw: string | null) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const emitLocalNotificationsChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(LOCAL_NOTIFICATIONS_EVENT));
};

export const emitRemoteNotificationsChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(REMOTE_NOTIFICATIONS_EVENT));
};

export const readLocalNotifications = (userId?: number | null): LocalStudyNotification[] => {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(getLocalNotificationsKey(userId));
  const parsed = safeJsonParse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as LocalStudyNotification[];
};

export const writeLocalNotifications = (userId: number | null | undefined, items: LocalStudyNotification[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getLocalNotificationsKey(userId), JSON.stringify(items));
};

const createLocalId = () => {
 
  const base = Date.now();
  const jitter = Math.floor(Math.random() * 1000);
  return -(base + jitter);
};

export const addLocalNotification = (
  userId: number | null | undefined,
  input: {
    title: string;
    message: string;
    type: string;
    notify_at?: string;
  }
) => {
  const nowIso = new Date().toISOString();
  const item: LocalStudyNotification = {
    id: createLocalId(),
    title: input.title,
    message: input.message,
    type: input.type,
    notify_at: input.notify_at ?? nowIso,
    delivered_at: null,
    is_read: false,
    status: null,
    channel: 'local',
  };

  const existing = readLocalNotifications(userId);
  const next = [item, ...existing].slice(0, MAX_LOCAL_NOTIFICATIONS);
  writeLocalNotifications(userId, next);
  emitLocalNotificationsChanged();
  return item;
};

export const markLocalNotificationAsRead = (userId: number | null | undefined, id: number) => {
  const existing = readLocalNotifications(userId);
  const next = existing.map(item => (item.id === id ? { ...item, is_read: true } : item));
  writeLocalNotifications(userId, next);
  emitLocalNotificationsChanged();
};

export const markLocalNotificationAsDelivered = (userId: number | null | undefined, id: number, deliveredAt: string) => {
  const existing = readLocalNotifications(userId);
  const next = existing.map(item => (
    item.id === id && !item.delivered_at ? { ...item, delivered_at: deliveredAt } : item
  ));
  writeLocalNotifications(userId, next);
  emitLocalNotificationsChanged();
};

export const deleteLocalNotification = (userId: number | null | undefined, id: number) => {
  const existing = readLocalNotifications(userId);
  const next = existing.filter(item => item.id !== id);
  writeLocalNotifications(userId, next);
  emitLocalNotificationsChanged();
};

export const updateLocalNotificationTime = (
  userId: number | null | undefined,
  id: number,
  notifyAt: string
) => {
  const existing = readLocalNotifications(userId);
  const next = existing.map(item => (item.id === id ? { ...item, notify_at: notifyAt } : item));
  writeLocalNotifications(userId, next);
  emitLocalNotificationsChanged();
};
