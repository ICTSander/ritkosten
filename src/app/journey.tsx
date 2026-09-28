import { Redirect, router } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { calculatePublicTransportCost } from '@/domain/fare/engine';
import { FARE_DATA_2026 } from '@/domain/fare/tariffs';
import { formatDuration, formatEuroCents } from '@/domain/format';
import { formatNlClock } from '@/domain/nlTime';
import { useApp } from '@/state/store';
import { openDirections } from '@/services/maps';
import { AppText, Button, Card, Header, ListRow, Screen, SectionLabel } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { hasNsTrainInfo, nsTrainInfoAvailable } from '@/services/transit/nsTrainInfo';
import { LegTimeline, TrainCard } from '@/ui/transit';
import { fonts, space, usePalette } from '@/ui/theme';

export default function JourneyScreen() {
  const c = usePalette();
  const itinerary = useApp((s) => s.selectedItinerary);
  const destination = useApp((s) => s.destination);
  const profile = useApp((s) => s.transitProfile);
  const startMode = useApp((s) => s.startMode);
  const manualStart = useApp((s) => s.manualStart);

  if (!itinerary || !destination) return <Redirect href="/" />;

  const fare = calculatePublicTransportCost(itinerary, profile, FARE_DATA_2026);
  const trains = itinerary.legs.filter((l) => l.mode === 'train');
  // Live NS details (crowding, stock, seats…) for every NS train, when the NS proxy is set up.
  const nsTrains = nsTrainInfoAvailable() ? trains.filter(hasNsTrainInfo) : [];
  const longestTrain = [...trains].sort((a, b) => b.durationMin - a.durationMin)[0];
  const startLabel = startMode === 'device' ? 'Huidige locatie' : (manualStart?.label ?? 'Start');
  const delays = itinerary.legs.filter((l) => (l.delayMin ?? 0) > 0 || l.cancelled);

  return (
    <Screen
      scroll
      header={<Header title="Jouw reis" />}
      footer={
        <>
          <Button title="Terug naar vergelijking" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/compare'))} />
          <Button
            title="Open in Google Maps"
            icon="map"
            variant="plain"
            onPress={() => openDirections({ destination, mode: 'transit' })}
          />
        </>
      }>
      <View style={styles.summary} accessible accessibilityLabel={`Vertrek ${formatNlClock(itinerary.departure)}, aankomst ${formatNlClock(itinerary.arrival)}, ${formatDuration(itinerary.durationMin)}, ${fare.isEstimate ? 'ongeveer ' : ''}${formatEuroCents(fare.finalCents)}`}>
        <AppText style={{ fontFamily: fonts.monoBold, fontSize: 28 }}>
          {formatNlClock(itinerary.departure)} → {formatNlClock(itinerary.arrival)}
        </AppText>
        <AppText variant="callout" color={c.textSecondary}>
          {formatDuration(itinerary.durationMin)} · {itinerary.transfers === 0 ? 'direct' : `${itinerary.transfers}× overstappen`} ·{' '}
          {fare.isEstimate ? '≈ ' : ''}
          {formatEuroCents(fare.finalCents)}
          {itinerary.realtime ? ' · live' : ''}
        </AppText>
      </View>

      {delays.length ? (
        <View style={[styles.alert, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
          <Icon name="warning" size={16} color={c.warning} />
          <AppText variant="callout" style={{ flex: 1 }}>
            {delays.some((l) => l.cancelled) ? 'Een deel van deze reis rijdt niet. Kies een andere reis.' : 'Er is vertraging op deze reis. De tijden hieronder zijn bijgewerkt.'}
          </AppText>
        </View>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <LegTimeline itinerary={itinerary} startLabel={startLabel} destinationLabel={destination.label} />
      </View>

      {nsTrains.length ? (
        <>
          <SectionLabel>Treinen</SectionLabel>
          <Card padded={false}>
            {nsTrains.map((leg, i) => (
              <ListRow
                key={i}
                first={i === 0}
                icon="train"
                title={`${leg.line ?? 'Trein'} ${leg.tripNumber ?? ''}`.trim()}
                subtitle={`${leg.from.name} → ${leg.to.name} · ${formatNlClock(leg.departure)}`}
                right={<AppText variant="callout" color={c.accent}>Voertuiginfo ›</AppText>}
                onPress={() => router.push({ pathname: '/vehicle', params: { leg: String(itinerary.legs.indexOf(leg)) } })}
              />
            ))}
          </Card>
        </>
      ) : longestTrain ? (
        <TrainCard leg={longestTrain} />
      ) : null}

      <SectionLabel>Prijs</SectionLabel>
      <Card style={{ gap: space.md }}>
        {fare.lines.map((line, i) => (
          <View key={i} style={styles.fareRow}>
            <AppText variant="callout" style={{ flex: 1 }} numberOfLines={2}>
              {line.label}
            </AppText>
            <View style={{ alignItems: 'flex-end' }}>
              <AppText variant="numeric">{formatEuroCents(line.finalCents)}</AppText>
              {line.discountLabel ? (
                <AppText variant="caption" color={c.textSecondary}>
                  {formatEuroCents(line.fullCents)} · {line.discountLabel}
                </AppText>
              ) : null}
            </View>
          </View>
        ))}
        <View style={[styles.fareRow, styles.total, { borderColor: c.separator }]}>
          <AppText variant="headline" style={{ flex: 1 }}>
            Te betalen{fare.isEstimate ? ' (schatting)' : ''}
          </AppText>
          <AppText variant="numeric" style={{ fontSize: 17, fontFamily: fonts.monoBold }}>
            {formatEuroCents(fare.finalCents)}
          </AppText>
        </View>
        {fare.discountCents > 0 ? (
          <AppText variant="footnote" color={c.textSecondary}>
            Vol tarief {formatEuroCents(fare.fullFareCents)} − {fare.productLabel} {formatEuroCents(fare.discountCents)}
          </AppText>
        ) : null}
        {fare.notes.map((n, i) => (
          <AppText key={i} variant="footnote" color={c.textTertiary}>
            {n}
          </AppText>
        ))}
      </Card>
      <AppText variant="caption" color={c.textTertiary} style={{ marginTop: space.md }}>
        Reisadvies via{' '}
        <AppText
          variant="caption"
          color={c.accent}
          accessibilityRole="link"
          onPress={() => Linking.openURL('https://transitous.org/sources/').catch(() => {})}>
          Transitous (open OV-data)
        </AppText>{' '}
        · Kaartdata © OpenStreetMap-bijdragers · Tarieven: NS-prijslijst 2026 en regionale tarieven.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 2 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 12, marginTop: space.lg },
  fareRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  total: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.md },
});
