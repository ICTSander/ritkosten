import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { nearestStationName } from '@/domain/fare/tariffUnits';
import { formatNlClock } from '@/domain/nlTime';
import { trainTypeInfo } from '@/domain/trainTypes';
import { useAsyncResource } from '@/state/hooks';
import { useApp } from '@/state/store';
import { fetchNsTrainInfo, fetchTrainPosition, nsTrainInfoAvailable } from '@/services/transit/nsTrainInfo';
import { AppText, Card, IconButton, Screen, SectionLabel, Skeleton } from '@/ui/components';
import { Icon, type IconName } from '@/ui/Icon';
import { nsImagesEnabled, TrainImages } from '@/ui/TrainImages';
import { ModeBadge } from '@/ui/transit';
import { fonts, space, usePalette } from '@/ui/theme';

const FACILITY: Record<string, { label: string; icon: IconName }> = {
  TOILET: { label: 'Toilet', icon: 'info' },
  STROOM: { label: 'Stopcontacten', icon: 'bolt' },
  FIETS: { label: 'Fietsplaatsen', icon: 'train' },
  TOEGANKELIJK: { label: 'Toegankelijk', icon: 'person' },
  WIFI: { label: 'Wifi', icon: 'live' },
  STILTE: { label: 'Stiltecoupé', icon: 'info' },
};

/** "Voertuiginfo" sheet for one train leg of the selected journey. */
export default function VehicleScreen() {
  const c = usePalette();
  const { leg: legParam } = useLocalSearchParams<{ leg?: string }>();
  const itinerary = useApp((s) => s.selectedItinerary);
  const leg = itinerary?.legs[Number(legParam ?? -1)];
  const rit = leg?.tripNumber ?? '';
  const available = nsTrainInfoAvailable() && !!rit;

  const info = useAsyncResource(available && leg ? `${rit}|${leg.plannedDeparture}` : null, (signal) => fetchNsTrainInfo(leg!, signal));
  const position = useAsyncResource(available ? `pos|${rit}` : null, (signal) => fetchTrainPosition(rit, signal));

  if (!itinerary || !leg) return <Redirect href="/" />;
  const data = info.status === 'ok' ? info.data : null;
  const typeInfo = trainTypeInfo(data?.carriages?.[0]?.type ?? data?.trainType);
  const seats = data ? (data.seatsFirst ?? 0) + (data.seatsSecond ?? 0) || data.seats : undefined;
  const pos = position.status === 'ok' ? position.data : null;
  const near = pos ? nearestStationName(pos.lat, pos.lon) : undefined;

  return (
    <Screen
      scroll
      header={
        <View style={styles.top}>
          <AppText variant="headline">Voertuiginfo</AppText>
          <IconButton icon="close" label="Sluiten" tone="muted" onPress={() => (router.canGoBack() ? router.back() : router.replace('/trip'))} />
        </View>
      }>
      <View style={styles.head}>
        <ModeBadge leg={leg} />
        <View style={{ flex: 1 }}>
          <AppText variant="title">
            {data?.category ?? leg.line ?? 'Trein'} {rit}
          </AppText>
          <AppText variant="callout" color={c.textSecondary}>
            richting {leg.headsign ?? leg.to.name}
            {leg.operator ? ` · ${leg.operator}` : ''}
          </AppText>
        </View>
      </View>

      {!available ? (
        <AppText color={c.textSecondary} style={{ marginTop: space.lg }}>
          Voor deze trein is geen voertuiginfo beschikbaar.
        </AppText>
      ) : info.status === 'loading' ? (
        <View style={{ gap: space.md, marginTop: space.lg }}>
          <Skeleton width="80%" height={18} />
          <Skeleton width="100%" height={44} />
          <Skeleton width="60%" height={18} />
        </View>
      ) : info.status === 'error' || !data ? (
        <AppText color={c.textSecondary} style={{ marginTop: space.lg }}>
          Voertuiginfo van NS is nu niet beschikbaar.
        </AppText>
      ) : (
        <>
          <View style={styles.stats}>
            {data.parts ? <Stat value={String(data.parts)} label="bakken" /> : null}
            {data.lengthM ? <Stat value={String(data.lengthM)} label="m" /> : null}
            {seats ? <Stat value={String(seats)} label="zitplaatsen" /> : null}
            {leg.from.platform ? <Stat value={leg.from.platform} label="spoor" first /> : null}
          </View>
          {data.shortened ? (
            <View style={[styles.warn, { backgroundColor: c.warningSoft }]}>
              <Icon name="warning" size={14} color={c.warning} />
              <AppText variant="callout">Kortere trein dan normaal</AppText>
            </View>
          ) : null}

          <SectionLabel>Instapadvies</SectionLabel>
          <AppText variant="callout" color={c.textSecondary}>
            {data.platformSections
              ? `De trein staat langs perrondeel ${data.platformSections}.`
              : 'De NS-data bevat voor deze trein geen indeling.'}
            {data.crowd ? ` Verwachte drukte: ${data.crowd === 'LOW' ? 'rustig' : data.crowd === 'MEDIUM' ? 'gemiddeld' : 'druk'}.` : ''}
          </AppText>

          <View style={{ marginTop: space.lg }}>
            <TrainImages info={data} height={48} />
            {data.carriages?.length ? (
              <AppText variant="caption" color={c.textTertiary} style={{ marginTop: 4 }}>
                {data.carriages.map((x) => x.type).filter(Boolean).join(' + ')}
              </AppText>
            ) : null}
          </View>

          {data.facilities.length ? (
            <View style={styles.facilities}>
              {data.facilities.map((f) => (
                <View key={f} style={styles.facility}>
                  <Icon name={FACILITY[f]?.icon ?? 'info'} size={14} color={c.textSecondary} />
                  <AppText variant="callout">{FACILITY[f]?.label ?? f}</AppText>
                </View>
              ))}
            </View>
          ) : null}

          {typeInfo ? (
            <>
              <SectionLabel>Over deze trein</SectionLabel>
              <Card style={{ gap: space.sm }}>
                <View style={styles.aboutHead}>
                  <AppText variant="headline" style={{ flex: 1 }}>
                    {typeInfo.name}
                  </AppText>
                  {typeInfo.tag ? (
                    <View style={[styles.tag, { backgroundColor: c.accentSoft }]}>
                      <AppText variant="caption" color={c.accent}>
                        {typeInfo.tag}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <AppText variant="callout">{typeInfo.description}</AppText>
                <Row label="Rijdt bij" value={typeInfo.operators.join(', ')} />
                {typeInfo.builder ? <Row label="Bouwer" value={typeInfo.builder} /> : null}
                {typeInfo.inServiceSince ? <Row label="In dienst" value={`sinds ${typeInfo.inServiceSince}`} /> : null}
                {typeInfo.maxSpeedKmh ? <Row label="Topsnelheid" value={`${typeInfo.maxSpeedKmh} km/u`} /> : null}
                {typeInfo.sourceUrls[0] ? (
                  <AppText
                    variant="caption"
                    color={c.accent}
                    accessibilityRole="link"
                    onPress={() => Linking.openURL(typeInfo.sourceUrls[0]).catch(() => {})}>
                    Bron: {typeInfo.sourceUrls[0].replace(/^https?:\/\//, '')}
                  </AppText>
                ) : null}
              </Card>
            </>
          ) : null}

          <SectionLabel>Live positie</SectionLabel>
          <View style={styles.facility}>
            <Icon name="location" size={16} color={pos ? c.success : c.textTertiary} />
            <AppText variant="callout" style={{ flex: 1 }}>
              {pos
                ? `${near ? `Bij ${near}` : 'Tussen stations'} · ${pos.speedKmh} km/u · ${formatNlClock(pos.at)}`
                : position.status === 'loading'
                  ? 'Positie ophalen…'
                  : 'Deze trein rijdt nu niet of deelt geen positie.'}
            </AppText>
          </View>

          <AppText variant="caption" color={c.textTertiary} style={{ marginTop: space.xl }}>
            Bron: NS Virtual Train API, NS Reisinformatie API.{nsImagesEnabled() ? ' Afbeeldingen: NS.' : ' Tekening: illustratie.'}
          </AppText>
        </>
      )}
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string; first?: boolean }) {
  const c = usePalette();
  return (
    <AppText variant="callout" color={c.textSecondary}>
      <AppText variant="headline" style={{ fontFamily: fonts.monoBold }}>
        {value}
      </AppText>{' '}
      {label}
    </AppText>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: space.md }}>
      <AppText variant="footnote" color={c.textSecondary} style={{ width: 90 }}>
        {label}
      </AppText>
      <AppText variant="footnote" style={{ flex: 1 }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: space.md, paddingVertical: space.sm, width: '100%', maxWidth: 580, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.lg },
  warn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: 10, marginTop: space.md },
  facilities: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.lg },
  facility: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aboutHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
});
