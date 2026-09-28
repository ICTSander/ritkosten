import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, StyleSheet, type TextInput, View } from 'react-native';

import { formatDecimal } from '@/domain/format';
import { useAsyncResource, useDebounced } from '@/state/hooks';
import { useApp } from '@/state/store';
import {
  fetchModels,
  fetchVariants,
  fetchYears,
  filterModels,
  isValidPlate,
  lookupPlate,
  median,
  type MakeOption,
  type ModelOption,
  searchMakes,
  splitMakeQuery,
  UnsupportedVehicleError,
  type VariantOption,
  vehicleFromVariant,
} from '@/services/rdw';
import {
  AppText,
  Banner,
  Button,
  Card,
  Chip,
  Header,
  ListRow,
  Screen,
  SearchField,
  SectionLabel,
  Skeleton,
} from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { consumptionText, errorMessage } from '@/ui/labels';
import { PlateInput } from '@/ui/PlateInput';
import { space, usePalette } from '@/ui/theme';

type Step =
  | { kind: 'search' }
  | { kind: 'years'; make: MakeOption; model: ModelOption }
  | { kind: 'variants'; make: MakeOption; model: ModelOption; year: number };

type Async<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; data: T } | { status: 'error'; error: unknown };

export default function CarScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isChange = mode === 'change';
  const [step, setStep] = useState<Step>({ kind: 'search' });

  const back =
    step.kind === 'variants'
      ? () => setStep({ kind: 'years', make: step.make, model: step.model })
      : step.kind === 'years'
        ? () => setStep({ kind: 'search' })
        : isChange
          ? undefined
          : false;

  return (
    <Screen scroll header={<Header onBack={back} title={isChange ? 'Andere auto' : undefined} />}>
      {step.kind === 'search' ? (
        <SearchStep onPickModel={(make, model) => setStep({ kind: 'years', make, model })} isChange={isChange} />
      ) : step.kind === 'years' ? (
        <YearStep make={step.make} model={step.model} onPick={(year) => setStep({ ...step, kind: 'variants', year })} />
      ) : (
        <VariantStep make={step.make} model={step.model} year={step.year} />
      )}
    </Screen>
  );
}

/** Finish: store vehicle and go to the "Bijna klaar" screen. */
function finish(vehicle: Parameters<ReturnType<typeof useApp.getState>['setVehicle']>[0], suggest?: number) {
  useApp.getState().setVehicle(vehicle);
  router.push({ pathname: '/ready', params: suggest ? { suggest: String(suggest) } : {} });
}

// ---- Step 1: search make/model or type a plate --------------------------------------

function SearchStep({ onPickModel, isChange }: { onPickModel: (m: MakeOption, model: ModelOption) => void; isChange: boolean }) {
  const c = usePalette();
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  const split = useMemo(() => splitMakeQuery(query), [query]);
  const [reload, setReload] = useState(0);

  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState<Async<null>>({ status: 'idle' });

  const makeKey = split?.make.rdw;
  const models = useAsyncResource(makeKey ? `${makeKey}|${reload}` : null, (signal) => fetchModels(makeKey!, { signal }));

  const debouncedRest = useDebounced(split?.rest ?? '', 120);
  const makes = split ? [] : query.trim() ? searchMakes(query) : [];
  const modelList = split && models.status === 'ok' ? filterModels(models.data, debouncedRest) : [];

  const submitPlate = async () => {
    if (plateState.status === 'loading') return; // Enter pressed twice
    if (!isValidPlate(plate)) {
      setPlateState({ status: 'error', error: 'invalid' });
      return;
    }
    Keyboard.dismiss();
    setPlateState({ status: 'loading' });
    try {
      const vehicle = await lookupPlate(plate);
      setPlateState({ status: 'idle' });
      finish(vehicle);
    } catch (error) {
      setPlateState({ status: 'error', error });
    }
  };

  const plateError =
    plateState.status !== 'error'
      ? null
      : plateState.error === 'invalid'
        ? 'Een Nederlands kenteken heeft 6 letters en cijfers, bijvoorbeeld AB-123-C.'
        : plateState.error instanceof UnsupportedVehicleError
          ? plateState.error.reason === 'not-a-car'
            ? 'Dit kenteken hoort niet bij een personenauto. Ritkosten werkt voorlopig alleen voor personenauto’s.'
            : 'Deze auto rijdt op een brandstof die we nog niet ondersteunen (bijvoorbeeld waterstof of aardgas).'
        : (plateState.error as { kind?: string })?.kind === 'not-found'
          ? 'We vinden geen personenauto met dit kenteken. Controleer het kenteken of zoek op merk en model.'
          : errorMessage(plateState.error, 'Kenteken opzoeken');

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm, marginTop: space.sm }}>
        {!isChange ? (
          <AppText variant="caption" color={c.accent}>
            STAP 1 VAN 3
          </AppText>
        ) : null}
        <AppText variant="largeTitle" accessibilityRole="header">
          Welke auto rijd je?
        </AppText>
        <AppText color={c.textSecondary}>Dan zoeken we zelf het verbruik en de brandstof op.</AppText>
      </View>

      <SearchField
        inputRef={inputRef}
        value={query}
        onChangeText={setQuery}
        onClear={() => setQuery('')}
        placeholder="Zoek merk of model…"
        accessibilityLabel="Zoek merk of model"
        autoCapitalize="words"
        autoFocus={false}
      />

      {makes.length > 0 ? (
        <Card padded={false}>
          {makes.map((m, i) => (
            <ListRow
              key={m.rdw}
              first={i === 0}
              title={m.display}
              icon="car"
              right={<Icon name="chevron" size={16} color={c.textTertiary} />}
              onPress={() => {
                setQuery(`${m.display} `);
                inputRef.current?.focus();
              }}
            />
          ))}
        </Card>
      ) : null}

      {query.trim() && !split && makes.length === 0 ? (
        <AppText color={c.textSecondary}>
          Geen merk gevonden voor ‘{query.trim()}’. Begin met het merk, bijvoorbeeld ‘Volkswagen’.
        </AppText>
      ) : null}

      {split ? (
        models.status === 'loading' ? (
          <Card padded={false}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton width="45%" height={16} />
              </View>
            ))}
            <AppText variant="footnote" color={c.textSecondary} style={{ padding: space.lg, paddingTop: 0 }}>
              Modellen van {split.make.display} ophalen bij de RDW…
            </AppText>
          </Card>
        ) : models.status === 'error' ? (
          <Banner
            tone="error"
            icon="warning"
            text={errorMessage(models.error, 'Modellen ophalen')}
            action={{ label: 'Opnieuw', onPress: () => setReload((n) => n + 1) }}
          />
        ) : modelList.length > 0 ? (
          <Card padded={false}>
            {modelList.map((m, i) => (
              <ListRow
                key={m.key}
                first={i === 0}
                title={`${split.make.display} ${m.display}`}
                icon="car"
                right={<Icon name="chevron" size={16} color={c.textTertiary} />}
                onPress={() => {
                  Keyboard.dismiss();
                  onPickModel(split.make, m);
                }}
              />
            ))}
          </Card>
        ) : models.status === 'ok' ? (
          <AppText color={c.textSecondary}>
            Geen model ‘{debouncedRest}’ gevonden bij {split.make.display}. Controleer de schrijfwijze of vul je kenteken in.
          </AppText>
        ) : null
      ) : null}

      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: c.separator }]} />
        <AppText variant="footnote" color={c.textSecondary}>
          of sneller, met je kenteken
        </AppText>
        <View style={[styles.line, { backgroundColor: c.separator }]} />
      </View>

      <PlateInput
        value={plate}
        onChangeText={(v) => {
          setPlate(v);
          if (plateState.status === 'error') setPlateState({ status: 'idle' });
        }}
        onSubmit={submitPlate}
      />
      {plateError ? <Banner tone="error" icon="warning" text={plateError} /> : null}
      <Button
        title={plateState.status === 'loading' ? 'Auto opzoeken bij de RDW…' : 'Zoek op kenteken'}
        onPress={submitPlate}
        loading={plateState.status === 'loading'}
        disabled={plate.trim().length === 0}
        variant="secondary"
      />
      <AppText variant="footnote" color={c.textTertiary}>
        We gebruiken je kenteken alleen om je auto op te zoeken in de openbare RDW-gegevens.
      </AppText>
    </View>
  );
}

// ---- Step 2: year ------------------------------------------------------------------------

function StepTitle({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: space.sm, marginTop: space.sm, marginBottom: space.lg }}>
      <AppText variant="caption" color={c.accent}>
        {eyebrow.toUpperCase()}
      </AppText>
      <AppText variant="largeTitle" accessibilityRole="header">
        {title}
      </AppText>
      {sub ? <AppText color={c.textSecondary}>{sub}</AppText> : null}
    </View>
  );
}

function YearStep({ make, model, onPick }: { make: MakeOption; model: ModelOption; onPick: (y: number) => void }) {
  const [reload, setReload] = useState(0);
  const state = useAsyncResource(`${make.rdw}|${model.key}|${reload}`, (signal) => fetchYears(make.rdw, model, { signal }));

  return (
    <View>
      <StepTitle eyebrow={`${make.display} ${model.display}`} title="Welk bouwjaar?" />
      {state.status === 'loading' ? (
        <View style={styles.chips}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} width={72} height={40} style={{ borderRadius: 20 }} />
          ))}
        </View>
      ) : state.status === 'error' ? (
        <Banner
          tone="error"
          icon="warning"
          text={errorMessage(state.error, 'Bouwjaren ophalen')}
          action={{ label: 'Opnieuw', onPress: () => setReload((n) => n + 1) }}
        />
      ) : state.status === 'ok' && state.data.length === 0 ? (
        <Banner tone="info" icon="info" text="Geen bouwjaren gevonden voor dit model. Probeer je kenteken." />
      ) : state.status === 'ok' ? (
        <View style={styles.chips}>
          {state.data.map((y) => (
            <Chip key={y} label={String(y)} onPress={() => onPick(y)} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---- Step 3: engine variant --------------------------------------------------------------

function VariantStep({ make, model, year }: { make: MakeOption; model: ModelOption; year: number }) {
  const c = usePalette();
  const [reload, setReload] = useState(0);
  const state = useAsyncResource(`${make.rdw}|${model.key}|${year}|${reload}`, (signal) =>
    fetchVariants(make.rdw, model, year, { signal }),
  );

  const pick = (variant: VariantOption, all: VariantOption[]) => {
    // When RDW has no consumption for this variant, suggest the median of the same model's
    // variants on the same fuel — the user only confirms or adjusts it.
    const sameFuel = all.filter((v) => v.pricedFuel === variant.pricedFuel && v.consumption && v.energy !== 'phev');
    const suggest = variant.consumption ? undefined : median(sameFuel.map((v) => v.consumption!.value));
    finish(vehicleFromVariant(make, model, year, variant), suggest ? Math.round(suggest * 10) / 10 : undefined);
  };

  // Only one variant → nothing to choose.
  useEffect(() => {
    if (state.status === 'ok' && state.data.length === 1) pick(state.data[0], state.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <View>
      <StepTitle
        eyebrow={`${make.display} ${model.display} · ${year}`}
        title="Welke uitvoering?"
        sub="Het verbruik zoeken we zelf op. Kies de motor die bij je auto past."
      />
      {state.status === 'loading' ? (
        <Card padded={false}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.skeletonRow, { justifyContent: 'space-between', flexDirection: 'row' }]}>
              <Skeleton width="40%" height={16} />
              <Skeleton width={84} height={16} />
            </View>
          ))}
          <AppText variant="footnote" color={c.textSecondary} style={{ padding: space.lg, paddingTop: 0 }}>
            Uitvoeringen en verbruik ophalen bij de RDW…
          </AppText>
        </Card>
      ) : state.status === 'error' ? (
        <Banner
          tone="error"
          icon="warning"
          text={
            (state.error as { kind?: string })?.kind === 'not-found'
              ? 'Voor dit bouwjaar vinden we geen auto’s bij de RDW. Kies een ander jaar of gebruik je kenteken.'
              : errorMessage(state.error, 'Uitvoeringen ophalen')
          }
          action={{ label: 'Opnieuw', onPress: () => setReload((n) => n + 1) }}
        />
      ) : state.status === 'ok' && state.data.length === 0 ? (
        <Banner tone="info" icon="info" text="Voor dit bouwjaar vinden we geen uitvoeringen die we kunnen doorrekenen. Kies een ander jaar of gebruik je kenteken." />
      ) : state.status === 'ok' ? (
        <>
          <Card padded={false}>
            {state.data.map((v, i) => (
              <ListRow
                key={v.id}
                first={i === 0}
                title={v.label}
                subtitle={v.sublabel || undefined}
                icon={v.pricedFuel === 'electricity' ? 'bolt' : 'fuel'}
                onPress={() => pick(v, state.data)}
                accessibilityLabel={`${v.label}, ${v.sublabel}, ${v.consumption ? consumptionText(v.consumption) : 'verbruik onbekend'}`}
                right={
                  <AppText variant="numeric" color={v.consumption ? c.text : c.textTertiary}>
                    {v.consumption ? consumptionText(v.consumption) : 'onbekend'}
                  </AppText>
                }
              />
            ))}
          </Card>
          <SectionLabel>Hoe we dit weten</SectionLabel>
          <AppText variant="footnote" color={c.textSecondary}>
            Gebaseerd op een steekproef van {formatDecimal(state.data.reduce((n, v) => n + v.count, 0), 0)} in Nederland geregistreerde{' '}
            {make.display} {model.display}’s uit {year} (RDW). Per uitvoering tonen we het officiële gecombineerde
            verbruik (mediaan).
          </AppText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonRow: { height: 60, paddingHorizontal: space.lg, justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
});
