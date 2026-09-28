import { Image } from 'expo-image';
import { ScrollView, View } from 'react-native';

import type { NsTrainInfo } from '../services/transit/nsTrainInfo';

/**
 * NS side-view drawings of the actual coupled units, in order.
 * NOTE: these images show the NS logo; NS's API terms forbid using NS logos — ask NS for written
 * permission before a public release (see README). Falls back to nothing when there are no images.
 */
export function TrainImages({ info, height = 44 }: { info: NsTrainInfo; height?: number }) {
  const parts = (info.carriages ?? []).filter((c) => c.image && c.width && c.height);
  if (!parts.length) return null;
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
