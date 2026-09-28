import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { formatNlClock, nlLocalToIso, toNlLocal } from '../domain/nlTime';
import type { TimeQuery } from '../domain/transit';
import { AppText, Button, Chip, Segmented } from './components';
import { fonts, space, usePalette } from './theme';

const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

export function timeQueryLabel(q: TimeQuery): string {
  if (q.kind === 'now') return 'Vertrek nu';
  const t = toNlLocal(q.at);
  const today = toNlLocal(Date.now());
  const sameDay = t.year === today.year && t.month === today.month && t.day === today.day;
  const day = sameDay ? '' : `${DAYS[t.weekday]} ${t.day}-${t.month} `;
  return `${q.kind === 'depart' ? 'Vertrek' : 'Aankomst'} ${day}${formatNlClock(q.at)}`;
}

/**
 * Compact picker: now / depart at / arrive at, a day chip row and a 5-minute stepper.
 * `arriveOnly` turns it into the "Hoe laat wil je er zijn?" step. No native module needed.
 */
export function TimePicker({
  value,
  onDone,
  arriveOnly = false,
  submitLabel = 'Toon reizen',
}: {
  value: TimeQuery;
  onDone: (q: TimeQuery) => void;
  arriveOnly?: boolean;
  submitLabel?: string;
}) {
  const c = usePalette();
  const [kind, setKind] = useState<TimeQuery['kind']>(arriveOnly ? 'arrive' : value.kind);
  const [openedAt] = useState(() => Date.now());
  // Reuse the previous choice only if it is still in the future.
  const [initial] = useState(() =>
    value.kind !== 'now' && Date.parse(value.at) > openedAt
      ? Date.parse(value.at)
      : arriveOnly
        ? defaultArrival(openedAt)
        : roundUp5(openedAt),
  );
  const [dayOffset, setDayOffset] = useState(() => dayDiff(initial, openedAt));
  const [minutes, setMinutes] = useState(() => toNlLocal(initial).minutes);
  const [today] = useState(() => toNlLocal(openedAt));

  const bump = (delta: number) => setMinutes((m) => (m + delta + 1440) % 1440);
  /** Text while the user types a time on the clock; null = show the formatted time. */
  const [typing, setTyping] = useState<string | null>(null);
  const commitTyped = () => {
    if (typing !== null) {
      const parsed = parseClock(typing);
      if (parsed !== null) setMinutes(parsed);
    }
    setTyping(null);
  };
  const clockText = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const iso = () => {
    // Local midnight of today + dayOffset, then the chosen clock time.
    const base = Date.UTC(today.year, today.month - 1, today.day + dayOffset, 12);
    const d = new Date(base);
    return nlLocalToIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), Math.floor(minutes / 60), minutes % 60);
  };
  // An arrival (or departure) that has already passed can't be planned.
  const inPast = kind !== 'now' && dayOffset === 0 && minutes <= today.minutes + (kind === 'arrive' ? 5 : -1);

  return (
    <View style={{ gap: space.lg }}>
      {arriveOnly ? null : (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'now', label: 'Nu' },
            { value: 'depart', label: 'Vertrek om' },
            { value: 'arrive', label: 'Aankomst om' },
          ]}
        />
      )}
      {kind !== 'now' ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const label = d === 0 ? 'Vandaag' : d === 1 ? 'Morgen' : DAYS[(today.weekday + d) % 7];
              return <Chip key={d} label={label} selected={dayOffset === d} onPress={() => setDayOffset(d)} />;
            })}
          </ScrollView>
          {/* The time on its own line, so it always fits. Tap it to type a time ("9", "930", "9:30"). */}
          <TextInput
            value={typing ?? clockText}
            onFocus={() => setTyping('')}
            onChangeText={setTyping}
            onBlur={commitTyped}
            onSubmitEditing={commitTyped}
            placeholder={clockText}
            placeholderTextColor={c.textTertiary}
            keyboardType="numbers-and-punctuation"
            returnKeyType="done"
            maxLength={5}
            selectTextOnFocus
            accessibilityLabel={`${kind === 'arrive' ? 'Aankomsttijd' : 'Vertrektijd'} ${Math.floor(minutes / 60)} uur ${minutes % 60}. Tik om een tijd te typen`}
            style={[styles.clock, { color: inPast ? c.textTertiary : c.text, outlineStyle: 'none' } as never]}
          />
          <AppText variant="footnote" color={c.textSecondary} style={{ textAlign: 'center', marginTop: -space.md }}>
            Tik op de tijd om hem te typen
          </AppText>
          <View style={styles.clockRow}>
            <Step label="1 uur eerder" text="−1 u" onPress={() => bump(-60)} />
            <Step label="15 minuten eerder" text="−15" onPress={() => bump(-15)} />
            <Step label="15 minuten later" text="+15" onPress={() => bump(15)} />
            <Step label="1 uur later" text="+1 u" onPress={() => bump(60)} />
          </View>
          {inPast ? (
            <AppText variant="footnote" color={c.warning} accessibilityLiveRegion="polite">
              Dat tijdstip is vandaag al voorbij. Kies een latere tijd of een andere dag.
            </AppText>
          ) : null}
        </>
      ) : null}
      <Button
        title={submitLabel}
        disabled={inPast}
        onPress={() => onDone(kind === 'now' ? { kind: 'now' } : { kind, at: iso() })}
      />
    </View>
  );
}

function Step({ text, label, onPress }: { text: string; label: string; onPress: () => void }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.step, { backgroundColor: c.surface, borderColor: c.separator, borderBottomColor: c.edge, borderBottomWidth: pressed ? 2 : 5, marginTop: pressed ? 3 : 0 }]}>
      <AppText variant="callout" color={c.accent} style={{ fontFamily: fonts.mono }}>
        {text}
      </AppText>
    </Pressable>
  );
}

/** "9" → 9:00, "930" / "0930" / "9:30" / "9.30" → 9:30. Null when it isn't a valid time. */
export function parseClock(text: string): number | null {
  const t = text.trim().replace('.', ':');
  let h: number;
  let m: number;
  if (/^\d{1,2}:\d{1,2}$/.test(t)) [h, m] = t.split(':').map(Number) as [number, number];
  else if (/^\d{1,2}$/.test(t)) [h, m] = [Number(t), 0];
  else if (/^\d{3,4}$/.test(t)) [h, m] = [Number(t.slice(0, -2)), Number(t.slice(-2))];
  else return null;
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** Arrive in about an hour — but late at night that makes no sense, so then: tomorrow 09:00. */
export function defaultArrival(nowMs: number): number {
  const candidate = roundUp15(nowMs) + 60 * 60_000;
  const local = toNlLocal(candidate);
  if (local.minutes >= 6 * 60 && local.minutes <= 22 * 60) return candidate;
  const now = toNlLocal(nowMs);
  const addDay = now.minutes >= 6 * 60 ? 1 : 0;
  const d = new Date(Date.UTC(now.year, now.month - 1, now.day + addDay, 12));
  return Date.parse(nlLocalToIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 9, 0));
}

function roundUp5(ms: number): number {
  const step = 5 * 60_000;
  return Math.ceil(ms / step) * step;
}

function roundUp15(ms: number): number {
  const step = 15 * 60_000;
  return Math.ceil(ms / step) * step;
}

function dayDiff(ms: number, nowMs: number): number {
  const a = toNlLocal(ms);
  const b = toNlLocal(nowMs);
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const db = Date.UTC(b.year, b.month - 1, b.day);
  return Math.max(0, Math.min(6, Math.round((da - db) / 86_400_000)));
}

const styles = StyleSheet.create({
  days: { flexDirection: 'row', gap: space.sm, paddingBottom: 2 },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  clock: { fontFamily: fonts.monoBold, fontSize: 56, lineHeight: 64, height: 68, textAlign: 'center', fontVariant: ['tabular-nums'], paddingVertical: 0 },
  step: { flex: 1, height: 48, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
