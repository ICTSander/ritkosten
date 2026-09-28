import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, View } from 'react-native';

import type { Place } from '@/domain/types';
import { useAsyncResource, useDebounced, useOnline } from '@/state/hooks';
import { useApp } from '@/state/store';
import { mergeResults, searchLocal, searchPdok, searchPhoton, withLocalFirst } from '@/services/geocoding';
import { requestAndGetPosition } from '@/services/location';
import { AppText, Banner, Button, Card, IconButton, ListRow, Screen, SearchField, SectionLabel } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { placeIcon } from '@/ui/labels';
import { space, usePalette } from '@/ui/theme';

type Mode = 'destination' | 'start';

export default function SearchScreen() {
  const c = usePalette();
  const params = useLocalSearchParams<{ target?: string }>();
  const [mode, setMode] = useState<Mode>(params.target === 'start' ? 'start' : 'destination');
  /** When the user picked a destination but still needs a start point, continue to the result after. */
  const [continueToResult, setContinueToResult] = useState(false);
  const [askLocation, setAskLocation] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const { startMode, manualStart, recents, setDestination, setStartMode, setManualStart } = useApp();
  const online = useOnline();

  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 150);
  // Three sources, shown as soon as each is ready (the slowest never blocks the rest):
  //  1. local — stations + your recent places, instant and typo-tolerant (no network)
  //  2. PDOK — Dutch addresses/places, ~0.1 s, retries fuzzy on a typo
  //  3. Photon — POIs and abroad, typo-tolerant but 1–3 s
  const typedNow = query.trim();
  const local = mode === 'destination' || mode === 'start' ? searchLocal(typedNow, recents.map((r) => r.place)) : [];
  const biasKey = manualStart ? `${manualStart.lat.toFixed(1)},${manualStart.lon.toFixed(1)}` : '';
  const pdok = useAsyncResource(debounced.length >= 2 ? `pdok|${debounced}` : null, (signal) => searchPdok(debounced, { signal }));
  const photon = useAsyncResource(debounced.length >= 2 ? `photon|${debounced}|${biasKey}` : null, (signal) =>
    searchPhoton(debounced, manualStart ?? undefined, { signal }),
  );
  const remote = mergeResults(
    debounced,
    pdok.status === 'ok' ? pdok.data : [],
    photon.status === 'ok' ? photon.data : [],
  );
  const merged = withLocalFirst(local, remote);
  const stillLoading = debounced !== typedNow || pdok.status === 'loading' || photon.status === 'loading';
  const bothFailed = pdok.status === 'error' && photon.status === 'error';
  const results =
    typedNow.length < 2
      ? { status: 'idle' as const }
      : merged.length
        ? { status: 'ok' as const, places: merged }
        : bothFailed
          ? { status: 'error' as const }
          : stillLoading
            ? { status: 'loading' as const }
            : { status: 'ok' as const, places: [] };

  // Next: the (required) arrival time, then the comparison.
  const goToResult = () => router.replace('/when');

  const pickDestination = (place: Place) => {
    Keyboard.dismiss();
    setDestination(place);
    if (startMode === 'device') return goToResult();
    if (startMode === 'manual' && manualStart) return goToResult();
    if (startMode === 'manual') return switchToStart(true);
    setAskLocation(true); // first trip: explain why, then ask
  };

  const switchToStart = (thenResult: boolean) => {
    setContinueToResult(thenResult);
    setAskLocation(false);
    setQuery('');
    setMode('start');
  };

  const useDeviceLocation = async () => {
    setLocating(true);
    setLocationError(null);
    const r = await requestAndGetPosition();
    setLocating(false);
    if (r.status === 'ok') {
      setStartMode('device');
      if (mode === 'destination' || continueToResult) return goToResult();
      return router.back();
    }
    if (r.status === 'denied') {
      setStartMode('manual');
      setLocationError('Locatie staat uit. Vul hieronder je vertrekpunt in.');
      if (mode === 'destination') switchToStart(true);
      return;
    }
    setLocationError('Je locatie kon niet worden bepaald. Vul je vertrekpunt zelf in.');
    if (mode === 'destination') switchToStart(true);
  };

  const pickStart = (place: Place) => {
    Keyboard.dismiss();
    setManualStart(place);
    setStartMode('manual');
    if (continueToResult) return goToResult();
    router.back();
  };

  const onPick = mode === 'destination' ? pickDestination : pickStart;
  const startLabel =
    startMode === 'device' ? 'Huidige locatie' : startMode === 'manual' && manualStart ? manualStart.label : 'Nog niet gekozen';

  return (
    <Screen
      scroll
      header={
        <View style={styles.top}>
          <AppText variant="headline" accessibilityRole="header">
            {mode === 'destination' ? 'Bestemming' : 'Vertrekpunt'}
          </AppText>
          <IconButton icon="close" label="Sluiten" tone="muted" onPress={() => router.back()} />
        </View>
      }>
      <View style={{ gap: space.md, marginTop: space.sm }}>
        {mode === 'destination' && !askLocation ? (
          <Pressable
            onPress={() => switchToStart(false)}
            accessibilityRole="button"
            accessibilityLabel={`Vertrekpunt: ${startLabel}. Wijzigen`}
            style={[styles.fromRow, { borderColor: c.separator }]}>
            <AppText variant="callout" color={c.textSecondary}>
              Van
            </AppText>
            <Icon name={startMode === 'device' ? 'location' : 'pin'} size={16} color={c.accent} />
            <AppText variant="callout" style={{ flex: 1 }} numberOfLines={1}>
              {startLabel}
            </AppText>
            <AppText variant="callout" color={c.accent}>
              Wijzig
            </AppText>
          </Pressable>
        ) : null}

        {askLocation ? (
          <LocationPrompt locating={locating} onUseLocation={useDeviceLocation} onManual={() => switchToStart(true)} />
        ) : (
          <SearchField
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            placeholder={mode === 'destination' ? 'Adres, plaats of plek' : 'Startadres of plaats'}
            accessibilityLabel={mode === 'destination' ? 'Zoek een bestemming' : 'Zoek een vertrekpunt'}
            autoFocus
            icon={mode === 'destination' ? 'search' : 'pin'}
          />
        )}

        {locationError ? <Banner tone="warning" icon="location" text={locationError} /> : null}
        {!online && !askLocation ? <Banner tone="warning" icon="offline" text="Geen internet. Zoeken werkt weer zodra je online bent." /> : null}
      </View>

      {askLocation ? null : (
        <>
          {mode === 'start' && startMode !== 'device' ? (
            <Card padded={false} style={{ marginTop: space.lg }}>
              <ListRow
                first
                icon="location"
                title="Huidige locatie gebruiken"
                subtitle="Alleen gebruikt om je route te berekenen"
                onPress={useDeviceLocation}
                right={locating ? <ActivityIndicator color={c.accent} /> : undefined}
              />
            </Card>
          ) : null}

          {results.status === 'loading' ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.accent} />
            </View>
          ) : results.status === 'error' ? (
            <View style={{ marginTop: space.lg }}>
              <Banner tone="error" icon="warning" text="Zoeken lukt nu niet. Controleer je verbinding en probeer het opnieuw." />
            </View>
          ) : results.status === 'ok' && results.places.length === 0 ? (
            <AppText color={c.textSecondary} style={{ marginTop: space.xl }}>
              Geen plek gevonden voor ‘{typedNow}’. Probeer een plaatsnaam, adres of postcode.
            </AppText>
          ) : results.status === 'ok' ? (
            <>
              <Card padded={false} style={{ marginTop: space.lg }}>
                {results.places.map((p, i) => (
                  <ListRow key={p.id} first={i === 0} icon={placeIcon(p)} title={p.label} subtitle={p.detail} onPress={() => onPick(p)} />
                ))}
              </Card>
              {stillLoading ? (
                <View style={styles.more}>
                  <ActivityIndicator size="small" color={c.textTertiary} />
                  <AppText variant="caption" color={c.textTertiary}>
                    Meer resultaten zoeken…
                  </AppText>
                </View>
              ) : null}
              <AppText variant="caption" color={c.textTertiary} style={{ marginTop: space.sm, textAlign: 'right' }}>
                Kaartdata © OpenStreetMap-bijdragers, PDOK
              </AppText>
            </>
          ) : mode === 'destination' && recents.length > 0 ? (
            <>
              <SectionLabel>Recent</SectionLabel>
              <Card padded={false}>
                {recents.map((r, i) => (
                  <ListRow
                    key={r.place.id}
                    first={i === 0}
                    icon="clock"
                    title={r.place.label}
                    subtitle={r.place.detail}
                    onPress={() => onPick(r.place)}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function LocationPrompt({
  locating,
  onUseLocation,
  onManual,
}: {
  locating: boolean;
  onUseLocation: () => void;
  onManual: () => void;
}) {
  const c = usePalette();
  return (
    <Card style={{ gap: space.md, marginTop: space.sm }}>
      <View style={[styles.promptIcon, { backgroundColor: c.accentSoft }]}>
        <Icon name="location" size={22} color={c.accent} />
      </View>
      <AppText variant="title">Vanaf waar vertrek je?</AppText>
      <AppText color={c.textSecondary}>
        We gebruiken je locatie alleen om je auto- en OV-route vanaf waar je nu bent te berekenen. We bewaren je locatie niet.
      </AppText>
      <Button title="Gebruik mijn locatie" icon="location" onPress={onUseLocation} loading={locating} />
      <Button title="Vertrekpunt zelf invullen" variant="plain" onPress={onManual} />
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: space.md, paddingVertical: space.sm, width: '100%', maxWidth: 580, alignSelf: 'center' },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  center: { paddingVertical: space.xxxl, alignItems: 'center' },
  more: { flexDirection: 'row', alignItems: 'center', gap: space.sm, justifyContent: 'center', paddingTop: space.md },
  promptIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
