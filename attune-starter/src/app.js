/* =================================================================
       GLOBAL STATE & AUDIO ENGINE
       ================================================================= */
    const State = {
      currentScreen: 'screen-home',
      selectedMode: null, // 'focus' | 'relax'
      entryType: null,    // 'quick' | 'custom'
      selectedSoundObjects: new Map(), // id -> sound item
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

    async function loadDatasetManifest() {
      try {
        const response = await fetch('/audio-dataset-manifest.json');
        if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
        DatasetManifest = await response.json();
      } catch (error) {
        console.error('Could not load the audio dataset manifest.', error);
        DatasetManifest = {};
      }
    }

    document.querySelectorAll('.home-preset').forEach(button => {
      button.addEventListener('click', () => {
        const preset = HomePresets[button.dataset.preset];
        if (!preset) return;

        State.selectedMode = preset.mode;
        State.returnScreen = 'screen-home';
        initListeningScreen(preset.title, preset.mode);

        getRandomPresetFiles(preset).forEach(url => {
          State.activeAudioLayers.push(playAudioLayer(url, false));
        });
      });
    });

    document.querySelectorAll('.home-create').forEach(button => {
      button.addEventListener('click', () => {
        const choice = button.dataset.create;
        if (choice === 'focus' || choice === 'relax') {
          selectMode(choice);
          navigateTo('screen-entry-type');
        } else {
          navigateTo('screen-mode');
        }
      });
    });

    document.querySelectorAll('.hex-trigger').forEach(button => {
      button.addEventListener('click', () => navigateTo('screen-mode'));
    });

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
    const soundSelectStartBtn = document.getElementById('soundSelectStartBtn');

    function updateSoundSelectionStartButton() {
      if (State.selectedSoundObjects.size > 0) {
        soundSelectStartBtn.classList.remove('disabled');
      } else {
        soundSelectStartBtn.classList.add('disabled');
      }
    }

    function escapeHTML(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }

    function renderSoundSelectionUI() {
      categoriesAccordionEl.innerHTML = '';

      AudioDataset.categories.forEach((cat, index) => {
        const card = document.createElement('div');
        card.className = 'accordion-card' + (index === 0 ? ' expanded' : '');

        card.innerHTML = `
          <div class="accordion-header">
            <div class="header-left">
              <div class="category-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22v-8"/><path d="M5 8c0 4 7 6 7 6s7-2 7-6a7 7 0 0 0-14 0Z"/></svg>
              </div>
              <div class="cat-name">${escapeHTML(cat.name)}</div>
            </div>
            <div class="chevron-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>
          <div class="accordion-content"></div>
        `;

        const contentEl = card.querySelector('.accordion-content');

        cat.sounds.forEach(sound => {
          const isSelected = State.selectedSoundObjects.has(sound.id);
          const row = document.createElement('div');
          row.className = 'sound-item-row';
          row.innerHTML = `
            <div class="sound-row-left" data-sound-id="${escapeHTML(sound.id)}">
              <div class="checkbox-bubble ${isSelected ? 'checked' : ''}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#041221" stroke-width="3.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <span class="sound-label">${escapeHTML(sound.name)}</span>
            </div>
            <button class="preview-play-btn" data-preview-id="${escapeHTML(sound.id)}" title="Preview Sound">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </button>
          `;

          // Checkbox toggle
          const rowLeft = row.querySelector('.sound-row-left');
          rowLeft.addEventListener('click', () => {
            const bubble = rowLeft.querySelector('.checkbox-bubble');
            if (State.selectedSoundObjects.has(sound.id)) {
              State.selectedSoundObjects.delete(sound.id);
              bubble.classList.remove('checked');
            } else {
              State.selectedSoundObjects.set(sound.id, sound);
              bubble.classList.add('checked');
            }
            updateSoundSelectionStartButton();
          });

          // Preview toggle
          const previewBtn = row.querySelector('.preview-play-btn');
          previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(sound, previewBtn);
          });

          contentEl.appendChild(row);
        });

        // Toggle Accordion expansion
        card.querySelector('.accordion-header').addEventListener('click', () => {
          card.classList.toggle('expanded');
        });

        categoriesAccordionEl.appendChild(card);
      });

      updateSoundSelectionStartButton();
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
      navigateTo('screen-entry-type');
    });

    soundSelectStartBtn.addEventListener('click', () => {
      if (State.selectedSoundObjects.size === 0) return;
      stopPreview();
      startCustomSoundscape();
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

    // Choose My Sounds Flow: All selected sounds + Focus/Relax frequency
    function startCustomSoundscape() {
      State.returnScreen = 'screen-sound-selection';
      const mode = State.selectedMode || 'focus';
      const title = mode === 'focus' ? 'Focus Soundscape' : 'Relax Soundscape';
      initListeningScreen(title, mode);

      State.selectedSoundObjects.forEach(soundItem => {
        const layer = playAudioLayer(soundItem.file || soundItem, false);
        State.activeAudioLayers.push(layer);
      });
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
        State.selectedSoundObjects.clear();
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
