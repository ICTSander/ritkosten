/**
 * Trip alerts: local notifications that vibrate the phone even when the app is closed —
 * a few minutes before boarding and just before you need to get off. Native only (no web).
 * Asked for at a logical moment: when the user starts the live trip ("Start reis").
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { TripStep } from '../domain/tripSteps';
import { formatNlClock } from '../domain/nlTime';

const CHANNEL = 'trip-alerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export type AlertStatus = 'scheduled' | 'denied' | 'unsupported';

export interface PlannedAlert {
  at: number;
  title: string;
  body: string;
}

/** Pure: which alerts a trip needs (tested). */
export function planTripAlerts(steps: TripStep[], now: number): PlannedAlert[] {
  const alerts: PlannedAlert[] = [];
  for (const s of steps) {
    const where = s.platform ? ` · ${s.platformWord ?? 'spoor'} ${s.platform}` : '';
    if (s.kind === 'board') {
      alerts.push({
        at: s.deadline - 3 * 60_000,
        title: `${s.title} over 3 min`,
        body: `Vertrek ${formatNlClock(new Date(s.deadline).toISOString())}${where}`,
      });
    }
    if (s.kind === 'ride') {
      alerts.push({ at: s.deadline - 2 * 60_000, title: 'Bijna uitstappen', body: `${s.title.replace('Uitstappen in ', '')} over 2 min${where}` });
      alerts.push({ at: s.deadline, title: 'Stap nu uit', body: s.title.replace('Uitstappen in ', '') });
    }
  }
  return alerts.filter((a) => a.at > now + 5_000);
}

export async function enableTripAlerts(steps: TripStep[]): Promise<AlertStatus> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.status === 'granted' || (await Notifications.requestPermissionsAsync()).status === 'granted';
    if (!granted) return 'denied';
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Reismeldingen',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 400, 200, 400],
      });
    }
    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const a of planTripAlerts(steps, Date.now())) {
      await Notifications.scheduleNotificationAsync({
        content: { title: a.title, body: a.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(a.at), channelId: CHANNEL },
      });
    }
    return 'scheduled';
  } catch {
    return 'unsupported';
  }
}

export async function cancelTripAlerts(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // ignore
  }
}
