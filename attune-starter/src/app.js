import { createSoundscapeHome } from './soundscape-home.js';
import { AUDIO_CATALOG, AUDIO_BY_ID } from './audio-catalog.js';
import { setupSpatialMixer } from './spatial-mixer.js';
import { SOUND_GROUPS, generateThemeMix } from './soundscape-generator.js';


       //GLOBAL STATE & AUDIO ENGINE

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
      currentPreset: null,
      currentSessionSounds: [],
      createExpanded: false,
    };
    let spatialMixer = null;

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

    // Each of these named sample types has a real recording in audio-dataset.zip.
    // The Fire tile has no matching MP3 in the dataset and remains synthesized.
    const DEFAULT_BUNDLED_TRACK = {
      rain: 'amber-footpath-17-rain',
      wind: 'amber-footpath-03-wind',
      water: 'ancient-canopy-01-water-stream',
      birds: 'ancient-canopy-13-birds',
      thunder: 'amber-footpath-01-distant-thunder',
      drone: 'distant-reverie-05-pad',
      crickets: 'open-pasture-19-crickets',
      rustle: 'amber-footpath-19-rustling-leaves'
    };

    function resolveBundledTrack(item) {
      if (!item || typeof item !== 'object') return null;
      // Named individual tracks take precedence over synthType fallbacks.
      return AUDIO_BY_ID.get(item.audioId) ||
        AUDIO_BY_ID.get(DEFAULT_BUNDLED_TRACK[item.synthType]) || null;
    }

    function playBundledLayer(track) {
      const ctx = getAudioContext();
      const audio = new Audio(track.src);
      audio.loop = true;
      audio.preload = 'auto';
      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();
      // Conservative starting level: multiple recordings will be mixed.
      let normalizedVolume = 0.5;
      gain.gain.value = normalizedVolume * 0.5;
      source.connect(gain);
      gain.connect(ctx.destination);

      let stopped = false;
      audio.addEventListener('error', () => {
        if (!stopped) showToast('Audio missing: check public/audio-dataset');
        console.error('Cannot load bundled audio:', track.src);
      });
      audio.play().catch(error => {
        if (!stopped) console.warn('Unable to play bundled audio:', track.src, error);
      });

      return {
        id: track.id,
        name: track.name,
        stop: () => {
          if (stopped) return;
          stopped = true;
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
          source.disconnect();
          gain.disconnect();
        },
        pause: () => audio.pause(),
        resume: () => audio.play().catch(error => console.warn(error)),
        setVolume: value => {
          const level = Math.max(0, Math.min(1, Number(value) || 0));
          normalizedVolume = level;
          gain.gain.setTargetAtTime(level * 0.5, ctx.currentTime, 0.03);
        },
        getVolume: () => normalizedVolume
      };
    }

    // Play a single audio layer (either from uploaded MP3 file or built-in generator)
    function playAudioLayer(fileOrItem, isFrequency = false, mode = 'focus') {
      const ctx = getAudioContext();
      // Built-in MP3s take priority over synthetic placeholders.
      // Frequency generators are intentionally handled by the existing branch.
      if (!isFrequency) {
        const bundled = resolveBundledTrack(fileOrItem);
        if (bundled) return playBundledLayer(bundled);
      }

      if (fileOrItem && fileOrItem instanceof File) {
        // Uploaded MP3 file
        const audio = new Audio();
        const objectUrl = URL.createObjectURL(fileOrItem);
        audio.src = objectUrl;
        audio.loop = true;
        const source = ctx.createMediaElementSource(audio);
        const gainNode = ctx.createGain();
        let normalizedVolume = isFrequency ? 0.35 : 0.65;
        gainNode.gain.value = normalizedVolume;
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
          resume: () => audio.play().catch(e => {}),
          setVolume: value => {
            normalizedVolume = Math.max(0, Math.min(1, Number(value) || 0));
            gainNode.gain.setTargetAtTime(normalizedVolume, ctx.currentTime, 0.03);
          },
          getVolume: () => normalizedVolume
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
          let normalizedVolume = 0.5;
          let paused = false;
          return {
            stop: () => { try { synth.source.stop(); } catch(e){} synth.gain.disconnect(); },
            pause: () => { paused = true; synth.gain.gain.value = 0; },
            resume: () => { paused = false; synth.gain.gain.value = startingVolume * normalizedVolume * 2; },
            setVolume: value => {
              normalizedVolume = Math.max(0, Math.min(1, Number(value) || 0));
              if (!paused) synth.gain.gain.setTargetAtTime(startingVolume * normalizedVolume * 2, ctx.currentTime, 0.03);
            },
            getVolume: () => normalizedVolume
          };
        }
      }
    }



    //ROUTING & NAVIGATION

    function navigateTo(screenId) {
      stopPreview();
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      const target = document.getElementById(screenId);
      if (target) {
        target.classList.add('active');
        State.currentScreen = screenId;
        if (screenId === 'screen-home') soundscapeHome.renderHome();
        if (screenId === 'screen-library') soundscapeHome.renderLibrary();
      }
    }

    function showToast(msg) {
      const t = document.getElementById('toastNotification');
      t.textContent = msg;
      t.classList.add('visible');
      setTimeout(() => t.classList.remove('visible'), 2400);
    }


      // SCREEN 1 — HOME

    // Real, one-tap soundscapes on the home screen.
    // These use the current synthesis fallback until licensed MP3 assets are bundled.
    const HomePresets = {
      focus: { title: 'Deep Focus', mode: 'focus', types: ['wind', 'water', 'rain', 'drone'] },
      relax: { title: 'Deep Relax', mode: 'relax', types: ['wind', 'water', 'rain'] },
      rain: { title: 'Gentle Rain', mode: 'relax', types: ['rain'] },
      wind: { title: 'Soft Wind', mode: 'relax', types: ['wind'] },
      water: { title: 'Flowing Water', mode: 'relax', types: ['water'] },
      storm: { title: 'Rain & Thunder', mode: 'relax', types: ['rain', 'thunder'] },
      ambient: { title: 'Ambient Calm', mode: 'relax', types: ['drone', 'wind'] }
    };

    // Delegate Home taps so newly saved mixes and Soundprint recommendations play instantly.
    document.getElementById('screen-home').addEventListener('click', event => {
      const hex = event.target.closest('.home-preset');
      if (!hex) return;
      if (hex.dataset.savedId) {
        const saved = soundscapeHome.getById(hex.dataset.savedId);
        if (saved) playSavedSoundscape(saved);
        return;
      }
      if (hex.dataset.recommendationId) {
        const suggestion = soundscapeHome.getRecommendation(hex.dataset.recommendationId);
        if (suggestion) playRecommendedSoundscape(suggestion);
        return;
      }
      const preset = HomePresets[hex.dataset.preset];
      if (!preset) return;
      State.selectedMode = preset.mode;
      State.returnScreen = 'screen-home';
      State.currentPreset = hex.dataset.preset;
      State.currentSessionSounds = preset.types.map(type => ({
        name: type[0].toUpperCase() + type.slice(1), synthType: type
      }));
      initListeningScreen(preset.title, preset.mode);
      preset.types.forEach(type => State.activeAudioLayers.push(playAudioLayer({ synthType: type })));
      syncFavoriteButton();
    });

    function playMixFromHome(title, mode, sounds, savedId = null) {
      State.selectedMode = mode;
      State.returnScreen = 'screen-home';
      State.currentPreset = null;
      // Do not mutate a stored Soundscape while changing mixer volumes.
      State.currentSessionSounds = sounds.map(sound => ({ ...sound }));
      initListeningScreen(title, mode);
      State.currentSessionSounds.forEach(sound => {
        const layer = playAudioLayer(sound);
        layer.setVolume?.(Number.isFinite(sound.volume) ? sound.volume : 0.5);
        State.activeAudioLayers.push(layer);
      });
      if (savedId) soundscapeHome.markPlayed(savedId);
      syncFavoriteButton();
    }
    function playSavedSoundscape(saved) {
      playMixFromHome(saved.title, saved.mode, saved.sounds, saved.id);
    }
    function playRecommendedSoundscape(recommendation) {
      playMixFromHome(recommendation.title, recommendation.mode, recommendation.sounds);
    }

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

    // Keep the original bottom navigation buttons functional for now.
    document.querySelectorAll('.hex-trigger').forEach(button => {
      button.addEventListener('click', () => navigateTo('screen-mode'));
    });

       //SCREEN 2 — FOCUS / RELAX

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


       //SCREEN 3 — QUICK START / CHOOSE MY SOUNDS

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

       //SCREEN 4 — DYNAMIC SOUND SELECTION
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


       //SCREEN 5 — LISTENING SESSION
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
      syncFavoriteButton();

      document.getElementById('nowListeningTitle').textContent = title;
      document.getElementById('listeningPersonalizedText').textContent =
        `Personalized for ${mode === 'focus' ? 'Focus' : 'Relax'}`;

      // 1. Add Focus OR Relax Frequency Layer
      const freqFile = mode === 'focus' ? AudioDataset.focusFrequencyFile : AudioDataset.relaxFrequencyFile;
      const freqLayer = playAudioLayer(freqFile, true, mode);
      freqLayer.isFrequency = true; // keep the baseline tone out of the user mixer
      State.activeAudioLayers.push(freqLayer);

      State.isPlaying = true;
      updatePlayerUI();

      soundscapeHome.recordListen(mode, State.currentSessionSounds);
      navigateTo('screen-listening');
    }

    // Quick Start Flow: 5 files + Focus/Relax frequency
    function startQuickStartSoundscape() {
      State.returnScreen = 'screen-entry-type';
      State.currentSessionSounds = ['wind', 'water', 'rain', 'thunder', 'drone'].map(type => ({ name: type, synthType: type }));
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
      State.currentSessionSounds = Array.from(State.selectedSoundObjects.values()).map(sound => ({ name: sound.name, synthType: sound.synthType || 'rain' }));
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
      spatialMixer?.syncPlayback();
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

    document.getElementById('mixerBtn').addEventListener('click', () => spatialMixer.open());

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


       //DEV CONFIGURATION PANEL

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


       //PHASE 2 — FIGMA HOME, CREATE, AND SAVED SOUNDSCAPES

    const DEFAULT_CREATE_SOUNDS = [
      { id: 'rain', name: 'Rain', synthType: 'rain', palette: 'rain', symbol: '☂' },
      { id: 'ocean', name: 'Ocean', synthType: 'water', palette: 'ocean', symbol: '≈' },
      { id: 'forest', name: 'Forest', synthType: 'wind', palette: 'forest', symbol: '♧' },
      { id: 'stream', name: 'Stream', synthType: 'water', palette: 'stream', symbol: '≈' },
      { id: 'birds', name: 'Birds', synthType: 'birds', palette: 'birds', symbol: '♪' },
      { id: 'wind', name: 'Wind', synthType: 'wind', palette: 'wind', symbol: '≋' },
      { id: 'piano', name: 'Piano', synthType: 'drone', palette: 'piano', symbol: '♫' },
      { id: 'fire', name: 'Fire', synthType: 'rustle', palette: 'fire', symbol: '♨' },
      { id: 'night', name: 'Night', synthType: 'crickets', palette: 'night', symbol: '☾' },
      { id: 'thunder', name: 'Thunder', synthType: 'thunder', palette: 'rain', symbol: 'ϟ' },
      { id: 'meadow', name: 'Meadow', synthType: 'birds', palette: 'forest', symbol: '✿' },
      { id: 'ambient', name: 'Ambient', synthType: 'drone', palette: 'night', symbol: '◌' }
    ];
    // Map the familiar Figma tiles to recordings that actually exist.
    const CREATE_TILE_TRACKS = {
      rain: 'amber-footpath-17-rain',
      ocean: 'coastal-crossroads-01-ocean-waves',
      forest: 'amber-footpath-09-forest-tone',
      stream: 'ancient-canopy-01-water-stream',
      birds: 'ancient-canopy-13-birds',
      wind: 'amber-footpath-03-wind',
      piano: 'ivory-afterglow-07-mono-piano',
      night: 'twilight-chorus-01-insects',
      thunder: 'amber-footpath-01-distant-thunder',
      meadow: 'open-pasture-17-grass-wind',
      ambient: 'distant-reverie-05-pad'
      // Fire has no equivalent file; it uses the procedural fallback for now.
    };
    DEFAULT_CREATE_SOUNDS.forEach(sound => {
      sound.audioId = CREATE_TILE_TRACKS[sound.id] || null;
      // No fire recording exists in the dataset. Use synthetic sound, not leaves.
      if (sound.id === 'fire') sound.synthType = 'fire';
    });

    // Search unlocks every one of the 400 recordings, without crowding the default UI.
    const librarySounds = AUDIO_CATALOG.map(track => ({
      id: track.id,
      name: `${track.name} ${String(track.take).padStart(2, '0')}`,
      collection: track.collection,
      audioId: track.id,
      synthType: 'drone',
      palette: 'night',
      symbol: '♪'
    }));
    const allCreateSounds = [...DEFAULT_CREATE_SOUNDS, ...librarySounds];
    const createSoundById = new Map(allCreateSounds.map(sound => [sound.id, sound]));

    // Generate four real recordings from one of the five themed collection groups.
    // This leaves the existing nine-tile custom selection and mixer untouched.
    const quickMixTheme = document.getElementById('quickMixTheme');
    const quickMixBtn = document.getElementById('quickMixBtn');
    quickMixBtn.addEventListener('click', () => {
      const group = SOUND_GROUPS.find(item => item.id === quickMixTheme.value);
      const tracks = generateThemeMix(quickMixTheme.value, AUDIO_CATALOG);
      if (!tracks.length) {
        showToast('No recordings found for this theme.');
        return;
      }
      State.selectedMode = createMode;
      State.currentPreset = null;
      State.returnScreen = 'screen-create';
      State.currentSessionSounds = tracks.map(track => ({
        name: track.name,
        audioId: track.id,
        synthType: 'drone',
        volume: 0.5
      }));
      initListeningScreen(`${group.name} Mix`, createMode);
      tracks.forEach(track => State.activeAudioLayers.push(playAudioLayer({ audioId: track.id })));
      syncFavoriteButton();
    });

    const createSearchInput = document.getElementById('createSearch');
    const createSoundGrid = document.getElementById('createSoundGrid');
    const createStartButton = document.getElementById('startCreateBtn');
    const createSelectedCount = document.getElementById('createSelectedCount');

    // Preselect three sounds to demonstrate the mixing workflow.
    const createSelection = new Set(['rain', 'birds', 'wind']);
    let createMode = 'relax';

    function goToCreate(focusSearch = false) {
      State.createPage = 0;
      createSearchInput.value = '';
      document.getElementById('showMoreSoundsBtn').innerHTML = 'See more <span aria-hidden="true">→</span>';
      renderCreateSounds();
      navigateTo('screen-create');
      if (focusSearch) createSearchInput.focus();
    }
    document.getElementById('navCreate').addEventListener('click', () => goToCreate());
    document.getElementById('navSounds').addEventListener('click', () => goToCreate(true));
    document.getElementById('navHome').addEventListener('click', () => navigateTo('screen-home'));
    document.getElementById('createBackBtn').addEventListener('click', () => navigateTo('screen-home'));
    createSearchInput.addEventListener('input', () => { State.createPage = 0; renderCreateSounds(); });
    document.getElementById('showMoreSoundsBtn').addEventListener('click', () => {
      const query = createSearchInput.value.trim().toLowerCase();
      const matches = query
        ? allCreateSounds.filter(sound => `${sound.name} ${sound.collection || ''}`.toLowerCase().includes(query))
        : DEFAULT_CREATE_SOUNDS;
      const pageCount = Math.max(1, Math.ceil(matches.length / 9));
      State.createPage = ((State.createPage || 0) + 1) % pageCount;
      renderCreateSounds();
    });
    document.getElementById('createModeFocus').addEventListener('click', () => setCreateMode('focus'));
    document.getElementById('createModeRelax').addEventListener('click', () => setCreateMode('relax'));
    function setCreateMode(mode) {
      createMode = mode;
      ['focus', 'relax'].forEach(value => {
        const button = document.getElementById('createMode' + (value === 'focus' ? 'Focus' : 'Relax'));
        button.classList.toggle('active', value === mode);
        button.setAttribute('aria-pressed', String(value === mode));
      });
    }
    function renderCreateSounds() {
      const query = createSearchInput.value.trim().toLowerCase();
      const matches = query
        ? allCreateSounds.filter(sound => `${sound.name} ${sound.collection || ''}`.toLowerCase().includes(query))
        : DEFAULT_CREATE_SOUNDS;
      const page = Math.min(State.createPage || 0, Math.max(0, Math.ceil(matches.length / 9) - 1));
      const visible = matches.slice(page * 9, (page + 1) * 9);
      const seeMore = document.getElementById('showMoreSoundsBtn');
      seeMore.hidden = matches.length <= 9;
      seeMore.textContent = page === Math.ceil(matches.length / 9) - 1
        ? 'See first ↑' : 'See more →';
      createSoundGrid.replaceChildren();
      visible.forEach(sound => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sound-tile palette-' + sound.palette;
        if (sound.collection) button.title = `${sound.name} — ${sound.collection}`;
        button.setAttribute('aria-pressed', String(createSelection.has(sound.id)));
        button.setAttribute('aria-label', `${createSelection.has(sound.id) ? 'Remove' : 'Add'} ${sound.name}`);
        if (createSelection.has(sound.id)) button.classList.add('selected');
        button.innerHTML = `<span class="sound-tile-symbol" aria-hidden="true">${sound.symbol}</span><span class="sound-tile-name">${escapeHTML(sound.name)}</span><span class="sound-tile-check" aria-hidden="true">✓</span>`;
        button.addEventListener('click', () => {
          if (createSelection.has(sound.id)) createSelection.delete(sound.id);
          else createSelection.add(sound.id);
          renderCreateSounds();
        });
        createSoundGrid.appendChild(button);
      });
      document.getElementById('createNoResults').hidden = visible.length !== 0;
      createSelectedCount.textContent = `${createSelection.size} sound${createSelection.size === 1 ? '' : 's'} selected`;
      createStartButton.disabled = createSelection.size === 0;
    }
    createStartButton.addEventListener('click', () => {
      const sounds = [...createSelection].map(id => createSoundById.get(id)).filter(Boolean);
      if (sounds.length === 0) return;
      State.selectedMode = createMode;
      State.currentPreset = null;
      State.currentSessionSounds = sounds.map(({ name, synthType, audioId }) => ({ name, synthType, audioId }));
      State.returnScreen = 'screen-create';
      const title = createMode === 'focus' ? 'Deep Focus' : 'Deep Relax';
      initListeningScreen(title, createMode);
      sounds.forEach(sound => State.activeAudioLayers.push(playAudioLayer({ synthType: sound.synthType, audioId: sound.audioId })));
      syncFavoriteButton();
    });

    // Keep the original storage key so previously saved Soundscapes remain intact.
    const soundscapeHome = createSoundscapeHome({
      catalog: AUDIO_CATALOG,
      onPlaySaved: saved => playSavedSoundscape(saved),
      onCreate: () => goToCreate(),
      onBack: destination => navigateTo(destination === 'library' ? 'screen-library' : 'screen-home'),
      onChanged: () => syncFavoriteButton(),
      notify: showToast
    });
    function syncFavoriteButton() {
      const button = document.getElementById('saveSoundscapeBtn');
      const saved = soundscapeHome.hasSession(State.selectedMode, State.currentSessionSounds);
      button.classList.toggle('saved', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', saved ? 'Remove saved Soundscape' : 'Save this Soundscape');
      spatialMixer?.syncSaved();
    }
    document.getElementById('saveSoundscapeBtn').addEventListener('click', () => {
      soundscapeHome.toggleSession({
        title: document.getElementById('nowListeningTitle').textContent,
        mode: State.selectedMode || 'relax',
        sounds: State.currentSessionSounds
      });
      syncFavoriteButton();
    });
    renderCreateSounds();
    soundscapeHome.renderHome();
    ['openTimerBtn', 'masterPlayPauseBtn', 'mixerBtn'].forEach(id => {
      const element = document.getElementById(id);
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); element.click();
        }
      });
    });

    // Spatial mixer: frequency tone stays separate, all selected recordings get an orb.
    spatialMixer = setupSpatialMixer({
      getTracks: () => State.activeAudioLayers
        .filter(layer => !layer.isFrequency)
        .map((layer, index) => {
          const sound = State.currentSessionSounds[index] || {};
          const id = sound.audioId || sound.synthType || `layer-${index}`;
          return {
            id,
            name: sound.name || layer.name || `Sound ${index + 1}`,
            type: sound.synthType || (sound.name || '').toLowerCase(),
            volume: Number.isFinite(sound.volume) ? sound.volume : (layer.getVolume?.() ?? 0.5),
            setVolume: volume => {
              layer.setVolume?.(volume);
              sound.volume = volume;
              syncFavoriteButton();
            }
          };
        }),
      navigateTo,
      isPlaying: () => State.isPlaying,
      togglePlayback: () => masterPlayPauseBtn.click(),
      openTimer: () => openTimerBtn.click(),
      toggleSave: () => document.getElementById('saveSoundscapeBtn').click()
    });

    // Boot: Ensure Home is active and ready
    navigateTo('screen-home');
