import * as Haptics from 'expo-haptics';
import { Redirect, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { compareModes } from '@/domain/comparison';
import { formatDecimal, formatDuration, formatEuroCents, formatKm, formatUnitPrice } from '@/domain/format';
import { formatNlClock } from '@/domain/nlTime';
import {
  ALL_TRANSIT_MODES,
  filterItineraries,
  type LegMode,
  sortItineraries,
  tightTransfers,
  tightTransferText,
  type TransitSort,
} from '@/domain/transit';
import {
  type CarState,
  type Failure,
  latestCarDeparture,
  type PricedItinerary,
  type TransitState,
  useCarComparison,
  useStartPoint,
  useTransitComparison,
} from '@/state/compare';
import { useOnline } from '@/state/hooks';
import { useApp } from '@/state/store';
import { openDirections } from '@/services/maps';
import { type ResolvedPrice, userPrice } from '@/services/priceService';
import { productFor } from '@/domain/fare/products';
import { AppText, Banner, Button, Card, Chip, Header, Screen, SectionLabel, Segmented, Skeleton } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { consumptionSource, consumptionText, FUEL_LABEL, perUnit, unitWord } from '@/ui/labels';
import { useReduceMotion } from '@/ui/motion';
import { NumberStepper } from '@/ui/NumberStepper';
import { PriceCounter } from '@/ui/PriceCounter';
import { TimePicker, timeQueryLabel } from '@/ui/TimePicker';
import { MODE_ICON, MODE_WORD, LegStrip } from '@/ui/transit';
import { fonts, space, usePalette } from '@/ui/theme';

export default function CompareScreen() {
  const c = usePalette();
  const vehicle = useApp((s) => s.vehicle);
  const destination = useApp((s) => s.destination);
  const timeQuery = useApp((s) => s.timeQuery);
  const setTimeQuery = useApp((s) => s.setTimeQuery);
  const rememberTrip = useApp((s) => s.rememberTrip);
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const [roundTrip, setRoundTrip] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [openedAt] = useState(() => Date.now());
  /** Price typed in because CBS was unreachable — this screen only, never persisted. */
  const [tripPrice, setTripPrice] = useState<ResolvedPrice | null>(null);

  const { start, label: startLabel } = useStartPoint(attempt);
  const from = start.status === 'ok' ? start.data : null;
  const car = useCarComparison(from, destination, attempt, tripPrice);
  const transit = useTransitComparison(from, destination, attempt);

  // Remember the destination with both prices (never the start position).
  const transitCents = transit.status === 'ok' ? transit.options[0].fare.finalCents : undefined;
  const carCents = car.status === 'ok' ? car.cost.totalCents : undefined;
  const remembered = useRef('');
  useEffect(() => {
    if (!destination || carCents === undefined) return;
    const key = `${destination.id}|${carCents}|${transitCents ?? ''}`;
    if (remembered.current === key) return;
    remembered.current = key;
    rememberTrip(destination, { carCents, transitCents });
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [destination, carCents, transitCents, rememberTrip]);

  if (!vehicle) return <Redirect href="/car" />;
  if (!destination) return <Redirect href="/" />;
  if (!vehicle.consumption) return <Redirect href="/ready" />;

  const mult = roundTrip ? 2 : 1;
  const startFailed = start.status === 'error';

  return (
    <Screen scroll header={<Header />}>
      <View style={{ gap: 2 }}>
        <AppText variant="title" numberOfLines={2} accessibilityRole="header">
          naar {destination.label}
        </AppText>
        <AppText variant="callout" color={c.textSecondary} numberOfLines={1}>
          vanaf {startLabel || '…'}
        </AppText>
      </View>

      <View style={styles.controls}>
        <View style={{ flex: 1 }}>
          <Segmented
            value={roundTrip ? 'return' : 'single'}
            onChange={(v) => setRoundTrip(v === 'return')}
            options={[
              { value: 'single', label: 'Enkele reis' },
              { value: 'return', label: 'Heen en terug' },
            ]}
          />
        </View>
      </View>
      <Pressable
        onPress={() => setShowTime((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel={`Vertrektijd: ${timeQueryLabel(timeQuery)}. Wijzigen`}
        style={[styles.timeChip, { borderColor: c.separator, backgroundColor: c.surface }]}>
        <Icon name="clock" size={16} color={c.accent} />
        <AppText variant="callout">{timeQueryLabel(timeQuery)}</AppText>
        <Icon name="chevronDown" size={14} color={c.textSecondary} />
      </Pressable>
      {showTime ? (
        <Card style={{ marginTop: space.sm }}>
          <TimePicker
            value={timeQuery}
            onDone={(q) => {
              setTimeQuery(q);
              setShowTime(false);
            }}
          />
        </Card>
      ) : null}

      {!online ? (
        <View style={{ marginTop: space.md }}>
          <Banner tone="warning" icon="offline" text="Je bent offline. Reizen laden zodra je weer online bent." />
        </View>
      ) : null}

      {startFailed ? (
        <View style={{ marginTop: space.xl, gap: space.md }}>
          <Banner tone="warning" icon="location" text={failureOf(start.error)} />
          <Button title="Vertrekpunt invullen" icon="pin" onPress={() => router.push({ pathname: '/search', params: { target: 'start' } })} />
        </View>
      ) : (
        <>
          <Difference car={car} transit={transit} mult={mult} />
          <CarCard state={car} mult={mult} onRetry={() => setAttempt((n) => n + 1)} onTripPrice={setTripPrice} destination={destination} nowMs={openedAt} />
          <TransitCard state={transit} mult={mult} onRetry={() => setAttempt((n) => n + 1)} onPickTime={() => setShowTime(true)} />
          {transit.status === 'ok' && transit.options.length > 1 ? <MoreOptions state={transit} /> : null}
          <SourceNotes car={car} transit={transit} />
        </>
      )}
    </Screen>
  );
}

function failureOf(e: unknown): string {
  return (e as { failure?: Failure })?.failure?.message ?? 'We konden je vertrekpunt niet bepalen.';
}

// ---- Cards --------------------------------------------------------------------------------

function ModeHeader({ icon, title, note }: { icon: 'car' | 'bolt' | 'transit'; title: string; note?: string }) {
  const c = usePalette();
  return (
    <View style={styles.modeHeader}>
      <View style={[styles.modeIcon, { backgroundColor: c.surfaceMuted }]}>
        <Icon name={icon} size={18} color={c.text} />
      </View>
      <AppText variant="headline">{title}</AppText>
      {note ? (
        <AppText variant="footnote" color={c.textSecondary} style={{ flex: 1, textAlign: 'right' }} numberOfLines={1}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}

function CardSkeleton({ text }: { text: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: space.md }} accessibilityLabel={text}>
      <Skeleton width={150} height={44} />
      <Skeleton width="70%" height={16} />
      <AppText variant="footnote" color={c.textSecondary}>
        {text}
      </AppText>
    </View>
  );
}

function CarCard({
  state,
  mult,
  onRetry,
  onTripPrice,
  destination,
  nowMs,
}: {
  nowMs: number;
  state: CarState & { reloadPrice: () => void };
  mult: number;
  onRetry: () => void;
  onTripPrice: (p: ResolvedPrice) => void;
  destination: { lat: number; lon: number; label: string };
}) {
  const c = usePalette();
  const vehicle = useApp((s) => s.vehicle)!;
  const timeQuery = useApp((s) => s.timeQuery);
  const fuel = vehicle.pricedFuel;
  const [price, setPrice] = useState<number | null>(null);

  return (
    <Card style={styles.card}>
      <ModeHeader icon={fuel === 'electricity' ? 'bolt' : 'car'} title="Auto" note={`${vehicle.model} · ${FUEL_LABEL[fuel]}`} />
      {state.status === 'loading' ? (
        <CardSkeleton text="Autoroute en brandstofprijs ophalen…" />
      ) : state.status === 'error' ? (
        <FailureBlock failure={state.failure} onRetry={onRetry} />
      ) : state.status === 'needs-price' ? (
        <View style={{ gap: space.md }}>
          <AppText variant="callout" color={c.textSecondary}>
            De {fuel === 'electricity' ? 'stroomprijs' : 'brandstofprijs'} van het CBS is nu niet op te halen. Wat betaal je {perUnit(fuel)}? We gebruiken dit alleen voor deze rit.
          </AppText>
          <NumberStepper label="Prijs" unit={`€ per ${unitWord(fuel)}`} value={price} onChange={setPrice} step={0.01} decimals={3} min={0.05} max={5} />
          <Button
            title="Bereken"
            variant="secondary"
            disabled={price === null}
            onPress={() => price !== null && onTripPrice({ price: userPrice(fuel, price), fromCache: false, fetchedAtMs: Date.now() })}
          />
        </View>
      ) : (
        <>
          <View accessibilityLiveRegion="polite">
            <PriceCounter cents={state.cost.totalCents * mult} size={44} />
            <AppText variant="footnote" color={c.textSecondary}>
              {state.cost.components.map((x) => x.label).join(' + ')} · {formatUnitPrice(state.price.price.pricePerUnit)} {perUnit(fuel)}
            </AppText>
          </View>
          {timeQuery.kind === 'arrive' && state.route.durationMin
            ? (() => {
                const leaveBy = latestCarDeparture(timeQuery.at, state.route.durationMin);
                const tooLate = Date.parse(leaveBy) < nowMs;
                return (
                  <View style={[styles.leaveBy, { backgroundColor: tooLate ? c.warningSoft : c.accentSoft }]}>
                    <Icon name={tooLate ? 'warning' : 'clock'} size={16} color={tooLate ? c.warning : c.accent} />
                    {tooLate ? (
                      <AppText variant="callout" style={{ flex: 1 }}>
                        Om {formatNlClock(timeQuery.at)} aankomen lukt niet meer. Vertrek je nu, dan ben je er ± om{' '}
                        <AppText variant="headline">
                          {formatNlClock(new Date(nowMs + state.route.durationMin * 60_000).toISOString())}
                        </AppText>
                        .
                      </AppText>
                    ) : (
                      <AppText variant="callout" style={{ flex: 1 }}>
                        Vertrek uiterlijk <AppText variant="headline">{formatNlClock(leaveBy)}</AppText>
                        <AppText variant="footnote" color={c.textSecondary}>
                          {' '}
                          · zonder file
                        </AppText>
                      </AppText>
                    )}
                  </View>
                );
              })()
            : null}
          <AppText variant="numeric" style={{ marginTop: space.sm }}>
            {state.route.durationMin ? `${formatDuration(state.route.durationMin * mult)} · ` : ''}
            {formatKm(state.route.distanceKm * mult)} · ± {formatDecimal(state.cost.fuel.unitsUsed * mult, 1)} {fuel === 'electricity' ? 'kWh' : 'L'}
          </AppText>
          {state.stale || state.price.fromCache ? (
            <AppText variant="footnote" color={c.warning} style={{ marginTop: space.xs }}>
              Prijs mogelijk niet actueel ({state.price.price.methodLabel.split(', ').pop()}).
            </AppText>
          ) : null}
          <Button
            title="Open in Google Maps"
            icon="map"
            variant="secondary"
            style={{ marginTop: space.lg }}
            onPress={() => openDirections({ destination, mode: 'driving' })}
          />
        </>
      )}
    </Card>
  );
}

function TransitCard({ state, mult, onRetry, onPickTime }: { state: TransitState; mult: number; onRetry: () => void; onPickTime: () => void }) {
  const c = usePalette();
  const profile = useApp((s) => s.transitProfile);
  const timeQuery = useApp((s) => s.timeQuery);
  const asked = useApp((s) => s.transitProfileAsked);
  const setSelected = useApp((s) => s.setSelectedItinerary);
  const product = productFor(profile);

  return (
    <Card style={styles.card}>
      <ModeHeader icon="transit" title="OV" note={product.id === 'none' ? 'Vol tarief' : product.label} />
      {state.status === 'loading' ? (
        <CardSkeleton text="OV-reizen zoeken…" />
      ) : state.status === 'error' ? (
        <FailureBlock
          failure={state.failure}
          onRetry={onRetry}
          action={state.failure.kind === 'no-route' ? { label: 'Ander tijdstip', onPress: onPickTime } : undefined}
        />
      ) : (
        (() => {
          const best = state.options[0];
          const it = best.itinerary;
          return (
            <>
              <PriceCounter cents={best.fare.finalCents * mult} size={44} delay={120} prefix={best.fare.isEstimate ? '≈' : undefined} />
              <AppText variant="footnote" color={c.textSecondary}>
                {best.fare.finalCents === 0
                  ? `Gratis met ${product.label}`
                  : best.fare.discountCents > 0
                    ? `Vol tarief ${formatEuroCents(best.fare.fullFareCents * mult)} · met ${product.label}`
                    : 'Vol tarief'}
                {best.fare.isEstimate ? ' · geschatte prijs' : ''}
              </AppText>
              {timeQuery.kind === 'arrive' && Date.parse(it.arrival) > Date.parse(timeQuery.at) ? (
                <AppText variant="footnote" color={c.warning} style={{ marginTop: space.sm }}>
                  Om {formatNlClock(timeQuery.at)} aankomen lukt niet meer met het OV. Dit is de eerstvolgende reis: je bent er om{' '}
                  {formatNlClock(it.arrival)}.
                </AppText>
              ) : null}
              <AppText variant="numeric" style={{ marginTop: space.sm }}>
                {formatNlClock(it.departure)} → {formatNlClock(it.arrival)} · {formatDuration(it.durationMin)} ·{' '}
                {it.transfers === 0 ? 'direct' : `${it.transfers}× overstappen`}
              </AppText>
              <View style={{ marginTop: space.md }}>
                <LegStrip itinerary={it} />
              </View>
              {tightTransfers(it).map((t) => (
                <View key={t.legIndex} style={styles.tight}>
                  <Icon name="warning" size={14} color={c.warning} />
                  <AppText variant="footnote" color={c.warning} style={{ flex: 1 }}>
                    {tightTransferText(t)}
                  </AppText>
                </View>
              ))}
              {!asked ? (
                <Pressable onPress={() => router.push('/ov-profile')} accessibilityRole="button" style={{ marginTop: space.md }}>
                  <AppText variant="footnote" color={c.accent}>
                    Heb je een abonnement of korting? Stel het in →
                  </AppText>
                </Pressable>
              ) : null}
              <Button
                title="Start reis"
                icon="route"
                style={{ marginTop: space.lg }}
                onPress={() => {
                  setSelected(it);
                  router.push('/trip');
                }}
              />
            </>
          );
        })()
      )}
    </Card>
  );
}

function FailureBlock({ failure, onRetry, action }: { failure: Failure; onRetry: () => void; action?: { label: string; onPress: () => void } }) {
  const c = usePalette();
  const title =
    failure.kind === 'no-route'
      ? 'Geen reis gevonden'
      : failure.kind === 'unavailable'
        ? 'Niet beschikbaar'
        : failure.kind === 'offline'
          ? 'Geen verbinding'
          : 'Niet gelukt';
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="headline">{title}</AppText>
      <AppText variant="callout" color={c.textSecondary}>
        {failure.message}
      </AppText>
      {action ? (
        <Button title={action.label} variant="secondary" onPress={action.onPress} />
      ) : failure.kind !== 'unavailable' && failure.kind !== 'no-route' ? (
        <Button title="Opnieuw proberen" icon="refresh" variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

// ---- Difference line ------------------------------------------------------------------------

function Difference({ car, transit, mult }: { car: CarState; transit: TransitState; mult: number }) {
  const c = usePalette();
  const reduce = useReduceMotion();
  const ready = car.status === 'ok' && transit.status === 'ok';
  const [opacity] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (ready) Animated.timing(opacity, { toValue: 1, duration: reduce ? 0 : 260, delay: reduce ? 0 : 150, useNativeDriver: true }).start();
  }, [ready, opacity, reduce]);
  if (!ready) return null;
  const best = transit.options[0];
  const lines = compareModes(
    { cents: car.cost.totalCents, durationMin: car.route.durationMin ?? null },
    { cents: best.fare.finalCents, durationMin: best.itinerary.durationMin },
    mult,
  );
  const text = lines.map((l) => l.text).join(' · ');
  const cost = lines.find((l) => l.kind === 'cost');
  const time = lines.find((l) => l.kind === 'time');
  // The answer to "wat is goedkoper?" goes first, big, above both cards.
  return (
    <Animated.View
      style={[styles.diff, { opacity, backgroundColor: c.accentSoft }]}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityRole="summary"
      accessibilityLabel={text}>
      {cost ? <AppText variant="title">{cost.text}</AppText> : null}
      {time ? (
        <AppText variant="callout" color={c.textSecondary}>
          {time.text}
        </AppText>
      ) : null}
      {best.fare.isEstimate ? (
        <AppText variant="caption" color={c.textSecondary} style={{ marginTop: 2 }}>
          Berekend met een geschatte OV-prijs
        </AppText>
      ) : null}
    </Animated.View>
  );
}

// ---- More OV options --------------------------------------------------------------------------

function MoreOptions({ state }: { state: Extract<TransitState, { status: 'ok' }> }) {
  const c = usePalette();
  const setSelected = useApp((s) => s.setSelectedItinerary);
  const [modes, setModes] = useState<LegMode[]>(ALL_TRANSIT_MODES);
  const [sort, setSort] = useState<TransitSort>('departure');

  const byId = new Map(state.options.map((o) => [o.itinerary.id, o]));
  const visible = sortItineraries(
    filterItineraries(
      state.options.map((o) => o.itinerary),
      { modes },
    ),
    sort,
  ).map((it) => byId.get(it.id) as PricedItinerary);

  const toggle = (m: LegMode) =>
    setModes((cur) => (cur.includes(m) ? (cur.length > 1 ? cur.filter((x) => x !== m) : cur) : [...cur, m]));

  return (
    <View>
      <SectionLabel>Meer OV-reizen</SectionLabel>
      <AppText variant="footnote" color={c.textSecondary} style={{ marginBottom: space.sm, marginLeft: space.lg }}>
        Toon reizen met:
      </AppText>
      <View style={styles.filters}>
        {(['train', 'bus', 'tram', 'metro'] as LegMode[]).map((m) => (
          <Chip key={m} label={MODE_WORD[m]} icon={MODE_ICON[m]} selected={modes.includes(m)} onPress={() => toggle(m)} />
        ))}
      </View>
      <View style={{ marginTop: space.sm }}>
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: 'departure', label: 'Vertrek' },
            { value: 'fastest', label: 'Snelste' },
            { value: 'fewest-transfers', label: 'Minste overstap' },
          ]}
        />
      </View>
      <Card padded={false} style={{ marginTop: space.md }}>
        {visible.length === 0 ? (
          <AppText color={c.textSecondary} style={{ padding: space.lg }}>
            Geen reizen met deze vervoerstypen. Zet een filter terug aan.
          </AppText>
        ) : (
          visible.map((o, i) => (
            <Pressable
              key={o.itinerary.id}
              onPress={() => {
                setSelected(o.itinerary);
                router.push('/trip');
              }}
              accessibilityRole="button"
              accessibilityLabel={`Vertrek ${formatNlClock(o.itinerary.departure)}, aankomst ${formatNlClock(o.itinerary.arrival)}, ${formatDuration(o.itinerary.durationMin)}, ${o.itinerary.transfers} overstappen, ${formatEuroCents(o.fare.finalCents)}`}
              style={({ pressed }) => [
                styles.option,
                { backgroundColor: pressed ? c.surfaceMuted : 'transparent' },
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.separator },
              ]}>
              <View style={styles.optionTop}>
                <AppText style={{ fontFamily: fonts.monoBold, fontSize: 17 }}>
                  {formatNlClock(o.itinerary.departure)} → {formatNlClock(o.itinerary.arrival)}
                </AppText>
                <AppText variant="numeric" color={c.textSecondary}>
                  {o.fare.isEstimate ? '≈ ' : ''}
                  {formatEuroCents(o.fare.finalCents)}
                </AppText>
              </View>
              <AppText variant="footnote" color={c.textSecondary}>
                {formatDuration(o.itinerary.durationMin)} · {o.itinerary.transfers === 0 ? 'direct' : `${o.itinerary.transfers}× overstappen`}
                {o.itinerary.legs.some((l) => l.delayMin) ? ' · vertraging' : ''}
                {o.itinerary.legs.some((l) => l.cancelled) ? ' · rit vervalt' : ''}
              </AppText>
              <View style={{ marginTop: 6 }}>
                <LegStrip itinerary={o.itinerary} />
              </View>
            </Pressable>
          ))
        )}
      </Card>
    </View>
  );
}

function SourceNotes({ car, transit }: { car: CarState; transit: TransitState }) {
  const c = usePalette();
  const vehicle = useApp((s) => s.vehicle)!;
  return (
    <View style={{ marginTop: space.xxl, gap: 6 }}>
      {car.status === 'ok' ? (
        <AppText variant="footnote" color={c.textSecondary}>
          Auto: {car.price.price.methodLabel}. Verbruik {consumptionText(vehicle.consumption!)} · {consumptionSource(vehicle.consumption!)}.
        </AppText>
      ) : null}
      {transit.status === 'ok' ? (
        <AppText variant="footnote" color={c.textSecondary}>
          <AppText
            variant="footnote"
            color={c.accent}
            accessibilityRole="link"
            onPress={() => Linking.openURL(transit.provider.attribution.url).catch(() => {})}>
            {transit.provider.attribution.text}
          </AppText>
          . {transit.options[0].fare.isEstimate ? 'Ticketprijzen zijn geschat met officiële tarieftabellen; tik op een reis voor de uitleg.' : ''}
        </AppText>
      ) : null}
      <View style={styles.note}>
        <Icon name="info" size={14} color={c.textTertiary} />
        <AppText variant="footnote" color={c.textTertiary} style={{ flex: 1 }}>
          Dit is een berekening, geen advies. Rijstijl, verkeer, parkeren en je eigen ticket kunnen de werkelijke kosten veranderen. Kaartdata © OpenStreetMap-bijdragers.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', height: 40, paddingHorizontal: space.lg, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, marginTop: space.sm },
  card: { marginTop: space.lg, gap: space.xs },
  modeHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  modeIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.sm },
  diff: { marginTop: space.lg, paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: 16, gap: 2 },
  leaveBy: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: 12, marginTop: space.md },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 },
  optionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.sm },
});
