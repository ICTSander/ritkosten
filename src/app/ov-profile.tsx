import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PRODUCT_OPTIONS, type ProductId, type TransitProfile } from '@/domain/fare/products';
import { useApp } from '@/state/store';
import { AppText, Button, Card, Header, Screen, Segmented } from '@/ui/components';
import { NumberStepper } from '@/ui/NumberStepper';
import { space, usePalette } from '@/ui/theme';

/** OV discount question — onboarding step 3 and editable later from the travel profile. */
export default function OvProfileScreen() {
  const c = usePalette();
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const current = useApp((s) => s.transitProfile);
  const setTransitProfile = useApp((s) => s.setTransitProfile);

  const isStudent = current.product === 'student-week' || current.product === 'student-weekend';
  const [choice, setChoice] = useState<ProductId>(isStudent ? 'student-week' : current.product);
  const [studentKind, setStudentKind] = useState<'week' | 'weekend'>(current.product === 'student-weekend' ? 'weekend' : 'week');
  const [percent, setPercent] = useState<number | null>(current.customPercent ?? null);

  const finish = () => {
    if (onboarding) {
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
      router.push('/search');
    } else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const save = () => {
    const profile: TransitProfile =
      choice === 'student-week'
        ? { product: studentKind === 'week' ? 'student-week' : 'student-weekend' }
        : choice === 'custom'
          ? { product: 'custom', customPercent: percent ?? 0 }
          : { product: choice };
    setTransitProfile(profile);
    finish();
  };

  return (
    <Screen
      scroll
      header={<Header title={onboarding ? undefined : 'OV-korting'} />}
      footer={
        <>
          <Button title={onboarding ? 'Doorgaan' : 'Opslaan'} disabled={choice === 'custom' && percent === null} onPress={save} />
          {onboarding ? (
            <Button
              title="Sla over"
              variant="plain"
              onPress={() => {
                setTransitProfile({ product: 'none' });
                finish();
              }}
            />
          ) : null}
        </>
      }>
      <View style={{ gap: space.sm, marginTop: space.sm, marginBottom: space.xl }}>
        {onboarding ? (
          <AppText variant="caption" color={c.accent}>
            STAP 3 VAN 3
          </AppText>
        ) : null}
        <AppText variant="largeTitle" accessibilityRole="header">
          Heb je een abonnement of korting?
        </AppText>
        <AppText color={c.textSecondary}>Dan rekenen we je OV-prijs uit met jouw korting. Je kunt dit altijd wijzigen.</AppText>
      </View>

      <Card padded={false} style={{ paddingVertical: space.xs }}>
        {PRODUCT_OPTIONS.map((o, i) => {
          const selected = choice === o.id;
          return (
            <View key={o.id}>
              <Pressable
                onPress={() => setChoice(o.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${o.label}, ${o.description}`}
                style={({ pressed }) => [
                  styles.option,
                  { backgroundColor: pressed ? c.surfaceMuted : 'transparent' },
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.separator },
                ]}>
                <View style={[styles.radio, { borderColor: selected ? c.accent : c.textTertiary }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: c.accent }]} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="body">{o.label}</AppText>
                  <AppText variant="footnote" color={c.textSecondary}>
                    {o.description}
                  </AppText>
                </View>
              </Pressable>
              {selected && o.id === 'student-week' ? (
                <View style={styles.sub}>
                  <Segmented
                    value={studentKind}
                    onChange={setStudentKind}
                    options={[
                      { value: 'week', label: 'Week' },
                      { value: 'weekend', label: 'Weekend' },
                    ]}
                  />
                  <AppText variant="footnote" color={c.textSecondary}>
                    {studentKind === 'week'
                      ? 'Gratis van maandag 04:00 tot zaterdag 04:00. Daarbuiten 40% korting op de trein en 34% op bus, tram en metro.'
                      : 'Gratis van vrijdag 12:00 tot maandag 04:00. Doordeweeks vanaf 09:00 korting (40% trein, 34% bus/tram/metro).'}
                  </AppText>
                </View>
              ) : null}
              {selected && o.id === 'custom' ? (
                <View style={styles.sub}>
                  <NumberStepper label="Korting" unit="% op de trein" value={percent} onChange={setPercent} step={5} decimals={0} min={0} max={100} />
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>
      <AppText variant="footnote" color={c.textTertiary} style={{ marginTop: space.md }}>
        NS-kortingen (Dal Voordeel, Dal Vrij, Altijd Vrij) rekenen we alleen op NS-treinen. Altijd Voordeel bestaat sinds 1 juli 2026 niet meer.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 60 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  sub: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm, marginLeft: 34 },
});
