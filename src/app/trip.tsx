import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nearestStationName } from '@/domain/fare/tariffUnits';
import { formatNlClock } from '@/domain/nlTime';
import { tightTransfers, tightTransferText } from '@/domain/transit';
import { buildTripSteps, currentStepIndex, formatCountdown, tripProgress } from '@/domain/tripSteps';
import { useAsyncResource } from '@/state/hooks';
import { useApp } from '@/state/store';
import { cancelTripAlerts, enableTripAlerts } from '@/services/tripAlerts';
import { fetchNsTrainInfo, fetchTrainPosition, hasNsTrainInfo, nsTrainInfoAvailable } from '@/services/transit/nsTrainInfo';
import { haversineM } from '@/services/transit/polyline';
import { AppText, Button, Card, IconButton, Skeleton } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { TrainImages } from '@/ui/TrainImages';
import { TripProgress } from '@/ui/TripProgress';
import { ModeBadge } from '@/ui/transit';
import { fonts, MAX_WIDTH, radius, space, usePalette } from '@/ui/theme';

/**
 * "Onderweg": one thing at a time. A big countdown, what to do now (walk to spoor 5, board,
 * get off in …), a progress bar, the train when it matters, and the whole journey one tap away.
 */
export default function TripScreen() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const itinerary = useApp((s) => s.selectedItinerary);
  const destination = useApp((s) => s.destination);
  const [now, setNow] = useState(() => Date.now());
  const [manualOffset, setManualOffset] = useState(0);
  const [alerts, setAlerts] = useState<'off' | 'on' | 'denied' | 'unsupported'>('off');

  // Tick every second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Keep the screen on while travelling.
  useEffect(() => {
    activateKeepAwakeAsync('trip').catch(() => {});
    return () => {
      deactivateKeepAwake('trip').catch(() => {});
    };
  }, []);

  const legs = itinerary?.legs ?? [];
  const destinationLabel = destination?.label ?? 'je bestemming';
  const timeSteps = itinerary ? buildTripSteps(itinerary, destinationLabel) : [];
  const autoIndex = currentStepIndex(timeSteps, now);
  const index = Math.min(Math.max(autoIndex + manualOffset, 0), Math.max(timeSteps.length - 1, 0));
  const step = timeSteps[index];
  const leg = step ? legs[step.legIndex] : undefined;
  const nextStep = timeSteps[index + 1];

  // Live NS data for the train of the current step (delay, stock, images) and its GPS position.
  const trainLeg = leg && (step?.kind === 'board' || step?.kind === 'ride') && hasNsTrainInfo(leg) ? leg : undefined;
  const nsOn = nsTrainInfoAvailable();
  const rit = trainLeg?.tripNumber ?? '';
  const info = useAsyncResource(nsOn && trainLeg ? `${rit}|${trainLeg.plannedDeparture}` : null, (signal) =>
    fetchNsTrainInfo(trainLeg!, signal),
  );
  const tick15 = Math.floor(now / 15_000);
  const position = useAsyncResource(nsOn && trainLeg && step?.kind === 'ride' ? `${rit}|${tick15}` : null, (signal) =>
    fetchTrainPosition(rit, signal),
  );

  // Apply NS's live delay to the countdown of this ride.
  const delayMin = info.status === 'ok' ? (info.data.delayMin ?? 0) : 0;
  const steps = delayMin && step ? buildTripSteps(itinerary!, destinationLabel, { [step.legIndex]: delayMin }) : timeSteps;
  const live = steps[index] ?? step;
  const remaining = live ? live.deadline - now : 0;

  // Haptics in the foreground: on every step change and 2 minutes before getting off.
  const lastIndex = useRef(index);
  const warned = useRef<string>('');
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (lastIndex.current !== index) {
      lastIndex.current = index;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    const key = `${index}`;
    if (live?.kind === 'ride' && remaining > 0 && remaining <= 120_000 && warned.current !== key) {
      warned.current = key;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }, [index, live?.kind, remaining]);

  if (!itinerary || !live) return <Redirect href="/" />;

  const pos = position.status === 'ok' ? position.data : null;
  const distanceKm =
    pos && trainLeg ? Math.max(0, haversineM([pos.lat, pos.lon], [trainLeg.to.lat, trainLeg.to.lon]) / 1000) : undefined;
  const near = pos ? nearestStationName(pos.lat, pos.lon) : undefined;
  // A tight change coming up: the leg this step leads to (walking/riding towards it).
  const tight = tightTransfers(itinerary).find(
    (t) => t.legIndex === live.legIndex || (t.legIndex > live.legIndex && legs.slice(live.legIndex + 1, t.legIndex).every((l) => l.mode === 'walk')),
  );
  const urgent = live.kind !== 'before' && live.kind !== 'arrived' && remaining < 2 * 60_000;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <IconButton icon="back" label="Terug" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <AppText variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          naar {destinationLabel}
        </AppText>
        <View style={{ width: 44 }} />
      </View>

      {/* Scrolls when a warning and the train card make the step taller than the screen. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        <TripProgress itinerary={itinerary} progress={tripProgress(itinerary, now)} viewingLeg={manualOffset !== 0 ? live.legIndex : undefined} />

        <Card style={styles.main}>
          {live.kind === 'arrived' ? (
            <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxl }}>
              <Icon name="checkCircle" size={48} color={c.success} />
              <AppText variant="largeTitle">Je bent er!</AppText>
              <AppText color={c.textSecondary}>{destinationLabel}</AppText>
            </View>
          ) : (
            <>
              <View style={[styles.countBox, { backgroundColor: urgent ? c.warningSoft : c.highlight, borderColor: urgent ? c.warning : c.highlightEdge }]}>
              <AppText
                style={[styles.countdown, remaining >= 3_600_000 && styles.countdownLong, { color: urgent ? c.warning : c.text }]}
                accessibilityRole="timer"
                accessibilityLabel={`Nog ${Math.max(0, Math.round(remaining / 60_000))} minuten ${live.countdownLabel}`}
                adjustsFontSizeToFit
                numberOfLines={1}>
                {formatCountdown(remaining)}
              </AppText>
              <AppText variant="headline" color={urgent ? c.warning : c.onHighlight} style={{ textAlign: 'center' }}>
                {live.countdownLabel}
                {delayMin > 0 ? ` · ${delayMin} min vertraging` : ''}
              </AppText>
              </View>

              <View style={[styles.divider, { backgroundColor: c.separator }]} />

              <View style={styles.instruction}>
                {live.platform ? (
                  <View style={[styles.platform, { backgroundColor: c.accent }]} accessible accessibilityLabel={`${live.platformWord ?? 'spoor'} ${live.platform}`}>
                    <AppText variant="caption" color={c.onAccent}>
                      {(live.platformWord ?? 'spoor').toUpperCase()}
                    </AppText>
                    <AppText style={[styles.platformNr, { color: c.onAccent }]}>{live.platform}</AppText>
                  </View>
                ) : null}
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText variant="title" accessibilityRole="header">
                    {live.title}
                  </AppText>
                  {live.subtitle ? (
                    <AppText variant="callout" color={c.textSecondary}>
                      {live.subtitle}
                    </AppText>
                  ) : null}
                  {leg && leg.mode !== 'walk' && live.kind !== 'before' ? (
                    <View style={{ flexDirection: 'row', marginTop: 4 }}>
                      <ModeBadge leg={leg} />
                    </View>
                  ) : null}
                </View>
              </View>

              {tight && (live.kind === 'walk' || live.kind === 'board' || live.kind === 'ride') ? (
                <View style={[styles.tight, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
                  <Icon name="warning" size={16} color={c.warning} />
                  <AppText variant="callout" color={c.text} style={{ flex: 1 }}>
                    {tightTransferText(tight)}
                  </AppText>
                </View>
              ) : null}

              {/* The train, when it matters: on the platform and on board. Shown right away (also while
                  NS data loads) so it's clear there is more to see. */}
              {trainLeg && nsOn && info.status !== 'error' ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/vehicle', params: { leg: String(live.legIndex) } })}
                  accessibilityRole="button"
                  accessibilityLabel="Bekijk de trein"
                  style={({ pressed }) => [styles.train, { backgroundColor: c.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
                  {info.status === 'ok' ? <TrainImages info={info.data} height={34} /> : <Skeleton width="100%" height={34} />}
                  <View style={styles.trainMeta}>
                    <AppText variant="footnote" color={c.textSecondary} style={{ flex: 1 }}>
                      {info.status === 'ok'
                        ? [info.data.trainType, info.data.parts ? `${info.data.parts} bakken` : undefined, info.data.crowd === 'LOW' ? 'rustig' : info.data.crowd === 'MEDIUM' ? 'gemiddeld druk' : info.data.crowd === 'HIGH' ? 'druk' : undefined]
                            .filter(Boolean)
                            .join(' · ')
                        : 'Treininfo laden…'}
                    </AppText>
                    <AppText variant="callout" color={c.accent} style={{ fontFamily: fonts.bold }}>
                      Bekijk trein ›
                    </AppText>
                  </View>
                </Pressable>
              ) : null}

              {live.kind === 'ride' && pos ? (
                <View style={styles.liveRow}>
                  <View style={[styles.liveDot, { backgroundColor: c.success }]} />
                  <AppText variant="footnote" color={c.textSecondary}>
                    {near ? `Bij ${near}` : 'Onderweg'} · {pos.speedKmh} km/u
                    {distanceKm !== undefined ? ` · nog ± ${Math.round(distanceKm)} km` : ''}
                  </AppText>
                </View>
              ) : null}
            </>
          )}
        </Card>

        {nextStep && live.kind !== 'arrived' ? (
          <View style={styles.next}>
            <AppText variant="caption" color={c.textTertiary}>
              DAARNA
            </AppText>
            <AppText variant="callout" numberOfLines={1}>
              {nextStep.title}
              {nextStep.kind !== 'arrived' ? (
                <AppText variant="callout" color={c.textSecondary}>
                  {' '}
                  · {formatNlClock(new Date(nextStep.kind === 'ride' ? nextStep.deadline : nextStep.startsAt).toISOString())}
                </AppText>
              ) : null}
            </AppText>
          </View>
        ) : null}

        <View style={styles.manual}>
          <Pressable onPress={() => setManualOffset((o) => o - 1)} disabled={index === 0} accessibilityRole="button" hitSlop={8}>
            <AppText variant="footnote" color={index === 0 ? c.textTertiary : c.accent}>
              ‹ Vorige stap
            </AppText>
          </Pressable>
          {manualOffset !== 0 ? (
            <Pressable onPress={() => setManualOffset(0)} accessibilityRole="button" hitSlop={8}>
              <AppText variant="footnote" color={c.accent}>
                Terug naar nu
              </AppText>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setManualOffset((o) => o + 1)}
            disabled={index >= timeSteps.length - 1}
            accessibilityRole="button"
            hitSlop={8}>
            <AppText variant="footnote" color={index >= timeSteps.length - 1 ? c.textTertiary : c.accent}>
              Volgende stap ›
            </AppText>
          </Pressable>
        </View>

        {alerts === 'off' && Platform.OS !== 'web' ? (
          <Pressable
            onPress={async () => {
              const r = await enableTripAlerts(timeSteps);
              setAlerts(r === 'scheduled' ? 'on' : r);
            }}
            accessibilityRole="button"
            style={[styles.alertCard, { borderColor: c.separator }]}>
            <Icon name="live" size={18} color={c.accent} />
            <AppText variant="callout" style={{ flex: 1 }}>
              Tril als ik moet overstappen of uitstappen
            </AppText>
            <AppText variant="callout" color={c.accent}>
              Aanzetten
            </AppText>
          </Pressable>
        ) : alerts === 'on' ? (
          <Pressable onPress={() => cancelTripAlerts().then(() => setAlerts('off'))} accessibilityRole="button" style={styles.alertOn}>
            <Icon name="checkCircle" size={16} color={c.success} />
            <AppText variant="footnote" color={c.textSecondary}>
              Meldingen staan aan · tik om uit te zetten
            </AppText>
          </Pressable>
        ) : alerts === 'denied' ? (
          <AppText variant="footnote" color={c.textSecondary} style={{ textAlign: 'center' }}>
            Meldingen staan uit in je instellingen.
          </AppText>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Button title="Bekijk hele reis" icon="route" variant="secondary" onPress={() => router.push('/journey')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, width: '100%', maxWidth: MAX_WIDTH + 16, alignSelf: 'center' },
  body: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: space.lg, gap: space.lg, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  main: { gap: space.xs, paddingVertical: space.xl },
  countdownLong: { fontSize: 56, lineHeight: 96 },
  countBox: { borderRadius: 22, borderWidth: 2, borderBottomWidth: 6, paddingVertical: space.lg, paddingHorizontal: space.md, gap: 2 },
  countdown: { fontFamily: fonts.monoBold, fontSize: 88, lineHeight: 96, letterSpacing: -1, textAlign: 'center', fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.lg },
  instruction: { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' },
  platform: { width: 72, borderRadius: 14, alignItems: 'center', paddingVertical: space.sm },
  platformNr: { fontFamily: fonts.monoBold, fontSize: 34, lineHeight: 40 },
  train: { marginTop: space.lg, borderRadius: radius.input, padding: space.md, gap: space.sm },
  trainMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  next: { gap: 2, paddingHorizontal: space.xs },
  manual: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs },
  tight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: 12, padding: space.md, marginTop: space.md },
  alertCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 2, borderRadius: radius.input, padding: space.md },
  alertOn: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: space.md, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
});
