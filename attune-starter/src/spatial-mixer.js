/** Attune radial volume mixer.
 * The rings are a volume metaphor, not spatial/panning audio.
 * Closer to center = louder. Drag with pointer/touch or use arrow keys.
 */
export function setupSpatialMixer({ getTracks, navigateTo, isPlaying, togglePlayback, openTimer, toggleSave }) {
  const board = document.getElementById('spatialMixerBoard');
  const trackHolder = document.getElementById('mixerTracks');
  const detail = document.getElementById('mixerTrackDetail');
  const playButton = document.getElementById('mixerPlayPauseBtn');
  const saveButton = document.getElementById('mixerSaveBtn');
  const angles = new Map();
  const MIN_R = 0.18;
  const MAX_R = 0.78; // room for the draggable orb inside the circular canvas

  const icons = {
    rain: '☂', ocean: '≈', water: '≈', stream: '≈', wind: '≋',
    birds: '♫', piano: '♬', chimes: '♧', forest: '♧',
    fire: '♨', night: '☾', thunder: 'ϟ', meadow: '✿',
    drone: '◌', ambient: '◌', crickets: '♪'
  };

  const colors = ['#4cb4e7', '#5b8cfa', '#b94fcb', '#53c98b', '#e8a04b', '#7e62e8', '#62c8d6', '#fa7b88'];
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const n = value => Number.isFinite(Number(value)) ? Number(value) : 0.5;
  const volumeToRadius = volume => MIN_R + (1 - clamp(n(volume), 0, 1)) * (MAX_R - MIN_R);
  const radiusToVolume = radius => 1 - (clamp(radius, MIN_R, MAX_R) - MIN_R) / (MAX_R - MIN_R);

  function placeOrb(element, angle, volume) {
    const r = volumeToRadius(volume);
    element.style.left = `${50 + Math.cos(angle) * r * 50}%`;
    element.style.top = `${50 + Math.sin(angle) * r * 50}%`;
  }

  function updateStatus() {
    const playing = isPlaying();
    document.getElementById('mixerPlaybackStatus').textContent = playing ? 'Soundscape Playing' : 'Soundscape Paused';
    playButton.innerHTML = playing
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 20 12 7 20z"/></svg>';
    playButton.setAttribute('aria-label', playing ? 'Pause soundscape' : 'Resume soundscape');
  }

  function render() {
    trackHolder.replaceChildren();
    const tracks = getTracks();
    const count = tracks.length;
    if (count === 0) {
      detail.textContent = 'No sounds in this session';
      return;
    }
    detail.textContent = 'Drag a sound closer to increase its volume';
    tracks.forEach(({ id, name, type, volume, setVolume }, index) => {
      const key = `${id}:${index}`;
      // Spread nodes around the center (the circles themselves do not auto-rotate).
      const angle = angles.has(key) ? angles.get(key) : (-Math.PI / 2 + (2 * Math.PI * index / count));
      angles.set(key, angle);
      const orb = document.createElement('div');
      orb.className = 'mixer-sound-orb';
      orb.tabIndex = 0;
      orb.setAttribute('role', 'slider');
      orb.setAttribute('aria-label', `${name} volume`);
      orb.setAttribute('aria-valuemin', '0');
      orb.setAttribute('aria-valuemax', '100');
      orb.dataset.mixerId = key;
      orb.style.setProperty('--orb-color', colors[index % colors.length]);
      const icon = document.createElement('span');
      icon.className = 'mixer-orb-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = icons[type] || icons[name.toLowerCase()] || '♪';
      const caption = document.createElement('span');
      caption.className = 'mixer-orb-caption';
      caption.textContent = name;
      orb.append(icon, caption);

      let currentVolume = clamp(n(volume), 0, 1);
      const update = (nextVolume, nextAngle = angles.get(key)) => {
        currentVolume = clamp(nextVolume, 0, 1);
        angles.set(key, nextAngle);
        setVolume(currentVolume);
        placeOrb(orb, nextAngle, currentVolume);
        const pct = Math.round(currentVolume * 100);
        orb.setAttribute('aria-valuenow', String(pct));
        orb.setAttribute('aria-valuetext', `${pct} percent`);
        orb.title = `${name}: ${pct}%`;
        detail.textContent = `${name} · ${pct}% volume`;
      };
      update(currentVolume, angle);

      const handlePointer = event => {
        const rect = board.getBoundingClientRect();
        const x = event.clientX - (rect.left + rect.width / 2);
        const y = event.clientY - (rect.top + rect.height / 2);
        const radius = Math.hypot(x, y) / (rect.width / 2);
        const nextAngle = Math.hypot(x,y) < 1 ? angles.get(key) : Math.atan2(y, x);
        update(radiusToVolume(radius), nextAngle);
      };
      orb.addEventListener('pointerdown', event => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        orb.setPointerCapture(event.pointerId);
        orb.classList.add('dragging');
        handlePointer(event);
      });
      orb.addEventListener('pointermove', event => {
        if (orb.hasPointerCapture(event.pointerId)) handlePointer(event);
      });
      const endDrag = () => orb.classList.remove('dragging');
      orb.addEventListener('pointerup', endDrag);
      orb.addEventListener('pointercancel', endDrag);
      orb.addEventListener('lostpointercapture', endDrag);
      orb.addEventListener('keydown', event => {
        const steps = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05 };
        if (Object.prototype.hasOwnProperty.call(steps, event.key)) {
          event.preventDefault();
          update(clamp(currentVolume + steps[event.key], 0, 1));
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          update(event.key === 'End' ? 1 : 0);
        }
      });
      trackHolder.appendChild(orb);
    });
    detail.textContent = `${count} active sound${count === 1 ? '' : 's'} · Drag inward for louder audio`;
  }

  document.getElementById('mixerBackBtn').addEventListener('click', () => navigateTo('screen-listening'));
  document.getElementById('mixerDoneBtn').addEventListener('click', () => navigateTo('screen-listening'));
  playButton.addEventListener('click', () => { togglePlayback(); updateStatus(); });
  document.getElementById('mixerTimerBtn').addEventListener('click', openTimer);
  saveButton.addEventListener('click', () => { toggleSave(); syncSaved(); });
  function syncSaved() {
    const saved = document.getElementById('saveSoundscapeBtn').classList.contains('saved');
    saveButton.classList.toggle('saved', saved);
    saveButton.setAttribute('aria-pressed', String(saved));
  }
  return {
    open() {
      navigateTo('screen-mixer'); // show first, then calculate responsive positions
      document.querySelector('.mixer-session-subtext').textContent =
        document.getElementById('listeningPersonalizedText').textContent;
      render();
      updateStatus();
      syncSaved();
    },
    syncPlayback: updateStatus,
    syncSaved
  };
}
