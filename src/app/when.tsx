import { Redirect, router } from 'expo-router';
import { View } from 'react-native';

import { useApp } from '@/state/store';
import { AppText, Button, Card, Header, Screen } from '@/ui/components';
import { Icon } from '@/ui/Icon';
import { placeIcon } from '@/ui/labels';
import { TimePicker } from '@/ui/TimePicker';
import { space, usePalette } from '@/ui/theme';

/**
 * Required step after choosing a destination: the arrival time.
 * OV journeys are then planned to arrive on time, and the car card shows the latest departure.
 */
export default function WhenScreen() {
  const c = usePalette();
  const destination = useApp((s) => s.destination);
  const timeQuery = useApp((s) => s.timeQuery);
  const setTimeQuery = useApp((s) => s.setTimeQuery);

  if (!destination) return <Redirect href="/" />;

  return (
    <Screen scroll header={<Header />}>
      <View style={{ gap: space.sm, marginTop: space.sm, marginBottom: space.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Icon name={placeIcon(destination)} size={16} color={c.accent} />
          <AppText variant="callout" color={c.textSecondary} numberOfLines={1} style={{ flex: 1 }}>
            {destination.label}
            {destination.detail ? ` · ${destination.detail}` : ''}
          </AppText>
        </View>
        <AppText variant="largeTitle" accessibilityRole="header">
          Hoe laat wil je er zijn?
        </AppText>
        <AppText color={c.textSecondary}>
          We zoeken OV-reizen die op tijd aankomen en rekenen uit wanneer je met de auto moet vertrekken.
        </AppText>
      </View>
      <Card>
        <TimePicker
          arriveOnly
          submitLabel="Vergelijk auto en OV"
          value={timeQuery.kind === 'arrive' ? timeQuery : { kind: 'now' }}
          onDone={(q) => {
            setTimeQuery(q);
            router.replace('/compare');
          }}
        />
      </Card>
      {/* For "what does it cost?" you don't need an arrival time. */}
      <Button
        title="Nu vertrekken"
        variant="plain"
        icon="clock"
        style={{ marginTop: space.md }}
        onPress={() => {
          setTimeQuery({ kind: 'now' });
          router.replace('/compare');
        }}
      />
    </Screen>
  );
}
