import { StyleSheet, View } from 'react-native';

import type { TransitItinerary } from '../domain/transit';
import { Icon } from './Icon';
import { lineColors, MODE_ICON } from './transit';
import { useModeColors, usePalette } from './theme';

/**
 * Journey progress: one segment per leg (width ∝ duration), walking dotted, rides solid,
 * a node at every change, the mode icon under each segment, and green filling up as time passes.
 */
export function TripProgress({
  itinerary,
  progress,
  viewingLeg,
}: {
  itinerary: TransitItinerary;
  progress: number;
  /** Leg of the step the user is looking at (when browsing steps) — gets a marker under it. */
  viewingLeg?: number;
}) {
  const c = usePalette();
  const modeColors = useModeColors();
  const legs = itinerary.legs;
  const total = legs.reduce((s, l) => s + Math.max(l.durationMin, 2), 0) || 1;
  const pct = Math.round(progress * 100);

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Reisvoortgang ${pct} procent`}
      accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={styles.track}>
        {legs.map((leg, i) => {
          // Same colour as the line badge elsewhere in the app (official line colour when known).
          const color = lineColors(leg)?.badge ?? modeColors[leg.mode].line;
          const viewing = viewingLeg === i;
          return (
          <View key={i} style={[styles.segment, { flexGrow: Math.max(leg.durationMin, 2) / total }]}>
            <View style={styles.lineRow}>
              {i > 0 ? <View style={[styles.node, { borderColor: c.textSecondary, backgroundColor: c.bg }]} /> : null}
              {leg.mode === 'walk' ? (
                <View style={[styles.dotted, { borderColor: c.textTertiary }]} />
              ) : (
                <View style={[styles.solid, { backgroundColor: color, opacity: 0.45 }]} />
              )}
            </View>
            <View style={styles.iconRow}>
              <Icon name={MODE_ICON[leg.mode]} size={viewing ? 18 : 14} color={viewing ? c.accent : leg.mode === 'walk' ? c.textSecondary : modeColors[leg.mode].line} />
              {viewing ? <View style={[styles.viewing, { backgroundColor: c.accent }]} /> : null}
            </View>
          </View>
          );
        })}
        {/* Filled part */}
        <View pointerEvents="none" style={[styles.fill, { width: `${pct}%`, backgroundColor: c.success }]} />
        <View pointerEvents="none" style={[styles.marker, { left: `${pct}%`, backgroundColor: c.success, borderColor: c.bg }]} />
      </View>
    </View>
  );
}

const LINE_Y = 10;

const styles = StyleSheet.create({
  wrap: { paddingVertical: 6 },
  track: { flexDirection: 'row', position: 'relative' },
  segment: { flexBasis: 0, minWidth: 18 },
  lineRow: { height: 20, flexDirection: 'row', alignItems: 'center' },
  solid: { flex: 1, height: 12, borderRadius: 6 },
  dotted: { flex: 1, borderTopWidth: 4, borderStyle: 'dotted', marginHorizontal: 2 },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginHorizontal: -2, zIndex: 1 },
  iconRow: { alignItems: 'center', marginTop: 6, gap: 3 },
  viewing: { width: 16, height: 4, borderRadius: 2 },
  fill: { position: 'absolute', left: 0, top: LINE_Y - 6, height: 12, borderRadius: 6 },
  marker: { position: 'absolute', top: LINE_Y - 10, width: 20, height: 20, borderRadius: 10, borderWidth: 4, marginLeft: -10 },
});
