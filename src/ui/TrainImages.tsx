import { Image } from 'expo-image';
import { ScrollView, View } from 'react-native';

import type { NsTrainInfo } from '../services/transit/nsTrainInfo';
import { TrainArt } from './transit';

/**
 * NS's own train images show the NS logo, which NS's API terms forbid us to use without permission.
 * They're only shown when EXPO_PUBLIC_NS_TRAIN_IMAGES=1 (local testing). Store builds show our drawing.
 */
export const nsImagesEnabled = () => process.env.EXPO_PUBLIC_NS_TRAIN_IMAGES === '1';

/**
 * NS side-view drawings of the actual coupled units, in order.
 * NOTE: these images show the NS logo; NS's API terms forbid using NS logos — ask NS for written
 * permission before a public release (see README). Falls back to nothing when there are no images.
 */
export function TrainImages({ info, height = 44 }: { info: NsTrainInfo; height?: number }) {
  const parts = (info.carriages ?? []).filter((c) => c.image && c.width && c.height);
  if (!nsImagesEnabled() || !parts.length) {
    const doubleDeck = info.doubleDeck ?? false;
    return <TrainArt parts={info.parts ?? 3} doubleDeck={doubleDeck} />;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={`Afbeelding van de trein: ${parts.map((p) => p.type).join(', ')}`}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {parts.map((p, i) => (
          <Image
            key={i}
            source={{ uri: p.image }}
            style={{ height, width: (height * (p.width ?? 1)) / (p.height ?? 1) }}
            contentFit="contain"
            transition={150}
          />
        ))}
      </View>
    </ScrollView>
  );
}
