import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { productFor } from '@/domain/fare/products';
import { formatEuroCents } from '@/domain/format';
import type { Place } from '@/domain/types';
import { useOnline } from '@/state/hooks';
import { useApp } from '@/state/store';
import { AppText, Banner, Card, IconButton, ListRow, Screen, SectionLabel } from '@/ui/components';
import { Icon, type IconName } from '@/ui/Icon';
import { placeIcon, vehicleChip } from '@/ui/labels';
import { fonts, radius, space, type, usePalette } from '@/ui/theme';

export default function Home() {
  const c = usePalette();
  const vehicle = useApp((s) => s.vehicle);
  const recents = useApp((s) => s.recents);
  const startMode = useApp((s) => s.startMode);
  const manualStart = useApp((s) => s.manualStart);
  const transitProfile = useApp((s) => s.transitProfile);
  const setDestination = useApp((s) => s.setDestination);
  const online = useOnline();

  if (!vehicle) return <Redirect href="/car" />;

  const openRecent = (place: Place) => {
    setDestination(place);
    router.push('/when');
  };
  const startLabel = startMode === 'device' ? 'Mijn huidige locatie' : manualStart ? manualStart.label : 'Kies bij je eerste rit';
  const product = productFor(transitProfile);

  return (
    <Screen
      scroll
      header={
        <View style={styles.top}>
          <View style={styles.pills}>
            <Pill icon={vehicle.pricedFuel === 'electricity' ? 'bolt' : 'car'} text={vehicleChip(vehicle)} label={`Mijn auto: ${vehicle.make} ${vehicle.model}`} />
            <Pill icon="transit" text={`OV · ${product.id === 'none' ? 'vol tarief' : product.label}`} label={`OV-korting: ${product.label}`} />
          </View>
          <IconButton icon="settings" label="Mijn reisprofiel" onPress={() => router.push('/settings')} />
        </View>
      }>
      {!online ? (
        <View style={{ marginTop: space.sm }}>
          <Banner tone="warning" icon="offline" text="Geen internet. Zodra je weer online bent kun je een reis vergelijken." />
        </View>
      ) : null}

      <AppText variant="largeTitle" style={styles.title} accessibilityRole="header">
        Waar wil je naartoe?
      </AppText>

      <Pressable
        onPress={() => router.push('/search')}
        accessibilityRole="search"
        accessibilityLabel="Zoek een bestemming"
        style={({ pressed }) => [styles.fakeSearch, { backgroundColor: c.surface, borderColor: c.separator, opacity: pressed ? 0.85 : 1 }]}>
        <Icon name="search" size={22} color={c.accent} />
        <AppText style={[type.body, { color: c.textTertiary }]}>Zoek adres, plaats of station</AppText>
      </Pressable>

      <View style={[styles.settingsRow, { borderColor: c.separator }]}>
        <Pressable
          onPress={() => router.push({ pathname: '/search', params: { target: 'start' } })}
          accessibilityRole="button"
          accessibilityLabel={`Vertrek vanaf ${startLabel}. Wijzigen`}
          style={styles.settingItem}>
          <Icon name={startMode === 'device' ? 'location' : 'pin'} size={16} color={c.accent} />
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color={c.textSecondary}>
              VERTREK VANAF
            </AppText>
            <AppText variant="callout" numberOfLines={1}>
              {startLabel}
            </AppText>
          </View>
        </Pressable>
      </View>

      {recents.length > 0 ? (
        <>
          <SectionLabel>Recent</SectionLabel>
          <Card padded={false}>
            {recents.slice(0, 5).map((r, i) => (
              <ListRow
                key={r.place.id}
                first={i === 0}
                icon={placeIcon(r.place)}
                title={r.place.label}
                subtitle={r.place.detail}
                onPress={() => openRecent(r.place)}
                accessibilityLabel={`${r.place.label}${r.lastCostCents !== undefined ? `, auto ${formatEuroCents(r.lastCostCents)}` : ''}${r.lastTransitCents !== undefined ? `, OV ${formatEuroCents(r.lastTransitCents)}` : ''}`}
                right={
                  r.lastCostCents !== undefined || r.lastTransitCents !== undefined ? (
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      {r.lastCostCents !== undefined ? <PriceTag icon="car" cents={r.lastCostCents} /> : null}
                      {r.lastTransitCents !== undefined ? <PriceTag icon="transit" cents={r.lastTransitCents} /> : null}
                    </View>
                  ) : undefined
                }
              />
            ))}
          </Card>
        </>
      ) : (
        <AppText variant="callout" color={c.textTertiary} style={{ marginTop: space.xxl, textAlign: 'center' }}>
          Je recente bestemmingen verschijnen hier.
        </AppText>
      )}
    </Screen>
  );
}

function Pill({ icon, text, label }: { icon: IconName; text: string; label: string }) {
  const c = usePalette();
  return (
    <Pressable
      onPress={() => router.push('/settings')}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Wijzigen`}
      hitSlop={6}
      style={({ pressed }) => [styles.pill, { backgroundColor: c.surface, borderColor: c.separator, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} size={15} color={c.accent} />
      <AppText variant="caption" numberOfLines={1} style={{ fontSize: 13 }}>
        {text}
      </AppText>
    </Pressable>
  );
}

function PriceTag({ icon, cents }: { icon: IconName; cents: number }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={12} color={c.textTertiary} />
      <AppText variant="caption" color={c.textSecondary} style={{ fontFamily: fonts.mono, fontSize: 13 }}>
        {formatEuroCents(cents)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.sm, width: '100%', maxWidth: 580, alignSelf: 'center', gap: space.sm },
  pills: { flexDirection: 'row', gap: space.sm, flex: 1, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, maxWidth: '100%' },
  title: { marginTop: space.xxxl, marginBottom: space.xl },
  fakeSearch: { flexDirection: 'row', alignItems: 'center', gap: space.md, height: 64, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.xl, boxShadow: '0px 1px 2px rgba(15,18,22,0.05), 0px 8px 24px rgba(15,18,22,0.06)' },
  settingsRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: space.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: space.md },
  settingItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: space.xs },
  divider: { width: StyleSheet.hairlineWidth, marginHorizontal: space.sm },
});
