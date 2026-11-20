/* =================================================================
       GLOBAL STATE & AUDIO ENGINE
       ================================================================= */
    const State = {
      currentScreen: 'screen-home',
      selectedMode: null, // 'focus' | 'relax'
      entryType: null,    // 'quick' | 'custom'
      selectedSoundGroupIds: new Set(),
      activeAudioLayers: [],
      isPlaying: false,
      timerSeconds: 0,
      timerInterval: null,
      previewNode: null,
      previewSoundId: null,
      returnScreen: 'screen-home',
    };

    // Default Sample Dataset (Replaces immediately when uploaded)
    const AudioDataset = {
      categories: [
        {
          name: 'Amber Footpath',
          sounds: [
            { id: 'amber_leaves', name: 'Crunching Leaves', file: null, synthType: 'rustle' },
            { id: 'amber_wind', name: 'Soft Canopy Wind', file: null, synthType: 'wind' },
            { id: 'amber_woodpecker', name: 'Distant Forest Birds', file: null, synthType: 'birds' }
          ]
        },
        {
          name: 'Wetland Chorus',
          sounds: [
            { id: 'wetland_reed', name: 'Gentle Reed Breeze', file: null, synthType: 'wind' },
            { id: 'wetland_stream', name: 'Flowing Stream', file: null, synthType: 'water' },
            { id: 'wetland_crickets', name: 'Evening Chorus', file: null, synthType: 'crickets' }
          ]
        },
        {
          name: 'Highland Mist',
          sounds: [
            { id: 'mist_steady_rain', name: 'Steady Mountain Rain', file: null, synthType: 'rain' },
            { id: 'mist_distant_thunder', name: 'Distant Rolling Thunder', file: null, synthType: 'thunder' },
            { id: 'mist_warm_drone', name: 'Atmospheric Drone', file: null, synthType: 'drone' }
          ]
        }
      ],
      focusFrequencyFile: null,
      relaxFrequencyFile: null,
      quickStartFiles: []
    };

    let audioCtx = null;
    function getAudioContext() {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    }

    // Procedural Fallback Engine
    function createSynthLayer(ctx, type) {
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + white * 0.05;
        b1 = 0.95 * b1 + white * 0.1;
        output[i] = (b0 + b1) * 0.15;
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = ctx.createBiquadFilter();
      const gainNode = ctx.createGain();

      if (type === 'wind') {
        filter.type = 'bandpass';
        filter.frequency.value = 450;
        filter.Q.value = 1.8;
        gainNode.gain.value = 0.3;
      } else if (type === 'water') {
        filter.type = 'lowpass';
        filter.frequency.value = 700;
        gainNode.gain.value = 0.28;
      } else if (type === 'drone') {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 110;
        gainNode.gain.value = 0.18;
        osc.connect(gainNode);
        osc.start();
        return { source: osc, gain: gainNode, isOsc: true };
      } else {
        filter.type = 'lowpass';
        filter.frequency.value = 1100;
        gainNode.gain.value = 0.25;
      }

      whiteNoise.connect(filter);
      filter.connect(gainNode);
      whiteNoise.start();

      return { source: whiteNoise, gain: gainNode, isOsc: false };
    }

    // Prototype two-tone audio (NOT spatialized binaural playback; not a validated treatment)
    function createFrequencyTone(ctx, mode) {
      const baseFreq = mode === 'focus' ? 220 : 136.1;
      const diff = mode === 'focus' ? 14 : 6;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';
      osc1.frequency.value = baseFreq;
      osc2.frequency.value = baseFreq + diff;
      gain.gain.value = 0.15;

      osc1.connect(gain);
      osc2.connect(gain);
      osc1.start();
      osc2.start();

      return { sources: [osc1, osc2], gain };
    }

    // Play a single audio layer (either from uploaded MP3 file or built-in generator)
    function playAudioLayer(fileOrItem, isFrequency = false, mode = 'focus') {
      const ctx = getAudioContext();

      if (typeof fileOrItem === 'string') {
        const audio = new Audio(fileOrItem);
        audio.loop = true;
        const source = ctx.createMediaElementSource(audio);
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.55;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        audio.play().catch(e => console.warn(e));

        return {
          stop: () => {
            audio.pause();
            audio.currentTime = 0;
            audio.removeAttribute('src');
            audio.load();
            source.disconnect();
            gainNode.disconnect();
          },
          pause: () => audio.pause(),
          resume: () => audio.play().catch(e => {})
        };
      } else if (fileOrItem && fileOrItem instanceof File) {
        // Uploaded MP3 file
        const audio = new Audio();
        const objectUrl = URL.createObjectURL(fileOrItem);
        audio.src = objectUrl;
        audio.loop = true;
        const source = ctx.createMediaElementSource(audio);
        const gainNode = ctx.createGain();
        gainNode.gain.value = isFrequency ? 0.35 : 0.65;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        audio.play().catch(e => console.warn(e));

        return {
          stop: () => {
            audio.pause();
            audio.currentTime = 0;
            audio.removeAttribute('src');
            audio.load();
            URL.revokeObjectURL(objectUrl);
            source.disconnect();
            gainNode.disconnect();
          },
          pause: () => audio.pause(),
          resume: () => audio.play().catch(e => {})
        };
      } else if (fileOrItem && fileOrItem.file instanceof File) {
        // Sound object with real file
        return playAudioLayer(fileOrItem.file, false, mode);
      } else {
        // Procedural Audio Fallback
        if (isFrequency) {
          const freq = createFrequencyTone(ctx, mode);
          freq.gain.connect(ctx.destination);
          return {
            stop: () => freq.sources.forEach(s => { try { s.stop(); } catch(e){} }),
            pause: () => { freq.gain.gain.value = 0; },
            resume: () => { freq.gain.gain.value = 0.15; }
          };
        } else {
          const synth = createSynthLayer(ctx, (fileOrItem && fileOrItem.synthType) || 'rain');
          synth.gain.connect(ctx.destination);
          const startingVolume = synth.gain.gain.value;
          return {
            stop: () => { try { synth.source.stop(); } catch(e){} synth.gain.disconnect(); },
            pause: () => { synth.gain.gain.value = 0; },
            resume: () => { synth.gain.gain.value = startingVolume; }
          };
        }
      }
    }


    /* =================================================================
       ROUTING & NAVIGATION
       ================================================================= */
    function navigateTo(screenId) {
      stopPreview();
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const target = document.getElementById(screenId);
      if (target) {
        target.classList.add('active');
        State.currentScreen = screenId;
      }
    }

    function showToast(msg) {
      const t = document.getElementById('toastNotification');
      t.textContent = msg;
      t.classList.add('visible');
      setTimeout(() => t.classList.remove('visible'), 2400);
    }

    /* =================================================================
       SCREEN 1 — HOME
       ================================================================= */
    let DatasetManifest = {};

    const SoundGroups = [
      {
        id: 'nature',
        name: 'Nature & Wildlife',
        scenes: ['Amber Footpath', 'Ancient Canopy', 'Hollow Grove', 'Lantern Courtyard', 'Open Pasture', 'Twilight Chorus', 'Wetland Chorus']
      },
      {
        id: 'water',
        name: 'Water & Coast',
        scenes: ['Atlantic Reach', 'Cascading Veil', 'Coastal Crossroads', 'Silver Tributary']
      },
      {
        id: 'weather',
        name: 'Rain & Storm',
        scenes: ['Tempest Shelter', 'Amber Footpath', 'Ancient Canopy', 'Atlantic Reach']
      },
      {
        id: 'ambient',
        name: 'Ambient Worlds',
        scenes: ['Distant Reverie', 'Inner Haven', 'Pelagic Drift', 'Stone Vault']
      },
      {
        id: 'tones',
        name: 'Focus & Tones',
        scenes: ['Ivory Afterglow', 'Resonant Ladder', 'Spectral Haze', 'Twin Currents']
      }
    ];
    const SavedSoundscapesStorageKey = 'attune.savedSoundscapes';
    const validSoundGroupIds = new Set(SoundGroups.map(group => group.id));
    let SavedSoundscapes = [];

    const HomePresets = {
      focus: { title: 'Deep Focus', mode: 'focus', scenes: ['Resonant Ladder', 'Twin Currents', 'Spectral Haze', 'Ivory Afterglow', 'Stone Vault'] },
      relax: { title: 'Deep Relax', mode: 'relax', scenes: ['Distant Reverie', 'Inner Haven', 'Ivory Afterglow', 'Pelagic Drift'] },
      rain: { title: 'Gentle Rain', mode: 'relax', scenes: ['Tempest Shelter', 'Cascading Veil', 'Ancient Canopy', 'Lantern Courtyard'] },
      wind: { title: 'Soft Wind', mode: 'relax', scenes: ['Amber Footpath', 'Hollow Grove', 'Open Pasture', 'Lantern Courtyard'] },
      water: { title: 'Flowing Water', mode: 'relax', scenes: ['Cascading Veil', 'Silver Tributary', 'Wetland Chorus', 'Open Pasture'] },
      storm: { title: 'Rain & Thunder', mode: 'relax', scenes: ['Tempest Shelter', 'Atlantic Reach', 'Cascading Veil'] },
      ambient: { title: 'Ambient Calm', mode: 'relax', scenes: ['Distant Reverie', 'Pelagic Drift', 'Spectral Haze', 'Inner Haven'] }
    };

    function randomItem(items) {
      return items[Math.floor(Math.random() * items.length)];
    }

    function shuffleItems(items) {
      const shuffled = [...items];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

    function getRandomPresetFiles(preset) {
      return shuffleItems(preset.scenes).slice(0, 3).map(scene => {
        const sceneFiles = DatasetManifest[scene] || [];
        if (sceneFiles.length === 0) return null;
        return `/${encodeURIComponent(scene)}/mp3/${encodeURIComponent(randomItem(sceneFiles))}`;
      }).filter(Boolean);
    }

    function loadSavedSoundscapes() {
      try {
        const saved = JSON.parse(localStorage.getItem(SavedSoundscapesStorageKey) || '[]');
        if (!Array.isArray(saved)) return [];
        return saved.filter(item =>
          item &&
          typeof item.id === 'string' &&
          Array.isArray(item.groupIds) &&
          item.groupIds.some(id => validSoundGroupIds.has(id))
        ).map(item => {
          const groupIds = item.groupIds.filter(id => validSoundGroupIds.has(id));
          const validScenes = Array.isArray(item.scenes)
            ? item.scenes.filter(scene => SoundGroups.some(group => group.scenes.includes(scene)))
            : [];
          const scenes = validScenes.length > 0 ? validScenes : getRandomScenesForGroups(groupIds);
          return {
            ...item,
            name: typeof item.name === 'string' ? item.name : generateSceneBasedName(scenes),
            groupIds,
            scenes
          };
        }).filter(item => item.scenes.length > 0);
      } catch (error) {
        console.error('Could not load saved soundscapes.', error);
        return [];
      }
    }

    function getRandomScenesForGroups(groupIds) {
      const selectedScenes = new Set();
      groupIds.forEach(groupId => {
        const group = SoundGroups.find(item => item.id === groupId);
        if (!group) return;

        const availableScenes = group.scenes.filter(scene => (DatasetManifest[scene] || []).length > 0);
        if (availableScenes.length === 0) return;

        const sceneCount = Math.min(availableScenes.length, Math.floor(Math.random() * 3) + 2);
        shuffleItems(availableScenes).slice(0, sceneCount).forEach(scene => selectedScenes.add(scene));
      });
      return [...selectedScenes];
    }

    function generateSceneBasedName(scenes) {
      const sceneWords = shuffleItems(scenes)
        .map(scene => scene.split(/\s+/).at(-1))
        .filter((word, index, words) => words.indexOf(word) === index);
      if (sceneWords.length === 0) return 'New Soundscape';
      if (sceneWords.length === 1) return `${sceneWords[0]} Mix`;
      return `${sceneWords[0]} & ${sceneWords[1]}`;
    }

    function getRandomSceneFiles(scenes) {
      return scenes.map(scene => {
        const sceneFiles = DatasetManifest[scene] || [];
        if (sceneFiles.length === 0) return null;
        const fileName = randomItem(sceneFiles);
        return `/${encodeURIComponent(scene)}/mp3/${encodeURIComponent(fileName)}`;
      }).filter(Boolean);
    }

    function playSoundscape(title, mode, files) {
      State.selectedMode = mode;
      State.returnScreen = 'screen-home';
      initListeningScreen(title, mode);
      files.forEach(url => State.activeAudioLayers.push(playAudioLayer(url, false)));
    }

    function renderHomeSoundscapes() {
      const container = document.getElementById('homeSoundscapeHexes');
      if (!container) return;
      container.innerHTML = '';

      const tiles = [
        ...Object.entries(HomePresets).map(([id, preset]) => ({ id, ...preset, type: 'preset' })),
        ...SavedSoundscapes.map(soundscape => ({
          ...soundscape,
          id: soundscape.id,
          title: soundscape.name,
          type: 'saved'
        }))
      ];

      let tileIndex = 0;
      let row = 0;
      while (tileIndex < tiles.length) {
        const positions = row % 2 === 0 ? [41, 123] : [0, 82, 164];
        const rowCount = Math.min(positions.length, tiles.length - tileIndex);
        for (let column = 0; column < rowCount; column++) {
          const tile = tiles[tileIndex];
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `hex-card ${tile.type === 'saved' ? 'saved-soundscape-hex' : 'home-preset'}`;
          button.setAttribute('aria-label', `Play ${tile.title} soundscape`);
          button.title = tile.title;
          button.style.left = `${positions[column]}px`;
          button.style.top = `${row * 70.5}px`;

          const label = document.createElement('span');
          label.textContent = tile.title;
          button.appendChild(label);

          button.addEventListener('click', () => {
            if (tile.type === 'saved') {
              playSoundscape(tile.title, tile.mode || 'relax', getRandomSceneFiles(tile.scenes));
            } else {
              playSoundscape(tile.title, tile.mode, getRandomPresetFiles(tile));
            }
          });
          container.appendChild(button);
          tileIndex++;
        }
        row++;
      }

      container.style.height = `${Math.max(235, (row - 1) * 70.5 + 94)}px`;
    }

    async function loadDatasetManifest() {
      try {
        const response = await fetch('/audio-dataset-manifest.json');
        if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
        DatasetManifest = await response.json();
      } catch (error) {
        console.error('Could not load the audio dataset manifest.', error);
        DatasetManifest = {};
      }
      SavedSoundscapes = loadSavedSoundscapes();
      renderHomeSoundscapes();
      if (State.currentScreen === 'screen-sound-selection') renderSoundSelectionUI();
    }

    document.querySelectorAll('.hex-trigger').forEach(button => {
      button.addEventListener('click', () => navigateTo('screen-mode'));
    });

    document.querySelector('.create-soundscape-trigger').addEventListener('click', openSoundscapeBuilder);

    loadDatasetManifest();

    /* =================================================================
       SCREEN 2 — FOCUS / RELAX
       ================================================================= */
    const focusCard = document.getElementById('focusModeCard');
    const relaxCard = document.getElementById('relaxModeCard');
    const modeStartBtn = document.getElementById('modeStartBtn');

    function selectMode(mode) {
      State.selectedMode = mode;
      focusCard.classList.toggle('selected', mode === 'focus');
      relaxCard.classList.toggle('selected', mode === 'relax');
      modeStartBtn.classList.remove('disabled');
    }

    focusCard.addEventListener('click', () => selectMode('focus'));
    relaxCard.addEventListener('click', () => selectMode('relax'));

    document.getElementById('modeBackBtn').addEventListener('click', () => {
      navigateTo('screen-home');
    });

    modeStartBtn.addEventListener('click', () => {
      if (!State.selectedMode) return;
      navigateTo('screen-entry-type');
    });

    /* =================================================================
       SCREEN 3 — QUICK START / CHOOSE MY SOUNDS
       ================================================================= */
    const quickStartCard = document.getElementById('quickStartChoiceCard');
    const customSoundsCard = document.getElementById('customSoundsChoiceCard');
    const entryTypeStartBtn = document.getElementById('entryTypeStartBtn');

    function selectEntryType(type) {
      State.entryType = type;
      quickStartCard.classList.toggle('selected', type === 'quick');
      customSoundsCard.classList.toggle('selected', type === 'custom');
      entryTypeStartBtn.classList.remove('disabled');
    }

    quickStartCard.addEventListener('click', () => selectEntryType('quick'));
    customSoundsCard.addEventListener('click', () => selectEntryType('custom'));

    document.getElementById('entryTypeBackBtn').addEventListener('click', () => {
      navigateTo('screen-mode');
    });

    entryTypeStartBtn.addEventListener('click', () => {
      if (!State.entryType) return;
      if (State.entryType === 'quick') {
        startQuickStartSoundscape();
      } else {
        renderSoundSelectionUI();
        navigateTo('screen-sound-selection');
      }
    });

    /* =================================================================
       SCREEN 4 — DYNAMIC SOUND SELECTION
       ================================================================= */
    const categoriesAccordionEl = document.getElementById('soundCategoriesAccordion');
    const saveSoundscapeBtn = document.getElementById('saveSoundscapeBtn');

    function updateSaveSoundscapeButton() {
      const canSave = State.selectedSoundGroupIds.size > 0;
      saveSoundscapeBtn.disabled = !canSave;
      saveSoundscapeBtn.classList.toggle('disabled', !canSave);
    }

    function escapeHTML(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }

    function renderSoundSelectionUI() {
      categoriesAccordionEl.innerHTML = '';
      const availableGroups = SoundGroups.map(group => ({
        ...group,
        availableScenes: group.scenes.filter(scene => (DatasetManifest[scene] || []).length > 0)
      })).filter(group => group.availableScenes.length > 0);

      if (availableGroups.length === 0) {
        categoriesAccordionEl.innerHTML = '<p class="sound-groups-empty">The audio dataset could not be loaded.</p>';
        updateSaveSoundscapeButton();
        return;
      }

      availableGroups.forEach(group => {
        const card = document.createElement('label');
        card.className = 'sound-group-card';
        card.innerHTML = `
          <input class="sound-group-checkbox" type="checkbox" value="${escapeHTML(group.id)}" ${State.selectedSoundGroupIds.has(group.id) ? 'checked' : ''}>
          <span class="sound-group-checkmark" aria-hidden="true"></span>
          <span class="sound-group-name">${escapeHTML(group.name)}</span>
        `;

        const checkbox = card.querySelector('.sound-group-checkbox');
        card.classList.toggle('selected', checkbox.checked);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            State.selectedSoundGroupIds.add(group.id);
          } else {
            State.selectedSoundGroupIds.delete(group.id);
          }
          card.classList.toggle('selected', checkbox.checked);
          updateSaveSoundscapeButton();
        });
        categoriesAccordionEl.appendChild(card);
      });

      updateSaveSoundscapeButton();
    }

    function openSoundscapeBuilder() {
      State.selectedMode = 'relax';
      State.selectedSoundGroupIds.clear();
      renderSoundSelectionUI();
      navigateTo('screen-sound-selection');
    }

    // Audio Preview
    function togglePreview(sound, btn) {
      if (State.previewSoundId === sound.id) {
        stopPreview();
        return;
      }
      stopPreview();

      State.previewSoundId = sound.id;
      btn.classList.add('playing');
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="4" height="16"></rect><rect x="15" y="4" width="4" height="16"></rect></svg>`;

      State.previewNode = playAudioLayer(sound.file || sound, false);
    }

    function stopPreview() {
      if (State.previewNode) {
        State.previewNode.stop();
        State.previewNode = null;
      }
      if (State.previewSoundId) {
        const btn = document.querySelector(`[data-preview-id="${State.previewSoundId}"]`);
        if (btn) {
          btn.classList.remove('playing');
          btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
        }
        State.previewSoundId = null;
      }
    }

    document.getElementById('soundSelectBackBtn').addEventListener('click', () => {
      stopPreview();
      navigateTo('screen-home');
    });

    saveSoundscapeBtn.addEventListener('click', () => {
      const groupIds = [...State.selectedSoundGroupIds];
      if (groupIds.length === 0) return;
      const scenes = getRandomScenesForGroups(groupIds);
      if (scenes.length === 0) {
        showToast('No audio scenes found for that selection.');
        return;
      }

      const soundscape = {
        id: crypto.randomUUID(),
        name: generateSceneBasedName(scenes),
        groupIds,
        scenes,
        mode: State.selectedMode || 'relax'
      };
      const updatedSoundscapes = [...SavedSoundscapes, soundscape];
      try {
        localStorage.setItem(SavedSoundscapesStorageKey, JSON.stringify(updatedSoundscapes));
      } catch (error) {
        console.error('Could not save this soundscape.', error);
        showToast('Could not save soundscape.');
        return;
      }

      SavedSoundscapes = updatedSoundscapes;
      renderHomeSoundscapes();
      State.selectedSoundGroupIds.clear();
      updateSaveSoundscapeButton();
      navigateTo('screen-home');
      showToast(`${soundscape.name} saved to Home.`);
    });

    /* =================================================================
       SCREEN 5 — LISTENING SESSION
       ================================================================= */
    function stopAllActiveAudio() {
      State.activeAudioLayers.forEach(l => l.stop());
      State.activeAudioLayers = [];
      State.isPlaying = false;
      clearInterval(State.timerInterval);
      State.timerInterval = null;
      State.timerSeconds = 0;
      document.getElementById('timerBadge').style.display = 'none';
    }

    function initListeningScreen(title, mode) {
      stopAllActiveAudio();

      document.getElementById('nowListeningTitle').textContent = title;
      document.getElementById('listeningPersonalizedText').textContent =
        `Personalized for ${mode === 'focus' ? 'Focus' : 'Relax'}`;

      // 1. Add Focus OR Relax Frequency Layer
      const freqFile = mode === 'focus' ? AudioDataset.focusFrequencyFile : AudioDataset.relaxFrequencyFile;
      const freqLayer = playAudioLayer(freqFile, true, mode);
      State.activeAudioLayers.push(freqLayer);

      State.isPlaying = true;
      updatePlayerUI();

      navigateTo('screen-listening');
    }

    // Quick Start Flow: 5 files + Focus/Relax frequency
    function startQuickStartSoundscape() {
      State.returnScreen = 'screen-entry-type';
      const mode = State.selectedMode || 'focus';
      const title = mode === 'focus' ? 'Deep Focus' : 'Deep Relax';
      initListeningScreen(title, mode);

      if (AudioDataset.quickStartFiles && AudioDataset.quickStartFiles.length >= 5) {
        for (let i = 0; i < 5; i++) {
          const layer = playAudioLayer(AudioDataset.quickStartFiles[i], false);
          State.activeAudioLayers.push(layer);
        }
      } else {
        ['wind', 'water', 'rain', 'thunder', 'drone'].forEach(type => {
          const layer = playAudioLayer({ synthType: type }, false);
          State.activeAudioLayers.push(layer);
        });
      }
    }

    // Player Controls
    const masterPlayPauseBtn = document.getElementById('masterPlayPauseBtn');
    const pauseIconSvg = document.getElementById('pauseIconSvg');
    const playIconSvg = document.getElementById('playIconSvg');
    const listeningPulseDot = document.getElementById('listeningPulseDot');
    const listeningStateLabel = document.getElementById('listeningStateLabel');
    const listeningWaveWrap = document.getElementById('listeningWaveWrap');

    function updatePlayerUI() {
      if (State.isPlaying) {
        pauseIconSvg.style.display = 'block';
        playIconSvg.style.display = 'none';
        listeningPulseDot.style.background = '#00e5ff';
        listeningPulseDot.style.animation = 'pulseAnimation 2s infinite ease-in-out';
        listeningStateLabel.textContent = 'Soundscape Playing';
        listeningWaveWrap.classList.remove('paused');
      } else {
        pauseIconSvg.style.display = 'none';
        playIconSvg.style.display = 'block';
        listeningPulseDot.style.background = '#64748b';
        listeningPulseDot.style.animation = 'none';
        listeningStateLabel.textContent = 'Paused';
        listeningWaveWrap.classList.add('paused');
      }
    }

    masterPlayPauseBtn.addEventListener('click', () => {
      if (State.isPlaying) {
        State.activeAudioLayers.forEach(l => l.pause());
        State.isPlaying = false;
      } else {
        getAudioContext();
        State.activeAudioLayers.forEach(l => l.resume());
        State.isPlaying = true;
      }
      updatePlayerUI();
    });

    document.getElementById('listeningBackBtn').addEventListener('click', () => {
      stopAllActiveAudio();
      navigateTo(State.returnScreen || 'screen-home');
    });

    document.getElementById('mixerBtn').addEventListener('click', () => {
      showToast('Sound mixing coming soon.');
    });

    /* =================================================================
       TIMER MODAL
       ================================================================= */
    const timerModal = document.getElementById('timerModal');
    const openTimerBtn = document.getElementById('openTimerBtn');
    const closeTimerModalBtn = document.getElementById('closeTimerModalBtn');
    const timerBadge = document.getElementById('timerBadge');

    openTimerBtn.addEventListener('click', () => timerModal.classList.add('open'));
    closeTimerModalBtn.addEventListener('click', () => timerModal.classList.remove('open'));

    document.querySelectorAll('.timer-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.timer-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const mins = parseInt(chip.getAttribute('data-mins'), 10);
        clearInterval(State.timerInterval);

        if (mins === 0) {
          State.timerSeconds = 0;
          State.timerInterval = null;
          timerBadge.style.display = 'none';
          showToast('Timer turned off');
        } else {
          State.timerSeconds = mins * 60;
          timerBadge.style.display = 'inline-block';
          updateTimerDisplay();

          State.timerInterval = setInterval(() => {
            if (State.isPlaying && State.timerSeconds > 0) {
              State.timerSeconds--;
              updateTimerDisplay();
              if (State.timerSeconds <= 0) {
                clearInterval(State.timerInterval);
                stopAllActiveAudio();
                updatePlayerUI();
                showToast('Session finished!');
              }
            }
          }, 1000);

          showToast(`Timer set for ${mins} minutes`);
        }
        timerModal.classList.remove('open');
      });
    });

    function updateTimerDisplay() {
      const m = Math.floor(State.timerSeconds / 60);
      const s = State.timerSeconds % 60;
      timerBadge.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    /* =================================================================
       DEV CONFIGURATION PANEL
       ================================================================= */
    const devModal = document.getElementById('devModalBackdrop');
    document.getElementById('openDevPanelBtn').addEventListener('click', () => devModal.classList.add('open'));
    document.getElementById('closeDevModalCross').addEventListener('click', () => devModal.classList.remove('open'));
    document.getElementById('saveAndExitDevBtn').addEventListener('click', () => {
      devModal.classList.remove('open');
      if (State.currentScreen === 'screen-sound-selection') {
        renderSoundSelectionUI();
      }
      showToast('Prototype audio ready.');
    });

    // Dataset Directory Parser: audio-dataset/[scene]/mp3/[file].mp3
    document.getElementById('datasetFolderInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      const sceneMap = new Map();

      files.forEach(file => {
        if (!file.name.toLowerCase().endsWith('.mp3')) return;
        const parts = file.webkitRelativePath.split('/');
        
        let sceneName = 'Uploaded Scene';
        if (parts.length >= 3) {
          sceneName = parts[1] === 'mp3' ? parts[0] : parts[parts.length - 3] || parts[0];
        }

        if (!sceneMap.has(sceneName)) {
          sceneMap.set(sceneName, []);
        }

        const cleanName = file.name
          .replace(/\.mp3$/i, '')
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());

        sceneMap.get(sceneName).push({
          id: file.name + '_' + Math.random(),
          name: cleanName,
          file: file,
          synthType: 'rain'
        });
      });

      if (sceneMap.size > 0) {
        AudioDataset.categories = [];
        sceneMap.forEach((soundList, sceneName) => {
          AudioDataset.categories.push({
            name: sceneName,
            sounds: soundList
          });
        });

        // Reset previous selections to avoid stale IDs
        State.selectedSoundGroupIds.clear();
        document.getElementById('datasetStatus').textContent = `Loaded (${sceneMap.size} scenes)`;
      }
    });

    // Focus MP3
    document.getElementById('focusFreqInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        AudioDataset.focusFrequencyFile = e.target.files[0];
        document.getElementById('focusFreqStatus').textContent = 'Ready (Uploaded MP3)';
      }
    });

    // Relax MP3
    document.getElementById('relaxFreqInput').addEventListener('change', (e) => {
      if (e.target.files[0]) {
        AudioDataset.relaxFrequencyFile = e.target.files[0];
        document.getElementById('relaxFreqStatus').textContent = 'Ready (Uploaded MP3)';
      }
    });

    // Quick Start (5 MP3s)
    document.getElementById('quickStartFilesInput').addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        AudioDataset.quickStartFiles = files;
        document.getElementById('quickStartStatus').textContent = `${files.length}/5 Ready`;
      }
    });

    // Boot: Ensure Home is active and ready
    navigateTo('screen-home');
