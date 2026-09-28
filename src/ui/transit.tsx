import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatDuration } from '../domain/format';
import { formatNlClock } from '../domain/nlTime';
import { type Leg, type LegMode, minutesBetween, type TransitItinerary } from '../domain/transit';
import { AppText } from './components';
import { Icon, type IconName } from './Icon';
import { fonts, radius, space, useModeColors, usePalette } from './theme';

export const MODE_ICON: Record<LegMode, IconName> = {
  walk: 'walk',
  bus: 'bus',
  tram: 'tram',
  metro: 'metro',
  train: 'train',
  ferry: 'ferry',
  other: 'transit',
};

export const MODE_WORD: Record<LegMode, string> = {
  walk: 'Lopen',
  bus: 'Bus',
  tram: 'Tram',
  metro: 'Metro',
  train: 'Trein',
  ferry: 'Veerboot',
  other: 'OV',
};

/** Short badge text: "IC", "Sprinter", "44", "M52". */
export function lineLabel(leg: Leg): string {
  const line = leg.line ?? '';
  if (leg.mode === 'train') {
    if (/^intercity/i.test(line)) return 'IC';
    if (/^sprinter/i.test(line)) return 'SPR';
    // "Stoptrein RS15" / "Sneltrein RE18" → "RS15" / "RE18"
    const coded = /^(stoptrein|sneltrein|stopbus|trein)\s+(\S+)/i.exec(line);
    if (coded) return coded[2];
    if (/^stoptrein/i.test(line)) return 'Stop';
    return line || 'Trein';
  }
  return line;
}

/** Icon + line name on the mode colour. Always icon + text, never colour alone. */
export function ModeBadge({ leg, compact = false }: { leg: Leg; compact?: boolean }) {
  const colors = useModeColors()[leg.mode];
  const label = lineLabel(leg);
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.badge, borderColor: leg.mode === 'train' ? '#8A6400' : colors.badge },
        compact && { height: 24, paddingHorizontal: 6 },
      ]}
      accessibilityLabel={`${MODE_WORD[leg.mode]} ${label}`}>
      <Icon name={MODE_ICON[leg.mode]} size={compact ? 13 : 15} color={colors.text} />
      {label ? (
        <AppText
          variant="caption"
          color={colors.text}
          style={{ fontFamily: fonts.monoBold, fontSize: compact ? 12 : 13, textDecorationLine: leg.cancelled ? 'line-through' : 'none' }}
          numberOfLines={1}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

/** Chain of leg badges; walking shown as a small icon + minutes. Transfers read from the chain. */
export function LegStrip({ itinerary }: { itinerary: TransitItinerary }) {
  const c = usePalette();
  return (
    <View style={styles.strip}>
      {itinerary.legs.map((leg, i) => (
        <View key={i} style={styles.stripItem}>
          {i > 0 ? <Icon name="chevron" size={10} color={c.textTertiary} /> : null}
          {leg.mode === 'walk' ? (
            <View style={styles.walk} accessibilityLabel={`Lopen ${leg.durationMin} minuten`}>
              <Icon name="walk" size={14} color={c.textSecondary} />
              <AppText variant="caption" color={c.textSecondary} style={{ fontFamily: fonts.mono }}>
                {leg.durationMin}
              </AppText>
            </View>
          ) : (
            <ModeBadge leg={leg} compact />
          )}
        </View>
      ))}
    </View>
  );
}

/** Time with realtime state: struck-through planned time + actual in warning colour. */
export function TimeText({ planned, actual, cancelled, big }: { planned: string; actual: string; cancelled?: boolean; big?: boolean }) {
  const c = usePalette();
  const delay = minutesBetween(planned, actual);
  const style = { fontFamily: fonts.mono, fontSize: big ? 17 : 15 };
  if (cancelled) {
    return (
      <AppText style={[style, { textDecorationLine: 'line-through' }]} color={c.error}>
        {formatNlClock(planned)}
      </AppText>
    );
  }
  if (delay >= 1) {
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <AppText style={style} color={c.warning} accessibilityLabel={`${formatNlClock(actual)}, ${delay} minuten later`}>
          {formatNlClock(actual)}
        </AppText>
        <AppText variant="caption" color={c.textTertiary} style={{ fontFamily: fonts.mono, textDecorationLine: 'line-through' }}>
          {formatNlClock(planned)}
        </AppText>
      </View>
    );
  }
  return <AppText style={style}>{formatNlClock(actual)}</AppText>;
}

function PlatformChip({ stop }: { stop: Leg['from'] }) {
  const c = usePalette();
  if (!stop.platform) return null;
  const changed = !!stop.plannedPlatform && stop.plannedPlatform !== stop.platform;
  return (
    <View
      style={[styles.platform, { backgroundColor: changed ? c.warning : c.accent }]}
      accessibilityLabel={`Spoor ${stop.platform}${changed ? `, gewijzigd van ${stop.plannedPlatform}` : ''}`}>
      <AppText variant="caption" color={changed ? '#FFFFFF' : c.onAccent} style={{ fontFamily: fonts.monoBold }}>
        {changed ? '! ' : ''}
        {stop.platform}
      </AppText>
    </View>
  );
}

/** Full door-to-door timeline: time | rail | content. Walking dashed, rides solid in mode colour. */
export function LegTimeline({ itinerary, destinationLabel, startLabel }: { itinerary: TransitItinerary; destinationLabel: string; startLabel: string }) {
  const c = usePalette();
  const modeColors = useModeColors();
  const legs = itinerary.legs;

  return (
    <View>
      {legs.map((leg, i) => {
        const next = legs[i + 1];
        const fromName = leg.from.name || (i === 0 ? startLabel : '');
        const toName = leg.to.name || (i === legs.length - 1 ? destinationLabel : '');
        const color = modeColors[leg.mode].line;
        // Transfer margin between two vehicle legs (via a walking leg or directly).
        const prevVehicle = legs.slice(0, i).reverse().find((l) => l.mode !== 'walk');
        const transferMargin =
          leg.mode !== 'walk' && prevVehicle ? minutesBetween(prevVehicle.arrival, leg.departure) - (legs[i - 1]?.mode === 'walk' ? legs[i - 1].durationMin : 0) : null;

        return (
          <View key={i}>
            {transferMargin !== null && transferMargin >= 0 && transferMargin < 3 ? (
              <View style={[styles.transferWarn, { backgroundColor: c.warningSoft }]}>
                <Icon name="warning" size={14} color={c.warning} />
                <AppText variant="footnote">Krappe overstap: {transferMargin} min speling</AppText>
              </View>
            ) : null}
            {leg.mode === 'walk' ? (
              <WalkRow leg={leg} fromName={fromName} toName={toName} color={color} />
            ) : (
              <RideRow leg={leg} fromName={fromName} toName={toName} color={leg.cancelled ? c.error : color} />
            )}
            {!next ? (
              <View style={styles.row}>
                <View style={styles.timeCol}>
                  <TimeText planned={leg.plannedArrival} actual={leg.arrival} big />
                </View>
                <View style={styles.railCol}>
                  <View style={[styles.endDot, { backgroundColor: c.text }]}>
                    <Icon name="pin" size={10} color={c.bg} />
                  </View>
                </View>
                <View style={styles.content}>
                  <AppText variant="headline">Aankomst</AppText>
                  <AppText variant="footnote" color={c.textSecondary}>
                    {toName}
                  </AppText>
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function WalkRow({ leg, fromName, toName, color }: { leg: Leg; fromName: string; toName: string; color: string }) {
  const c = usePalette();
  const meters = leg.distanceMeters ? (leg.distanceMeters >= 1000 ? `${(leg.distanceMeters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(leg.distanceMeters / 10) * 10} m`) : '';
  return (
    <View style={styles.row} accessible accessibilityLabel={`Lopen, ${leg.durationMin} minuten${meters ? `, ${meters}` : ''}, naar ${toName}`}>
      <View style={styles.timeCol}>
        <TimeText planned={leg.plannedDeparture} actual={leg.departure} />
      </View>
      <View style={styles.railCol}>
        <View style={[styles.ring, { borderColor: color, backgroundColor: c.surface }]} />
        <View style={[styles.dashed, { borderColor: color }]} />
      </View>
      <View style={[styles.content, { paddingBottom: space.lg }]}>
        <AppText variant="callout" color={c.textSecondary} numberOfLines={1}>
          {fromName}
        </AppText>
        <View style={styles.walkLine}>
          <Icon name="walk" size={16} color={c.textSecondary} />
          <AppText variant="footnote" color={c.textSecondary}>
            Lopen · {leg.durationMin} min{meters ? ` · ${meters}` : ''}
            {toName ? ` naar ${toName}` : ''}
          </AppText>
        </View>
      </View>
    </View>
  );
}

function RideRow({ leg, fromName, toName, color }: { leg: Leg; fromName: string; toName: string; color: string }) {
  const c = usePalette();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.row}>
      <View style={styles.timeCol}>
        <TimeText planned={leg.plannedDeparture} actual={leg.departure} cancelled={leg.cancelled} big />
        <View style={{ flex: 1 }} />
        <TimeText planned={leg.plannedArrival} actual={leg.arrival} cancelled={leg.cancelled} />
      </View>
      <View style={styles.railCol}>
        <View style={[styles.ring, { borderColor: color, backgroundColor: c.surface }]} />
        <View style={[styles.solid, { backgroundColor: color }, leg.cancelled && { opacity: 0.5 }]} />
        <View style={[styles.ring, { borderColor: color, backgroundColor: c.surface }]} />
      </View>
      <View style={[styles.content, { paddingBottom: space.lg, gap: 6 }]}>
        <View style={styles.rideHead}>
          <AppText variant="headline" style={{ flexShrink: 1 }} numberOfLines={2}>
            {fromName}
          </AppText>
          <PlatformChip stop={leg.from} />
        </View>
        <View style={styles.rideMeta}>
          <ModeBadge leg={leg} />
          <AppText variant="footnote" color={c.textSecondary} style={{ flex: 1 }} numberOfLines={2}>
            {leg.headsign ? `richting ${leg.headsign}` : MODE_WORD[leg.mode]}
            {leg.operator ? ` · ${leg.operator}` : ''}
          </AppText>
        </View>
        {leg.cancelled ? (
          <AppText variant="callout" color={c.error}>
            Deze rit rijdt niet.
          </AppText>
        ) : null}
        <Pressable
          onPress={() => setOpen((o) => !o)}
          disabled={leg.intermediateStops === 0}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.stopsToggle}>
          <AppText variant="footnote" color={c.textSecondary}>
            {formatDuration(leg.durationMin)}
            {leg.intermediateStops > 0 ? ` · ${leg.intermediateStops} tussenstops` : ' · rijdt door'}
            {leg.realtime ? ' · live' : ''}
          </AppText>
          {leg.intermediateStops > 0 ? <Icon name="chevronDown" size={14} color={c.textSecondary} /> : null}
        </Pressable>
        {open && leg.tripNumber ? (
          <AppText variant="caption" color={c.textTertiary}>
            Ritnummer {leg.tripNumber}
          </AppText>
        ) : null}
        <View style={styles.rideHead}>
          <AppText variant="callout" numberOfLines={2} style={{ flexShrink: 1 }}>
            {toName}
          </AppText>
          <PlatformChip stop={leg.to} />
        </View>
      </View>
    </View>
  );
}

/** Side-view train drawing (our own — NS images carry the NS logo, which we may not use). */
function TrainArt({ parts, doubleDeck }: { parts: number; doubleDeck: boolean }) {
  const colors = useModeColors().train;
  const cars = Math.max(2, Math.min(parts, 8));
  return (
    <View accessibilityElementsHidden importantForAccessibility="no">
      <View style={styles.trainArt}>
        {Array.from({ length: cars }, (_, i) => (
          <View
            key={i}
            style={[
              styles.car,
              { borderColor: colors.line, height: doubleDeck ? 40 : 28 },
              i === 0 && { borderTopLeftRadius: 16 },
              i === cars - 1 && { borderTopRightRadius: 16 },
            ]}>
            {Array.from({ length: doubleDeck ? 2 : 1 }, (_, row) => (
              <View key={row} style={styles.windows}>
                {Array.from({ length: cars > 5 ? 2 : 4 }, (_, w) => (
                  <View key={w} style={[styles.window, { backgroundColor: colors.line, opacity: 0.35 }]} />
                ))}
              </View>
            ))}
          </View>
        ))}
      </View>
      <View style={[styles.track, { backgroundColor: colors.line }]} />
    </View>
  );
}

/** Generic card when no NS details are available. */
export function TrainCard({ leg }: { leg: Leg }) {
  const c = usePalette();
  return (
    <View style={[styles.trainCard, { backgroundColor: c.surfaceMuted }]}>
      <TrainArt parts={3} doubleDeck={/intercity|^ic/i.test(leg.line ?? '')} />
      <AppText variant="headline" style={{ marginTop: space.md }}>
        {leg.line ?? 'Trein'}
        {leg.operator ? ` · ${leg.operator}` : ''}
      </AppText>
      <AppText variant="footnote" color={c.textSecondary}>
        {leg.from.name} → {leg.to.name} · {formatNlClock(leg.departure)} → {formatNlClock(leg.arrival)}
      </AppText>
      <AppText variant="caption" color={c.textTertiary} style={{ marginTop: 4 }}>
        Illustratie
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 6 },
  stripItem: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  walk: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  row: { flexDirection: 'row', minHeight: 56 },
  timeCol: { width: 56, alignItems: 'flex-end', paddingRight: 8, paddingTop: 1, paddingBottom: space.lg },
  railCol: { width: 24, alignItems: 'center' },
  content: { flex: 1, paddingLeft: space.sm },
  ring: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, zIndex: 1 },
  endDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  solid: { width: 5, flex: 1, marginVertical: -2 },
  dashed: { flex: 1, borderLeftWidth: 2, borderStyle: 'dashed', marginVertical: 2 },
  walkLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  rideHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  rideMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stopsToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
  platform: { minWidth: 28, height: 24, paddingHorizontal: 6, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  transferWarn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: space.sm, borderRadius: 10, marginLeft: 80, marginBottom: space.sm },
  trainCard: { borderRadius: radius.card, padding: space.lg, marginTop: space.xl },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 17 },
  bar: { width: 5, borderRadius: 2 },
  facilities: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  facility: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  trainArt: { flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 48 },
  car: { flex: 1, borderWidth: 2, borderRadius: 6, justifyContent: 'space-evenly', paddingHorizontal: 6 },
  windows: { flexDirection: 'row', gap: 4 },
  window: { flex: 1, height: 7, borderRadius: 2 },
  track: { height: 2, marginTop: 4, borderRadius: 1, opacity: 0.6 },
});
