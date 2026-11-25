/** Attune saved collection + listening-based Soundprint suggestions.
 * No MP3 bytes or personal profile data are stored here: only references and
 * user-controlled session metadata, in this browser's localStorage.
 */
const SAVED_KEY = 'attune.soundscapes.v1'; // preserve existing Attune saves
const HISTORY_KEY = 'attune.soundprint.history.v1';
const HOME_SLOTS = [1, 2, 4, 5, 6, 7]; // h3 is always the rightmost Library hex
const HISTORY_LIMIT = 120;
const MAX_TITLE = 48;

const THEMES = [
  { id: 'rain', title: 'Rain Drift', pattern: /rain|storm|thunder|drizzle|droplet|downpour/i, fallback: 'rain', mode: 'relax' },
  { id: 'water', title: 'Water Flow', pattern: /water|wave|ocean|sea|stream|river|coast|shore|cascad/i, fallback: 'water', mode: 'relax' },
  { id: 'wind', title: 'Open Air', pattern: /wind|breeze|gust|air|rustl/i, fallback: 'wind', mode: 'relax' },
  { id: 'wildlife', title: 'Forest Life', pattern: /bird|forest|woodland|wildlife|tree|leaf|leaves|canopy/i, fallback: 'wind', mode: 'relax' },
  { id: 'ambient', title: 'Ambient Glow', pattern: /ambient|pad|drone|texture|hum|reverie|haze|haven/i, fallback: 'ambient', mode: 'relax' },
  { id: 'night', title: 'Night Chorus', pattern: /night|cricket|evening|twilight|owl|nocturn/i, fallback: 'relax', mode: 'relax' },
  { id: 'focus', title: 'Focus Tones', pattern: /piano|tone|chime|resonan|spectral|ivory|frequency|ladder/i, fallback: 'focus', mode: 'focus' }
];

const safelyRead = (key, fallback = []) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
};
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
const cleanVolume = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
const cleanSounds = sounds => sounds.map(sound => ({
  name: String(sound.name || sound.synthType || 'Sound').slice(0, 100),
  ...(typeof sound.audioId === 'string' ? { audioId: sound.audioId } : {}),
  ...(typeof sound.synthType === 'string' ? { synthType: sound.synthType } : {}),
  volume: cleanVolume(sound.volume)
}));
function validSaved(item, index) {
  if (!item || typeof item.id !== 'string' || !Array.isArray(item.sounds)) return null;
  // Older Attune saves have no timestamps/pin counters; keep them unchanged.
  const originalTime = Number(item.id);
  const legacyTime = originalTime > 1e12 && originalTime < 4e12 ? originalTime : Date.now() - index * 1000;
  return {
    ...item,
    title: String(item.title || 'Untitled Soundscape').slice(0, MAX_TITLE),
    mode: item.mode === 'focus' ? 'focus' : 'relax',
    sounds: cleanSounds(item.sounds),
    pinned: item.pinned === true,
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : legacyTime,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : legacyTime,
    lastPlayedAt: Number.isFinite(item.lastPlayedAt) ? item.lastPlayedAt : 0,
    playCount: Number.isFinite(item.playCount) ? item.playCount : 0
  };
}
function signature(mode, sounds) {
  return `${mode === 'focus' ? 'focus' : 'relax'}:` + sounds.map(sound =>
    `${sound.audioId || sound.synthType || 'unknown'}:${cleanVolume(sound.volume).toFixed(2)}`
  ).sort().join(',');
}
const shortLabel = text => String(text || '').trim().slice(0, 38);
function button(className, label, attributes = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}
function classify(sound) {
  const text = [sound?.name, sound?.synthType, sound?.audioId, sound?.collection].filter(Boolean).join(' ');
  return THEMES.filter(theme => theme.pattern.test(text)).map(theme => theme.id);
}
function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createSoundscapeHome({ catalog, onPlaySaved, onCreate, onBack, onChanged, notify }) {
  const grid = document.getElementById('savedSoundscapeGrid');
  const recommendationGrid = document.getElementById('soundprintGrid');
  const libraryScreen = document.getElementById('screen-library');
  const search = document.getElementById('savedLibrarySearch');
  const sort = document.getElementById('savedLibrarySort');
  const libraryResults = document.getElementById('savedLibraryResults');
  const libraryCount = document.getElementById('savedLibraryCount');
  const recommendations = new Map();

  function getAll() {
    return safelyRead(SAVED_KEY).map(validSaved).filter(Boolean);
  }
  function getById(id) { return getAll().find(item => item.id === id); }
  function commit(next, okMessage) {
    if (!write(SAVED_KEY, next)) { notify('Unable to save changes on this device'); return false; }
    renderHome();
    if (libraryScreen.classList.contains('active')) renderLibrary();
    onChanged();
    if (okMessage) notify(okMessage);
    return true;
  }
  function hasSession(mode, sounds) {
    if (!sounds?.length) return false;
    const sig = signature(mode, sounds);
    return getAll().some(item => signature(item.mode, item.sounds) === sig);
  }
  function toggleSession({ title, mode, sounds }) {
    if (!sounds?.length) { notify('Add some sounds before saving'); return false; }
    const all = getAll();
    const sig = signature(mode, sounds);
    const index = all.findIndex(item => signature(item.mode, item.sounds) === sig);
    if (index !== -1) {
      all.splice(index, 1);
      return commit(all, 'Removed from saved Soundscapes');
    }
    all.unshift({
      id: (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      title: String(title || 'My Soundscape').trim().slice(0, MAX_TITLE),
      mode: mode === 'focus' ? 'focus' : 'relax',
      sounds: cleanSounds(sounds),
      pinned: false,
      createdAt: Date.now(), updatedAt: Date.now(),
      lastPlayedAt: 0, playCount: 0
    });
    return commit(all, 'Saved to your Soundscapes');
  }
  function markPlayed(id) {
    const all = getAll();
    const item = all.find(entry => entry.id === id);
    if (!item) return;
    item.lastPlayedAt = Date.now();
    item.playCount += 1;
    // This is a lightweight metadata update. Playback continues if storage is off.
    if (write(SAVED_KEY, all)) { renderHome(); onChanged(); }
  }
  function rename(id, nextName) {
    const name = String(nextName || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE);
    if (!name) { notify('Please enter a Soundscape name'); return false; }
    const all = getAll();
    const item = all.find(entry => entry.id === id);
    if (!item) return false;
    item.title = name;
    item.updatedAt = Date.now();
    return commit(all, 'Soundscape renamed');
  }
  function togglePin(id) {
    const all = getAll();
    const item = all.find(entry => entry.id === id);
    if (!item) return;
    item.pinned = !item.pinned;
    item.updatedAt = Date.now();
    commit(all, item.pinned ? 'Pinned to Home' : 'Unpinned');
  }
  function remove(id) {
    const all = getAll();
    const item = all.find(entry => entry.id === id);
    if (!item) return;
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
    commit(all.filter(entry => entry.id !== id), 'Soundscape deleted');
  }

  function homeOrder(a, b) {
    return Number(b.pinned) - Number(a.pinned) ||
      (b.lastPlayedAt || b.updatedAt) - (a.lastPlayedAt || a.updatedAt) ||
      b.createdAt - a.createdAt;
  }
  function renderSavedHexes() {
    const all = getAll();
    const featured = all.slice().sort(homeOrder).slice(0, 6);
    grid.replaceChildren();
    document.getElementById('savedSubtitle').textContent = all.length
      ? `${all.length} saved · pinned & recent` : 'Your collection starts here';

    HOME_SLOTS.forEach((position, index) => {
      const item = featured[index];
      if (item) {
        const hex = button(`hex-card home-preset home-hex h${position} saved-home-hex`, '', {
          'data-saved-id': item.id, 'aria-label': `Play saved Soundscape ${item.title}`,
          title: item.title
        });
        const label = document.createElement('span');
        label.textContent = shortLabel(item.title);
        hex.appendChild(label);
        if (item.pinned) {
          const pin = document.createElement('i');
          pin.className = 'saved-hex-pin';
          pin.textContent = '★';
          pin.setAttribute('aria-hidden', 'true');
          hex.appendChild(pin);
        }
        grid.appendChild(hex);
      } else if (index === featured.length) {
        const create = button(`hex-card home-hex h${position} saved-create-hex`, '', {
          'data-home-action': 'create', 'aria-label': 'Create and save your first Soundscape'
        });
        const text = document.createElement('span');
        text.textContent = '+ Create';
        create.appendChild(text);
        grid.appendChild(create);
      } else {
        const placeholder = document.createElement('div');
        placeholder.className = `hex-card home-hex h${position} saved-empty-hex`;
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.innerHTML = '<span>+</span>';
        grid.appendChild(placeholder);
      }
    });
    // Position 3 is the far-right hexagon, always reserved for the full library.
    const library = button('hex-card home-hex h3 saved-library-hex', '', {
      'data-home-action': 'library', 'aria-label': 'Open all saved Soundscapes'
    });
    const text = document.createElement('span');
    text.textContent = 'Library';
    library.appendChild(text);
    grid.appendChild(library);
  }

  function recordListen(mode, sounds) {
    if (!Array.isArray(sounds) || !sounds.length) return;
    const history = safelyRead(HISTORY_KEY);
    history.unshift({
      at: Date.now(), mode: mode === 'focus' ? 'focus' : 'relax',
      sounds: cleanSounds(sounds).map(({ name, synthType, audioId }) => ({ name, synthType, audioId }))
    });
    write(HISTORY_KEY, history.slice(0, HISTORY_LIMIT));
  }
  function themeScores() {
    const scores = new Map(THEMES.map(theme => [theme.id, 0]));
    for (const entry of safelyRead(HISTORY_KEY)) {
      for (const sound of (Array.isArray(entry.sounds) ? entry.sounds : [])) {
        for (const id of classify(sound)) scores.set(id, scores.get(id) + 1);
      }
      if (entry.mode === 'focus') scores.set('focus', scores.get('focus') + 0.4);
    }
    for (const entry of getAll()) {
      const weight = entry.pinned ? 4 : 2;
      for (const sound of entry.sounds) {
        for (const id of classify(sound)) scores.set(id, scores.get(id) + weight);
      }
    }
    return scores;
  }
  function makeMix(theme, reason) {
    const matching = catalog.filter(track => theme.pattern.test(`${track.name} ${track.collection}`));
    const picked = [];
    const collections = new Set();
    for (const track of shuffled(matching)) {
      if (collections.has(track.collection) && collections.size < 3) continue;
      picked.push(track);
      collections.add(track.collection);
      if (picked.length === 3) break;
    }
    if (picked.length < 2) {
      for (const track of shuffled(matching)) {
        if (picked.some(item => item.id === track.id)) continue;
        picked.push(track);
        if (picked.length === 3) break;
      }
    }
    const sounds = picked.length ? picked.map(track => ({
      name: track.name, audioId: track.id, synthType: 'drone', volume: 0.5
    })) : [{ name: theme.title, synthType: theme.fallback === 'focus' ? 'drone' : theme.fallback, volume: 0.5 }];
    return { id: theme.id, title: theme.title, mode: theme.mode, sounds, reason };
  }
  function renderSoundprint() {
    const scores = themeScores();
    const withSignals = [...scores.values()].some(value => value > 0);
    // If a new user has only one known preference, suggest a related theme
    // rather than presenting an unrelated item as personalized.
    const neighbors = { rain: 'wind', water: 'rain', wind: 'wildlife', wildlife: 'wind', ambient: 'night', night: 'ambient', focus: 'ambient' };
    if (withSignals) {
      const first = THEMES.slice().sort((a, b) => scores.get(b.id) - scores.get(a.id))[0];
      if (scores.get(neighbors[first.id]) === 0) scores.set(neighbors[first.id], scores.get(first.id) * 0.3);
    }
    // Two preference-based themes (or curated starters), one exploration theme.
    const ranking = THEMES.slice().sort((a, b) => scores.get(b.id) - scores.get(a.id));
    const primary = withSignals ? ranking.slice(0, 2) : [THEMES[0], THEMES[1]];
    const pool = THEMES.filter(theme => !primary.includes(theme));
    const discovery = pool[Math.floor(Math.random() * pool.length)] || THEMES[2];
    const picks = [
      makeMix(primary[0], withSignals ? 'Based on your listening and saved sounds' : 'Recommended starter mix'),
      makeMix(primary[1], withSignals ? 'Inspired by your Soundprint' : 'Recommended starter mix'),
      makeMix(discovery, 'Discover something different')
    ];
    recommendations.clear();
    recommendationGrid.replaceChildren();
    picks.forEach((mix, index) => {
      const key = `${mix.id}-${index}`;
      recommendations.set(key, mix);
      const hex = button('hex-card home-preset soundprint-hex', '', {
        'data-recommendation-id': key,
        'aria-label': `Play ${mix.title}. ${mix.reason}`,
        title: `${mix.title} · ${mix.reason}`
      });
      const label = document.createElement('span');
      label.textContent = mix.title;
      hex.appendChild(label);
      if (index === 2) hex.classList.add('soundprint-discovery-hex');
      recommendationGrid.appendChild(hex);
    });
    document.getElementById('soundprintSubtitle').textContent = withSignals
      ? 'For you · one new discovery' : 'Explore recommended mixes';
  }
  function getRecommendation(id) { return recommendations.get(id); }
  function renderHome() { renderSavedHexes(); renderSoundprint(); }

  // All library controls remain in the library screen. Search filters as you type.
  function renderLibrary() {
    const term = search.value.trim().toLocaleLowerCase();
    const all = getAll();
    let items = all.filter(item => `${item.title} ${item.sounds.map(s => s.name).join(' ')}`.toLocaleLowerCase().includes(term));
    if (sort.value === 'played') items.sort((a, b) => b.playCount - a.playCount || homeOrder(a,b));
    else if (sort.value === 'recent') items.sort((a,b) => Math.max(b.lastPlayedAt, b.updatedAt) - Math.max(a.lastPlayedAt, a.updatedAt));
    else items.sort(homeOrder);
    libraryCount.textContent = `${all.length} saved Soundscape${all.length === 1 ? '' : 's'}`;
    libraryResults.replaceChildren();
    if (!all.length) {
      const empty = document.createElement('div');
      empty.className = 'saved-library-empty';
      const heading = document.createElement('h2');
      heading.textContent = 'Your library is ready';
      const description = document.createElement('p');
      description.textContent = 'Start a mix, adjust it in the mixer, then tap the heart to save it here.';
      const create = button('saved-library-create', 'Create a Soundscape', { 'data-library-action': 'create' });
      empty.append(heading, description, create);
      libraryResults.appendChild(empty);
      return;
    }
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'saved-library-no-results';
      empty.textContent = 'No matching Soundscapes';
      libraryResults.appendChild(empty);
      return;
    }
    for (const entry of items) {
      const card = document.createElement('article');
      card.className = 'saved-library-card';
      card.dataset.savedId = entry.id;
      const head = document.createElement('div');
      head.className = 'saved-library-card-head';
      const title = document.createElement('h3');
      title.textContent = entry.title;
      const meta = document.createElement('p');
      const count = entry.sounds.length;
      meta.textContent = `${count} sound${count === 1 ? '' : 's'} · ${entry.mode === 'focus' ? 'Focus' : 'Relax'} · ${entry.playCount} play${entry.playCount === 1 ? '' : 's'}`;
      head.append(title, meta);
      const actions = document.createElement('div');
      actions.className = 'saved-library-actions';
      const controls = [
        ['play', '▶ Play'], ['pin', entry.pinned ? '★ Unpin' : '☆ Pin'],
        ['rename', '✎ Rename'], ['delete', 'Delete']
      ];
      for (const [action, label] of controls) {
        const btn = button('saved-library-action', label, {
          'data-library-action': action, 'data-saved-id': entry.id,
          'aria-label': `${label} ${entry.title}`
        });
        if (action === 'delete') btn.classList.add('saved-library-delete');
        if (action === 'pin' && entry.pinned) btn.classList.add('is-pinned');
        actions.appendChild(btn);
      }
      card.append(head, actions);
      libraryResults.appendChild(card);
    }
  }
  function beginRename(id) {
    const entry = getById(id);
    const card = [...libraryResults.querySelectorAll('.saved-library-card')].find(el => el.dataset.savedId === id);
    if (!entry || !card) return;
    const head = card.querySelector('.saved-library-card-head');
    head.replaceChildren();
    const form = document.createElement('form');
    form.className = 'saved-library-rename';
    const input = document.createElement('input');
    input.type = 'text'; input.value = entry.title; input.maxLength = MAX_TITLE;
    input.required = true; input.setAttribute('aria-label', 'New Soundscape name');
    const save = button('saved-library-action', 'Save');
    save.type = 'submit';
    const cancel = button('saved-library-action', 'Cancel');
    cancel.addEventListener('click', () => renderLibrary());
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (rename(id, input.value)) renderLibrary();
    });
    form.append(input, save, cancel);
    head.appendChild(form);
    input.focus(); input.select();
  }
  grid.addEventListener('click', event => {
    const action = event.target.closest('[data-home-action]')?.dataset.homeAction;
    if (action === 'create') onCreate();
    if (action === 'library') { onBack('library'); }
  });
  document.getElementById('savedLibraryBackBtn').addEventListener('click', () => onBack('home'));
  search.addEventListener('input', renderLibrary);
  sort.addEventListener('change', renderLibrary);
  libraryResults.addEventListener('click', event => {
    const element = event.target.closest('[data-library-action]');
    if (!element) return;
    const { libraryAction: action, savedId } = element.dataset;
    if (action === 'create') { onCreate(); return; }
    if (!savedId) return;
    if (action === 'play') { const entry = getById(savedId); if (entry) onPlaySaved(entry); }
    if (action === 'pin') togglePin(savedId);
    if (action === 'rename') beginRename(savedId);
    if (action === 'delete') remove(savedId);
  });
  return { getAll, getById, hasSession, toggleSession, markPlayed, recordListen,
    renderHome, renderLibrary, getRecommendation, signature };
}
