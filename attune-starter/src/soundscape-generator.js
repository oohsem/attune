/**
 * Theme-based random soundscape generation.
 * Adapted to Attune's existing AUDIO_CATALOG without a new audio manifest.
 * Each generated mix contains up to four tracks from distinct collections.
 */
export const SOUND_GROUPS = [
  { id: 'nature', name: 'Nature & Wildlife', collections: ['Amber Footpath', 'Ancient Canopy', 'Hollow Grove', 'Lantern Courtyard', 'Open Pasture', 'Twilight Chorus', 'Wetland Chorus'] },
  { id: 'water', name: 'Water & Coast', collections: ['Atlantic Reach', 'Cascading Veil', 'Coastal Crossroads', 'Silver Tributary'] },
  { id: 'weather', name: 'Rain & Storm', collections: ['Tempest Shelter', 'Amber Footpath', 'Ancient Canopy', 'Atlantic Reach'] },
  { id: 'ambient', name: 'Ambient Worlds', collections: ['Distant Reverie', 'Inner Haven', 'Pelagic Drift', 'Stone Vault'] },
  { id: 'tones', name: 'Focus & Tones', collections: ['Ivory Afterglow', 'Resonant Ladder', 'Spectral Haze', 'Twin Currents'] }
];

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateThemeMix(themeId, catalog, maxLayers = 4) {
  const group = SOUND_GROUPS.find(item => item.id === themeId);
  if (!group) return [];
  const matchingTrack = {
    water: /\b(water|wave|waves|ocean|shore|sea|stream|river|brook|creek|waterfall|gurgle|loch|seaside|pebbles|cavity)\b/i,
    weather: /\b(rain|thunder|storm|hail|wind|droplets|rumble)\b/i
  }[themeId];
  const byCollection = new Map();
  for (const track of catalog) {
    if (!group.collections.includes(track.collection)) continue;
    if (matchingTrack && !matchingTrack.test(track.name)) continue;
    if (!byCollection.has(track.collection)) byCollection.set(track.collection, []);
    byCollection.get(track.collection).push(track);
  }
  return shuffle([...byCollection.keys()])
    .slice(0, Math.min(Math.max(1, maxLayers), 4))
    .map(collection => {
      const files = byCollection.get(collection);
      return files[Math.floor(Math.random() * files.length)];
    });
}
