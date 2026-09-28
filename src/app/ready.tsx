import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { formatDecimal, formatUnitPrice } from '@/domain/format';
import { useFuelPrice } from '@/state/hooks';
import { useApp } from '@/state/store';
import { ENERGY_LABEL } from '@/services/rdw';
import { AppText, Button, Card, Header, Screen } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { consumptionSource, consumptionText, perUnit, vehicleSubtitle, vehicleTitle } from '@/ui/labels';
import { useReduceMotion } from '@/ui/motion';
import { NumberStepper } from '@/ui/NumberStepper';
import { space, usePalette } from '@/ui/theme';

type ItemState = 'pending' | 'done' | 'warn';

export default function ReadyScreen() {
  const c = usePalette();
  const { suggest } = useLocalSearchParams<{ suggest?: string }>();
  const vehicle = useApp((s) => s.vehicle);
  const setConsumption = useApp((s) => s.setConsumption);
  const transitAsked = useApp((s) => s.transitProfileAsked);
  const price = useFuelPrice();
  const [revealed, setRevealed] = useState(0);
  const reduce = useReduceMotion();

  // Reveal the checklist one item at a time so the user sees what was done for them.
  useEffect(() => {
    if (revealed >= 4) return;
    const t = setTimeout(() => setRevealed((n) => n + 1), reduce ? 0 : 280);
    return () => clearTimeout(t);
  }, [revealed, reduce]);

  if (!vehicle) return <Redirect href="/car" />;
  const isEv = vehicle.pricedFuel === 'electricity';
  const needsConsumption = !vehicle.consumption;
  const allDone = revealed >= 4 && !needsConsumption;

  const priceDetail =
    price.status === 'ready'
      ? `${formatUnitPrice(price.resolved.price.pricePerUnit)} ${perUnit(vehicle.pricedFuel)} · ${
          price.resolved.price.source === 'cbs' ? price.resolved.price.methodLabel.replace(/^.*\(CBS\), /, 'CBS, ') : 'eigen prijs'
        }`
      : price.status === 'error'
        ? 'Nu niet op te halen — je kunt hem bij je eerste rit invullen'
        : 'Ophalen…';

  const items: { label: string; detail: string; state: ItemState }[] = [
    {
      label: 'Verbruik',
      detail: vehicle.consumption ? consumptionText(vehicle.consumption) : 'Niet automatisch gevonden',
      state: vehicle.consumption ? 'done' : 'warn',
    },
    { label: 'Brandstof', detail: ENERGY_LABEL[vehicle.energy], state: 'done' },
    {
      label: isEv ? 'Gemiddelde stroomprijs' : 'Gemiddelde pompprijs',
      detail: priceDetail,
      state: price.status === 'loading' ? 'pending' : price.status === 'ready' ? 'done' : 'warn',
    },
    { label: 'Routeplanner', detail: 'Klaar voor je eerste rit', state: 'done' },
  ];

  return (
    <Screen
      scroll
      header={<Header onBack={() => router.back()} />}
      footer={
        <Button
          title={transitAsked ? 'Waar ga je heen?' : 'Verder'}
          icon={transitAsked ? 'pin' : undefined}
          disabled={!allDone}
          onPress={() => {
            // Next: the OV discount question (first time only). Otherwise straight to the search.
            if (!transitAsked) return router.push({ pathname: '/ov-profile', params: { onboarding: '1' } });
            // Reset to a clean stack [home, search]: back from home must not return to the car setup.
            if (router.canDismiss()) router.dismissAll();
            router.replace('/');
            router.push('/search');
          }}
        />
      }>
      <View style={{ gap: space.sm, marginTop: space.sm, marginBottom: space.xxl }}>
        {/* Only during the first setup; changing your car later isn't a "step 2 of 3". */}
        {!transitAsked ? (
          <AppText variant="caption" color={c.accent}>
            STAP 2 VAN 3
          </AppText>
        ) : null}
        <AppText variant="largeTitle" accessibilityRole="header" accessibilityLiveRegion="polite">
          {allDone ? 'Je auto is ingesteld.' : needsConsumption ? 'Nog één ding.' : 'Bijna klaar.'}
        </AppText>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={[styles.carIcon, { backgroundColor: c.accentSoft }]}>
            <Icon name={isEv ? 'bolt' : 'car'} size={22} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{vehicleTitle(vehicle)}</AppText>
            <AppText variant="footnote" color={c.textSecondary}>
              {vehicleSubtitle(vehicle)}
            </AppText>
          </View>
        </View>
      </Card>

      <View style={{ marginTop: space.xl, gap: space.lg }}>
        {items.map((item, i) => (
          <ChecklistItem key={item.label} {...item} visible={i < revealed} state={i < revealed ? item.state : 'pending'} />
        ))}
      </View>

      {needsConsumption && revealed >= 1 ? (
        <ConsumptionFallback
          phev={vehicle.energy === 'phev'}
          fuelWord={vehicle.pricedFuel === 'diesel' ? 'diesel' : vehicle.pricedFuel === 'lpg' ? 'LPG' : 'benzine'}
          unit={isEv ? 'kWh' : 'L'}
          suggest={suggest ? Number(suggest) : undefined}
          onConfirm={setConsumption}
        />
      ) : null}

      {vehicle.consumption && allDone ? (
        <AppText variant="footnote" color={c.textTertiary} style={{ marginTop: space.xxl }}>
          {consumptionSource(vehicle.consumption)}. Je kunt verbruik en prijs altijd aanpassen bij Mijn auto.
        </AppText>
      ) : null}
    </Screen>
  );
}

function ChecklistItem({ label, detail, state, visible }: { label: string; detail: string; state: ItemState; visible: boolean }) {
  const c = usePalette();
  const reduce = useReduceMotion();
  const opacity = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (visible) Animated.timing(opacity, { toValue: 1, duration: reduce ? 0 : 220, useNativeDriver: true }).start();
  }, [visible, opacity, reduce]);

  const color = state === 'done' ? c.success : state === 'warn' ? c.warning : c.textTertiary;
  return (
    <Animated.View
      style={[styles.item, { opacity }]}
      accessible
      accessibilityLabel={`${label}: ${detail}${state === 'done' ? ', gereed' : ''}`}>
      <View style={[styles.dot, { borderColor: color, backgroundColor: state === 'done' ? color : 'transparent' }]}>
        {state === 'done' ? <Icon name="check" size={13} color={c.surface} /> : null}
        {state === 'warn' ? <AppText variant="caption" color={color}>!</AppText> : null}
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="headline">{label}</AppText>
        <AppText variant="footnote" color={c.textSecondary}>
          {detail}
        </AppText>
      </View>
    </Animated.View>
  );
}

function ConsumptionFallback({
  phev,
  fuelWord,
  unit,
  suggest,
  onConfirm,
}: {
  phev: boolean;
  fuelWord: string;
  unit: 'L' | 'kWh';
  suggest?: number;
  onConfirm: (v: number) => void;
}) {
  const c = usePalette();
  const [editing, setEditing] = useState(!suggest);
  const [value, setValue] = useState<number | null>(suggest ?? null);
  const unitLabel = `${unit}/100 km`;
  const range = unit === 'kWh' ? { min: 8, max: 45 } : { min: 2, max: 30 };

  return (
    <Card style={{ marginTop: space.xxl, gap: space.md }}>
      <AppText variant="headline">
        {phev
          ? `Hoeveel verbruikt je auto op ${fuelWord}?`
          : suggest && !editing
            ? `Klopt het dat je auto ongeveer ${formatDecimal(suggest, 1)} ${unitLabel} verbruikt?`
            : 'Wat verbruikt je auto ongeveer?'}
      </AppText>
      <AppText variant="callout" color={c.textSecondary}>
        {phev
          ? 'Het officiële verbruik van een plug-in hybride gaat uit van een volle accu. Vul in wat je auto met een lege accu verbruikt — dat staat vaak in je boordcomputer.'
          : suggest && !editing
            ? 'Deze uitvoering konden we niet automatisch herkennen. Dit is het gemiddelde van vergelijkbare uitvoeringen van hetzelfde model.'
            : 'Deze uitvoering konden we niet automatisch herkennen. Kijk in je boordcomputer of vul een schatting in.'}
      </AppText>
      {suggest && !editing && !phev ? (
        <View style={{ gap: space.sm }}>
          <Button title={`Ja, gebruik ${formatDecimal(suggest, 1)}`} onPress={() => onConfirm(suggest)} />
          <Button title="Aanpassen" variant="plain" onPress={() => setEditing(true)} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <NumberStepper label="Verbruik" unit={unitLabel} value={value} onChange={setValue} {...range} />
          <Button title="Gebruik dit verbruik" disabled={value === null} onPress={() => value !== null && onConfirm(value)} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  carIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
});
