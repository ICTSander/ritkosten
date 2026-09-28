import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatUnitPrice } from '@/domain/format';
import { useFuelPrice } from '@/state/hooks';
import { useApp } from '@/state/store';
import { cacheClearAll } from '@/services/cache';
import { formatPlate } from '@/services/rdw';
import { AppText, Banner, Button, Card, Header, ListRow, Screen, SectionLabel, Segmented } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { consumptionSource, consumptionText, FUEL_LABEL, perUnit, unitWord, vehicleSubtitle, vehicleTitle } from '@/ui/labels';
import { NumberStepper } from '@/ui/NumberStepper';
import { productFor } from '@/domain/fare/products';
import { nsTrainInfoAvailable } from '@/services/transit/nsTrainInfo';
import { allTransitProviders } from '@/services/transit/registry';
import { space, usePalette } from '@/ui/theme';

export default function Settings() {
  const c = usePalette();
  const s = useApp();
  const price = useFuelPrice();
  const [editConsumption, setEditConsumption] = useState(false);
  const [draftConsumption, setDraftConsumption] = useState<number | null>(s.vehicle?.consumption?.value ?? null);
  const [editPrice, setEditPrice] = useState(false);
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const v = s.vehicle;
  const transitProduct = productFor(s.transitProfile);
  if (!v) return <Redirect href="/car" />;
  const fuel = v.pricedFuel;
  const override = s.priceOverrides[fuel];
  const isEv = fuel === 'electricity';

  return (
    <Screen scroll header={<Header title="Mijn reisprofiel" />}>
      <SectionLabel>Mijn auto</SectionLabel>
      <Card style={{ gap: space.lg }}>
        <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
          <View style={[styles.carIcon, { backgroundColor: c.accentSoft }]}>
            <Icon name={isEv ? 'bolt' : 'car'} size={22} color={c.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="headline">{vehicleTitle(v)}</AppText>
            <AppText variant="footnote" color={c.textSecondary}>
              {vehicleSubtitle(v)}
              {v.plate ? ` · ${formatPlate(v.plate)}` : ''}
            </AppText>
          </View>
        </View>
        <Button title="Andere auto kiezen" variant="secondary" onPress={() => router.push({ pathname: '/car', params: { mode: 'change' } })} />
      </Card>

      <SectionLabel>Verbruik</SectionLabel>
      <Card style={{ gap: space.md }}>
        {v.consumption ? (
          <>
            <AppText variant="title" style={{ fontFamily: 'GeistMono_600SemiBold' }}>
              {consumptionText(v.consumption)}
            </AppText>
            <AppText variant="footnote" color={c.textSecondary}>
              {consumptionSource(v.consumption)}
            </AppText>
          </>
        ) : (
          <AppText color={c.textSecondary}>Nog niet bekend.</AppText>
        )}
        {editConsumption ? (
          <>
            <NumberStepper
              label="Verbruik"
              unit={isEv ? 'kWh/100 km' : 'L/100 km'}
              value={draftConsumption}
              onChange={setDraftConsumption}
              min={isEv ? 8 : 2}
              max={isEv ? 45 : 30}
            />
            <Button
              title="Opslaan"
              disabled={draftConsumption === null}
              onPress={() => {
                if (draftConsumption !== null) s.setConsumption(draftConsumption);
                setEditConsumption(false);
              }}
            />
          </>
        ) : (
          <Button
            title="Eigen verbruik invullen"
            variant="plain"
            icon="edit"
            onPress={() => {
              setDraftConsumption(v.consumption?.value ?? null);
              setEditConsumption(true);
            }}
          />
        )}
      </Card>

      <SectionLabel>{isEv ? 'Stroomprijs' : 'Brandstofprijs'}</SectionLabel>
      <Card style={{ gap: space.md }}>
        {isEv ? (
          <Segmented
            value={s.chargingMode}
            onChange={s.setChargingMode}
            options={[
              { value: 'home', label: 'Thuis laden' },
              { value: 'public', label: 'Openbaar laden' },
            ]}
          />
        ) : null}
        {price.status === 'ready' ? (
          <>
            <AppText variant="title" style={{ fontFamily: 'GeistMono_600SemiBold' }}>
              {formatUnitPrice(price.resolved.price.pricePerUnit)}{' '}
              <AppText variant="callout" color={c.textSecondary}>
                {perUnit(fuel)}
              </AppText>
            </AppText>
            <AppText variant="footnote" color={c.textSecondary}>
              {FUEL_LABEL[fuel]} · {price.resolved.price.methodLabel}
            </AppText>
          </>
        ) : price.status === 'error' ? (
          <Banner tone="warning" icon="warning" text="De prijs van het CBS is nu niet op te halen." action={{ label: 'Opnieuw', onPress: price.reload }} />
        ) : (
          <AppText color={c.textSecondary}>Prijs ophalen…</AppText>
        )}
        {override !== undefined ? (
          <Button title="Weer automatische prijs gebruiken" variant="plain" icon="refresh" onPress={() => s.setPriceOverride(fuel, null)} />
        ) : editPrice ? (
          <>
            <NumberStepper label="Prijs" unit={`€ per ${unitWord(fuel)}`} value={draftPrice} onChange={setDraftPrice} step={0.01} decimals={3} min={0.05} max={5} />
            <Button
              title="Gebruik deze prijs"
              disabled={draftPrice === null}
              onPress={() => {
                if (draftPrice !== null) s.setPriceOverride(fuel, draftPrice);
                setEditPrice(false);
              }}
            />
          </>
        ) : (
          <Button title="Eigen prijs invullen" variant="plain" icon="edit" onPress={() => setEditPrice(true)} />
        )}
      </Card>

      <SectionLabel>Mijn OV</SectionLabel>
      <Card padded={false}>
        <ListRow
          first
          icon="ticket"
          title={transitProduct.label}
          subtitle={transitProduct.description}
          right={<AppText variant="callout" color={c.accent}>Wijzig</AppText>}
          onPress={() => router.push('/ov-profile')}
        />
      </Card>

      <SectionLabel>Vertrekpunt</SectionLabel>
      <Card padded={false}>
        <ListRow
          first
          icon={s.startMode === 'device' ? 'location' : 'pin'}
          title={s.startMode === 'device' ? 'Huidige locatie' : s.manualStart ? s.manualStart.label : 'Nog niet gekozen'}
          subtitle={s.startMode === 'device' ? 'Je locatie wordt niet bewaard' : 'Vast vertrekpunt'}
          right={<AppText variant="callout" color={c.accent}>Wijzig</AppText>}
          onPress={() => router.push({ pathname: '/search', params: { target: 'start' } })}
        />
      </Card>

      <SectionLabel>Weergave</SectionLabel>
      <Segmented
        value={s.appearance}
        onChange={s.setAppearance}
        options={[
          { value: 'system', label: 'Systeem' },
          { value: 'light', label: 'Licht' },
          { value: 'dark', label: 'Donker' },
        ]}
      />

      <SectionLabel>Privacy</SectionLabel>
      <Card padded={false}>
        <ListRow
          first
          icon="clock"
          title="Recente bestemmingen wissen"
          subtitle={`${s.recents.length} opgeslagen`}
          onPress={s.recents.length ? s.clearRecents : undefined}
        />
        <ListRow
          icon="trash"
          title={confirmReset ? 'Tik nogmaals om alles te wissen' : 'Alle gegevens wissen'}
          subtitle="Auto, bestemmingen en instellingen"
          onPress={async () => {
            if (!confirmReset) return setConfirmReset(true);
            await cacheClearAll();
            s.resetAll();
            router.replace('/car');
          }}
        />
      </Card>

      <SectionLabel>OV-databronnen</SectionLabel>
      <Card padded={false}>
        <ListRow
          first
          icon="train"
          title="NS-treininfo"
          subtitle={nsTrainInfoAvailable() ? 'Actief: drukte, treintype, zitplaatsen, faciliteiten' : 'Niet ingesteld (NS-key op de proxy nodig)'}
          right={<Icon name={nsTrainInfoAvailable() ? 'checkCircle' : 'info'} size={18} color={nsTrainInfoAvailable() ? c.success : c.textTertiary} />}
        />
        {allTransitProviders().map((p) => {
          const a = p.availability();
          return (
            <ListRow
              key={p.id}
              icon="transit"
              title={p.label}
              subtitle={a.status === 'available' ? 'Actief' : a.message}
              right={<Icon name={a.status === 'available' ? 'checkCircle' : 'info'} size={18} color={a.status === 'available' ? c.success : c.textTertiary} />}
            />
          );
        })}
      </Card>

      <SectionLabel>Over de gegevens</SectionLabel>
      <AppText variant="footnote" color={c.textSecondary} style={{ gap: 4 }}>
        Auto en verbruik: RDW Open Data. Brandstof- en stroomprijzen: CBS StatLine (landelijke gemiddelden). OV-reisadvies:
        Transitous (open OV-data, transitous.org/sources). OV-prijzen: geschat met de NS-prijslijst 2026 en regionale
        bus-/tramtarieven. Adressen: PDOK Locatieserver en Photon. Routes: OpenStreetMap via FOSSGIS/OSRM. Kaartdata © OpenStreetMap-bijdragers.
        Alle bedragen zijn schattingen.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  carIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
