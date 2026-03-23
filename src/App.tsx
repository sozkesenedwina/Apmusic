/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Plus, Minus, Volume2, Activity, Zap, Circle, Drum, Keyboard, Music, Disc, Speaker, Target, ChevronDown, Trash2, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Polyfill for lamejs bugs
if (typeof window !== 'undefined') {
  if (!(window as any).MPEGMode) {
    function MPEGMode(ordinal: number) {
      (this as any).ordinal = () => ordinal;
    }
    (MPEGMode as any).STEREO = new (MPEGMode as any)(0);
    (MPEGMode as any).JOINT_STEREO = new (MPEGMode as any)(1);
    (MPEGMode as any).DUAL_CHANNEL = new (MPEGMode as any)(2);
    (MPEGMode as any).MONO = new (MPEGMode as any)(3);
    (MPEGMode as any).NOT_SET = new (MPEGMode as any)(4);
    (window as any).MPEGMode = MPEGMode;
  }
  
  if (!(window as any).Lame) {
    (window as any).Lame = {
      V9: 410, V8: 420, V7: 430, V6: 440, V5: 450, V4: 460, V3: 470, V2: 480, V1: 490, V0: 500,
      R3MIX: 1000, STANDARD: 1001, EXTREME: 1002, INSANE: 1003, STANDARD_FAST: 1004, EXTREME_FAST: 1005, MEDIUM: 1006, MEDIUM_FAST: 1007
    };
  }
  
  if (!(window as any).BitStream) {
    (window as any).BitStream = {
      EQ: (a: number, b: number) => {
        return (Math.abs(a) > Math.abs(b)) ? (Math.abs(a - b) <= (Math.abs(a) * 1e-6)) : (Math.abs(a - b) <= (Math.abs(b) * 1e-6));
      },
      NEQ: (a: number, b: number) => {
        return !((window as any).BitStream.EQ(a, b));
      }
    };
  }
}

// --- Types ---

type InstrumentType = 'kick' | 'snare' | 'hihat' | 'tom' | 'piano' | 'violin';

interface Step {
  active: boolean;
}

interface Track {
  id: InstrumentType;
  instanceId: string;
  name: string;
  steps: Step[];
  color: string;
  icon: React.ReactNode;
}

interface VisualNote {
  id: number;
  x: number;
  y: number;
  symbol: string;
  color: string;
  rotation: number;
  trackName?: string;
}

// --- Constants ---

const STEPS_COUNT = 16;
const INITIAL_BPM = 120;

const TRACKS_CONFIG: { id: InstrumentType; name: string; color: string; icon: React.ReactNode }[] = [
  { id: 'kick', name: 'GROSSE CAISSE', color: '#FFB7B2', icon: <Drum size={14} /> },
  { id: 'snare', name: 'CAISSE CLAIRE', color: '#B2E2F2', icon: <Target size={14} /> },
  { id: 'hihat', name: 'CHARLESTON', color: '#B2B2FF', icon: <Disc size={14} /> },
  { id: 'tom', name: 'TOM', color: '#FFDAC1', icon: <Speaker size={14} /> },
  { id: 'piano', name: 'PIANO', color: '#E2F0CB', icon: <Keyboard size={14} /> },
  { id: 'violin', name: 'VIOLON', color: '#C5A3FF', icon: <Music size={14} /> },
];

// --- Audio Converters ---

const convertBlobToAudioBuffer = async (blob: Blob): Promise<AudioBuffer> => {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return await audioCtx.decodeAudioData(arrayBuffer);
};

const audioBufferToWav = (buffer: AudioBuffer, onProgress: (p: number) => void): Promise<Blob> => {
  return new Promise((resolve) => {
    onProgress(0.1);
    setTimeout(() => {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const format = 1; // PCM
      const bitDepth = 16;

      const result = new Float32Array(buffer.length * numChannels);
      for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < buffer.length; i++) {
          result[i * numChannels + channel] = channelData[i];
        }
      }

      onProgress(0.4);

      const dataLength = result.length * (bitDepth / 8);
      const bufferLength = 44 + dataLength;
      const arrayBuffer = new ArrayBuffer(bufferLength);
      const view = new DataView(arrayBuffer);

      const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + dataLength, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, format, true);
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
      view.setUint16(32, numChannels * (bitDepth / 8), true);
      view.setUint16(34, bitDepth, true);
      writeString(view, 36, 'data');
      view.setUint32(40, dataLength, true);

      onProgress(0.6);

      let offset = 44;
      for (let i = 0; i < result.length; i++) {
        const s = Math.max(-1, Math.min(1, result[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }

      onProgress(1);
      resolve(new Blob([view], { type: 'audio/wav' }));
    }, 50);
  });
};

const audioBufferToMp3 = async (buffer: AudioBuffer, onProgress: (p: number) => void): Promise<Blob> => {
  const lamejs = await import('lamejs');

  return new Promise((resolve) => {
    setTimeout(() => {
      const numChannels = buffer.numberOfChannels;
      const sampleRate = buffer.sampleRate;
      const Mp3Encoder = (lamejs as any).Mp3Encoder || (lamejs as any).default?.Mp3Encoder;
      const encoder = new Mp3Encoder(numChannels, sampleRate, 128);
      
      const left = buffer.getChannelData(0);
      const right = numChannels > 1 ? buffer.getChannelData(1) : left;

      const sampleBlockSize = 1152;
      const mp3Data: Int8Array[] = [];

      const floatToInt16 = (f32Array: Float32Array) => {
        const i16Array = new Int16Array(f32Array.length);
        for (let i = 0; i < f32Array.length; i++) {
          const s = Math.max(-1, Math.min(1, f32Array[i]));
          i16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return i16Array;
      };

      const leftInt16 = floatToInt16(left);
      const rightInt16 = floatToInt16(right);
      const totalSamples = leftInt16.length;

      let i = 0;
      const encodeChunk = () => {
        const chunkSize = sampleBlockSize * 100; // Encode chunks to avoid blocking UI
        const end = Math.min(i + chunkSize, totalSamples);
        
        for (; i < end; i += sampleBlockSize) {
          const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
          const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
          const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
          if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
          }
        }
        
        onProgress(i / totalSamples);
        
        if (i < totalSamples) {
          setTimeout(encodeChunk, 0);
        } else {
          const mp3buf = encoder.flush();
          if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
          }
          onProgress(1);
          resolve(new Blob(mp3Data, { type: 'audio/mp3' }));
        }
      };
      
      encodeChunk();
    }, 50);
  });
};

// --- Audio Engine ---

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterFilter: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      this.masterFilter = this.ctx.createBiquadFilter();
      this.masterFilter.type = 'lowpass';
      this.masterFilter.frequency.value = 20000; // Start fully open
      this.masterFilter.Q.value = 1;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.8;

      this.masterFilter.connect(this.analyser);
      this.analyser.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.mediaStreamDestination = this.ctx.createMediaStreamDestination();
      this.masterGain.connect(this.mediaStreamDestination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  startRecording() {
    this.init();
    if (!this.mediaStreamDestination) return;

    this.recordedChunks = [];
    try {
      let options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'audio/ogg;codecs=opus' };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
          options = { mimeType: '' };
        }
      }
      this.mediaRecorder = new MediaRecorder(this.mediaStreamDestination.stream, options);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };
      this.mediaRecorder.start();
    } catch (e) {
      console.error("Recording failed:", e);
    }
  }

  stopRecording(callback: (blob: Blob) => void) {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
      callback(blob);
      this.recordedChunks = [];
    };
    this.mediaRecorder.stop();
  }

  getAnalyser() {
    return this.analyser;
  }

  setResonance(value: number) {
    if (this.masterFilter) {
      // Map 0-100 to 0.1-20 for Q
      this.masterFilter.Q.setTargetAtTime(value * 0.2, this.ctx!.currentTime, 0.05);
      // Also slightly lower cutoff to make resonance more audible
      const cutoff = 20000 - (value * 150);
      this.masterFilter.frequency.setTargetAtTime(Math.max(500, cutoff), this.ctx!.currentTime, 0.05);
    }
  }

  get currentTime() {
    return this.ctx?.currentTime || 0;
  }

  private get output() {
    return this.masterFilter || this.ctx?.destination;
  }

  playKick(time: number = 0) {
    if (!this.ctx || !this.output) return;
    const t = time || this.ctx.currentTime;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(0.01, t + 0.5);

    gain.gain.setValueAtTime(1, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

    osc.connect(gain);
    gain.connect(this.output);

    osc.start(t);
    osc.stop(t + 0.5);
  }

  playSnare(time: number = 0) {
    if (!this.ctx || !this.output) return;
    const t = time || this.ctx.currentTime;

    // Noise part
    const bufferSize = this.ctx.sampleRate * 0.1;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(1, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.output);

    // Tone part
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(100, t);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.7, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);

    osc.connect(oscGain);
    oscGain.connect(this.output);

    noise.start(t);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playHiHat(time: number = 0) {
    if (!this.ctx || !this.output) return;
    const t = time || this.ctx.currentTime;

    const bufferSize = this.ctx.sampleRate * 0.05;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.05);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);

    noise.start(t);
  }

  playTom(time: number = 0) {
    if (!this.ctx || !this.output) return;
    const t = time || this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.3);

    gain.gain.setValueAtTime(0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);

    osc.connect(gain);
    gain.connect(this.output);

    osc.start(t);
    osc.stop(t + 0.3);
  }

  playPiano(time: number = 0) {
    if (!this.ctx || !this.output) return;
    const t = time || this.ctx.currentTime;
    const freq = 261.63; // Do central (C4)

    [1, 2, 3, 4].forEach(h => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * h, t);
      gain.gain.setValueAtTime(0.15 / h, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.0 / h);
      osc.connect(gain);
      gain.connect(this.output!);
      osc.start(t);
      osc.stop(t + 1.0);
    });
  }

  playViolin(time: number = 0) {
    if (!this.ctx || !this.output) return;
    const t = time || this.ctx.currentTime;
    const freq = 440; // La (A4)

    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t);

    lfo.frequency.value = 5; // Vitesse du vibrato
    lfoGain.gain.value = 5; // Profondeur du vibrato
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    filter.type = 'lowpass';
    filter.frequency.value = 1200;

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.6);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.output);

    lfo.start(t);
    osc.start(t);
    osc.stop(t + 0.6);
    lfo.stop(t + 0.6);
  }

  playInstrument(id: InstrumentType, time: number = 0) {
    switch (id) {
      case 'kick': this.playKick(time); break;
      case 'snare': this.playSnare(time); break;
      case 'hihat': this.playHiHat(time); break;
      case 'tom': this.playTom(time); break;
      case 'piano': this.playPiano(time); break;
      case 'violin': this.playViolin(time); break;
    }
  }
}

const engine = new AudioEngine();

// --- Main Component ---

// --- Components ---

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(INITIAL_BPM);
  const [resonance, setResonance] = useState(0);
  const [waitingMode, setWaitingMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [showSuccessNote, setShowSuccessNote] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [visualNotes, setVisualNotes] = useState<VisualNote[]>([]);
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [pendingFormat, setPendingFormat] = useState<'mp3' | 'wav' | null>(null);
  const [filename, setFilename] = useState(`beat-${new Date().toISOString().slice(0, 10)}`);
  const [showFilenameModal, setShowFilenameModal] = useState(false);

  // Update resonance in engine
  useEffect(() => {
    engine.setResonance(resonance);
  }, [resonance]);
  const [tracks, setTracks] = useState<Track[]>(
    TRACKS_CONFIG.slice(0, 4).map(config => ({
      ...config,
      instanceId: Math.random().toString(36).substring(7),
      steps: Array(STEPS_COUNT).fill(null).map(() => ({ active: false })),
    }))
  );

  const addTrack = () => {
    const config = TRACKS_CONFIG[Math.floor(Math.random() * TRACKS_CONFIG.length)];
    setTracks(prev => [
      ...prev,
      {
        ...config,
        instanceId: Math.random().toString(36).substring(7),
        steps: Array(STEPS_COUNT).fill(null).map(() => ({ active: false })),
      }
    ]);
  };

  const removeTrack = (indexToRemove: number) => {
    setTracks(prev => prev.filter((_, index) => index !== indexToRemove));
    setActiveDropdown(null);
  };

  const timerRef = useRef<number | null>(null);
  const nextNoteTimeRef = useRef(0);
  const stepRef = useRef(0);
  const noteIdRef = useRef(0);

  const symbols = ['♩', '♪', '♫', '♬', '♭', '♮', '♯'];

  const spawnVisualNote = useCallback((track: Track, stepIndex: number) => {
    const musicSymbols = ['♩', '♪', '♫', '♬'];
    const pastelColors = [
      '#FFB7B2', '#B2E2F2', '#B2B2FF', '#FFDAC1', 
      '#E2F0CB', '#C5A3FF', '#FFC8A2', '#D4F0F0', 
      '#FFB5E8', '#F3FFE3', '#E6B3FF', '#B3FFF0'
    ];
    const randomColor = pastelColors[Math.floor(Math.random() * pastelColors.length)];
    
    const newNote: VisualNote = {
      id: noteIdRef.current++,
      x: 5 + (stepIndex / STEPS_COUNT) * 90, // Align with the step column horizontally (5% to 95%)
      y: 0, // Not used, we use bottom: 0 in the style
      symbol: musicSymbols[Math.floor(Math.random() * musicSymbols.length)],
      color: randomColor,
      rotation: Math.random() * 40 - 20,
      trackName: track.name
    };
    
    setVisualNotes(prev => [...prev.slice(-30), newNote]);
    
    // Remove note after animation
    setTimeout(() => {
      setVisualNotes(prev => prev.filter(n => n.id !== newNote.id));
    }, 1500);
  }, []);

  const scheduleNote = useCallback((step: number, time: number) => {
    tracks.forEach(track => {
      if (track.steps[step].active) {
        engine.playInstrument(track.id, time);
        
        // Trigger visual note
        spawnVisualNote(track, step);
      }
    });
  }, [tracks, spawnVisualNote]);

  const scheduler = useCallback(() => {
    while (nextNoteTimeRef.current < engine.currentTime + 0.1) {
      scheduleNote(stepRef.current, nextNoteTimeRef.current);
      
      // Update UI step (using a slight delay to match audio)
      const stepToUpdate = stepRef.current;
      setTimeout(() => setCurrentStep(stepToUpdate), (nextNoteTimeRef.current - engine.currentTime) * 1000);

      const secondsPerBeat = 60.0 / bpm;
      nextNoteTimeRef.current += 0.25 * secondsPerBeat; // 16th notes
      stepRef.current = (stepRef.current + 1) % STEPS_COUNT;
    }
    timerRef.current = window.requestAnimationFrame(scheduler);
  }, [bpm, scheduleNote]);

  const togglePlay = useCallback(() => {
    engine.init();
    if (isPlaying) {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
      setIsPlaying(false);
      setCurrentStep(-1);
    } else {
      stepRef.current = 0;
      nextNoteTimeRef.current = engine.currentTime;
      setIsPlaying(true);
      scheduler();
    }
  }, [isPlaying, scheduler]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      engine.stopRecording((blob) => {
        setRecordedBlob(blob);
      });
    } else {
      setIsRecording(true);
      engine.startRecording();
    }
  }, [isRecording]);

  const handleDownload = (format: 'mp3' | 'wav') => {
    setPendingFormat(format);
    setFilename(`beat-${new Date().toISOString().slice(0, 10)}`);
    setShowFilenameModal(true);
  };

  const executeDownload = async () => {
    if (!recordedBlob || !pendingFormat) return;
    setShowFilenameModal(false);
    setIsConverting(true);
    setConversionProgress(0);
    
    try {
      const audioBuffer = await convertBlobToAudioBuffer(recordedBlob);
      let finalBlob: Blob;
      let extension: string;
      
      if (pendingFormat === 'mp3') {
        finalBlob = await audioBufferToMp3(audioBuffer, setConversionProgress);
        extension = 'mp3';
      } else {
        finalBlob = await audioBufferToWav(audioBuffer, setConversionProgress);
        extension = 'wav';
      }
      
      // Wait a moment so the user can see the 100% progress
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const url = URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      const finalFilename = filename.trim() || `beat-${new Date().toISOString().slice(0, 10)}`;
      a.download = `${finalFilename}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setRecordedBlob(null);
      setShowSuccessNote(true);
      setTimeout(() => setShowSuccessNote(false), 3000);
    } catch (error) {
      console.error("Conversion failed:", error);
      alert("Erreur lors de la conversion du fichier audio.");
    } finally {
      setIsConverting(false);
      setConversionProgress(0);
      setPendingFormat(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay]);

  const toggleStep = (trackIndex: number, stepIndex: number) => {
    const newTracks = [...tracks];
    const track = newTracks[trackIndex];
    track.steps[stepIndex].active = !track.steps[stepIndex].active;
    setTracks(newTracks);
    
    // Play sound immediately when toggling on
    if (track.steps[stepIndex].active) {
      engine.init();
      engine.playInstrument(track.id);
      spawnVisualNote(track, stepIndex);
    }
  };

  const clearSteps = () => {
    setTracks(tracks.map(t => ({
      ...t,
      steps: t.steps.map(() => ({ active: false }))
    })));
  };

  const changeTrackInstrument = (trackIndex: number, newInstrumentId: InstrumentType) => {
    const newConfig = TRACKS_CONFIG.find(c => c.id === newInstrumentId);
    if (!newConfig) return;
    
    setTracks(prev => {
      const newTracks = [...prev];
      newTracks[trackIndex] = {
        ...newTracks[trackIndex],
        id: newConfig.id,
        name: newConfig.name,
        color: newConfig.color,
        icon: newConfig.icon,
      };
      return newTracks;
    });
    setActiveDropdown(null);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white/90 font-mono p-4 md:p-8 flex flex-col items-center justify-center transition-colors duration-500 relative overflow-hidden">
      
      {/* Download Modal */}
      <AnimatePresence>
        {recordedBlob && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#1A1A1D] p-8 rounded-2xl border border-white/10 shadow-2xl max-w-md w-full flex flex-col items-center"
            >
              <h2 className="text-xl font-bold mb-2">Enregistrement terminé</h2>
              <p className="text-white/50 text-sm mb-8 text-center">Choisissez le format de téléchargement pour votre création.</p>
              
              {isConverting ? (
                <div className="flex flex-col items-center py-4 w-full">
                  <div className="w-full bg-white/10 rounded-full h-3 mb-4 overflow-hidden">
                    <motion.div 
                      className="bg-[#FFB7B2] h-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${conversionProgress * 100}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <span className="text-sm animate-pulse text-[#FFB7B2]">
                    Conversion en cours... {Math.round(conversionProgress * 100)}%
                  </span>
                </div>
              ) : (
                <div className="flex gap-4 w-full">
                  <button 
                    onClick={() => handleDownload('mp3')}
                    className="flex-1 bg-[#FFB7B2] text-black font-bold py-3 rounded-xl hover:scale-105 transition-transform flex items-center justify-center gap-2"
                  >
                    <Download size={18} /> MP3
                  </button>
                  <button 
                    onClick={() => handleDownload('wav')}
                    className="flex-1 bg-white/10 text-white font-bold py-3 rounded-xl hover:bg-white/20 hover:scale-105 transition-all flex items-center justify-center gap-2"
                  >
                    <Download size={18} /> WAV
                  </button>
                </div>
              )}
              
              {!isConverting && (
                <button 
                  onClick={() => setRecordedBlob(null)}
                  className="mt-6 text-sm text-white/30 hover:text-white/60 transition-colors"
                >
                  Annuler
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Note Overlay */}
      <AnimatePresence>
        {showSuccessNote && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.5, y: -50 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center"
          >
            <div className="bg-[#FFB7B2] text-black p-6 rounded-full shadow-[0_0_50px_rgba(255,183,178,0.5)] flex flex-col items-center">
              <Music size={64} className="mb-2" />
              <span className="font-bold text-lg">Sauvegardé !</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Waiting Mode Overlay */}
      <AnimatePresence>
        {waitingMode && !isPlaying && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[#0A0A0B]/90 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-none"
          >
            <motion.div
              animate={{ 
                scale: [1, 1.05, 1],
                opacity: [0.5, 1, 0.5]
              }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              className="flex flex-col items-center"
            >
              <div className="flex gap-4 mb-6">
                {['♩', '♪', '♫', '♬'].map((note, i) => (
                  <motion.span
                    key={i}
                    animate={{ y: [0, -20, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                    className="text-6xl text-[#B2E2F2]"
                  >
                    {note}
                  </motion.span>
                ))}
              </div>
              <h2 className="text-4xl font-black tracking-[0.3em] text-white text-center">
                EN ATTENTE DU RYTHME...
              </h2>
              <p className="mt-4 text-[10px] uppercase tracking-[0.5em] opacity-40">Appuyez sur Espace ou Lecture pour commencer</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Visual Notes */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <AnimatePresence>
          {visualNotes.map((note) => (
            <motion.div
              key={note.id}
              initial={{ opacity: 0, scale: 0.5, left: `${note.x}%`, bottom: '0%' }}
              animate={{ opacity: [0, 1, 0], scale: [0.5, 1.2, 1], rotate: note.rotation }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="absolute flex flex-col items-center justify-center drop-shadow-lg origin-bottom"
              style={{ color: note.color }}
            >
              <span className="text-5xl font-serif">{note.symbol}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header */}
      <div className="w-full max-w-4xl mb-8 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tighter flex items-center gap-2 text-white">
              <Activity className="text-[#FFB7B2]" />
              LA MUSIQUE EN RYTHME <span className="text-xs font-normal opacity-50 bg-white/10 px-2 py-1 rounded">v1.0.4</span>
            </h1>
            <p className="text-[10px] opacity-40 uppercase tracking-[0.2em] mt-1">Séquenceur à pas et Synthétiseur de Batterie</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col items-center">
            <span className="text-[10px] opacity-40 mb-1 uppercase">Tempo</span>
            <div className="flex items-center gap-3 bg-white/5 p-2 rounded-lg border border-white/10 shadow-sm">
              <button onClick={() => setBpm(Math.max(40, bpm - 5))} className="hover:text-[#FFB7B2] transition-colors"><Minus size={16} /></button>
              <span className="text-xl font-bold w-12 text-center">{bpm}</span>
              <button onClick={() => setBpm(Math.min(240, bpm + 5))} className="hover:text-[#FFB7B2] transition-colors"><Plus size={16} /></button>
            </div>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[10px] opacity-40 mb-1 uppercase">Résonance</span>
            <button 
              onClick={() => setResonance((resonance + 33.3) % 133.2)}
              className="flex items-center justify-center w-24 h-11 bg-white/5 rounded-lg border border-white/10 shadow-sm hover:bg-white/10 transition-all group overflow-hidden relative"
            >
              <div 
                className="absolute bottom-0 left-0 h-1 bg-[#FFB7B2] transition-all duration-300" 
                style={{ width: `${(resonance / 100) * 100}%` }}
              />
              <span className="text-xs font-bold uppercase tracking-widest">
                {resonance < 10 ? 'OFF' : resonance < 40 ? 'LOW' : resonance < 70 ? 'MID' : 'MAX'}
              </span>
            </button>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-[10px] opacity-40 mb-1 uppercase">Attente</span>
            <button 
              onClick={() => setWaitingMode(!waitingMode)}
              className={`flex items-center justify-center w-12 h-11 rounded-lg border transition-all ${
                waitingMode 
                  ? 'bg-[#B2E2F2]/20 border-[#B2E2F2]/40 text-[#B2E2F2]' 
                  : 'bg-white/5 border-white/10 text-white/40'
              }`}
              title={waitingMode ? "Désactiver le mode attente" : "Activer le mode attente"}
            >
              <Music size={20} />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Play Button */}
            <button
              onClick={() => !isPlaying && togglePlay()}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
                isPlaying 
                  ? 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed' 
                  : 'bg-[#FFB7B2] text-white shadow-[#FFB7B2]/40 hover:scale-105'
              }`}
              title="Lecture"
            >
              <Play fill="currentColor" className="ml-1" />
            </button>
            
            {/* Stop Button */}
            <button
              onClick={() => isPlaying && togglePlay()}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
                !isPlaying 
                  ? 'bg-white/5 text-white/20 border border-white/5 cursor-not-allowed' 
                  : 'bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105'
              }`}
              title="Arrêt"
            >
              <Square fill="currentColor" />
            </button>

            {/* Record Button */}
            <button
              onClick={toggleRecording}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
                isRecording 
                  ? 'bg-red-500 text-white shadow-red-500/40 animate-pulse' 
                  : 'bg-white/10 text-white border border-white/20 hover:bg-white/20 hover:scale-105'
              }`}
              title={isRecording ? "Arrêter l'enregistrement" : "Enregistrer le son"}
            >
              <div className={`w-4 h-4 rounded-full ${isRecording ? 'bg-white' : 'bg-red-500'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="w-full max-w-4xl bg-white/5 p-6 rounded-2xl border border-white/10 shadow-2xl relative overflow-hidden">
        {activeDropdown !== null && (
          <div className="fixed inset-0 z-40" onClick={() => setActiveDropdown(null)} />
        )}
        
        {/* Decorative background lines */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none">
          <div className="grid grid-cols-16 h-full w-full">
            {Array(16).fill(0).map((_, i) => (
              <div key={i} className="border-r border-white h-full" />
            ))}
          </div>
        </div>

        <div className="space-y-4 relative z-10">
          {tracks.map((track, trackIdx) => (
            <div 
              key={track.instanceId} 
              className="flex items-center gap-4 p-3 rounded-2xl transition-all duration-300 group"
              style={{ 
                backgroundColor: `${track.color}08`, // Very subtle background tint
                borderLeft: `4px solid ${track.color}44` // Colored left border
              }}
            >
              <div className="w-28 flex flex-col items-start relative z-50">
                <div className="flex items-center justify-between w-full mb-1 gap-1">
                  <button 
                    onClick={() => setActiveDropdown(activeDropdown === trackIdx ? null : trackIdx)}
                    className="px-2 py-1 rounded-md flex-1 flex items-center justify-between hover:opacity-80 transition-opacity overflow-hidden"
                    style={{ backgroundColor: `${track.color}22` }}
                    title="Changer d'instrument"
                  >
                    <div className="flex items-center gap-1.5 overflow-hidden">
                      <span style={{ color: track.color }} className="shrink-0">{track.icon}</span>
                      <span className="text-[9px] font-black uppercase tracking-wider truncate" style={{ color: track.color }}>{track.name}</span>
                    </div>
                    <ChevronDown size={10} style={{ color: track.color }} className="shrink-0 opacity-50 ml-1" />
                  </button>
                  <button
                    onClick={() => removeTrack(trackIdx)}
                    className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all text-white/40 hover:text-red-400 shrink-0"
                    title="Supprimer la ligne"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Dropdown Menu */}
                <AnimatePresence>
                  {activeDropdown === trackIdx && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-1 w-40 bg-[#1A1A1C] border border-white/10 rounded-lg shadow-2xl overflow-hidden"
                    >
                      {TRACKS_CONFIG.map(config => (
                        <button
                          key={config.id}
                          onClick={() => changeTrackInstrument(trackIdx, config.id)}
                          className={`w-full px-3 py-2 flex items-center gap-2 hover:bg-white/5 transition-colors text-left ${track.id === config.id ? 'bg-white/5' : ''}`}
                        >
                          <span style={{ color: config.color }}>{config.icon}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-white/80">{config.name}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full" 
                    style={{ backgroundColor: track.color }}
                    animate={{ width: currentStep !== -1 && track.steps[currentStep].active ? '100%' : '0%' }}
                  />
                </div>
              </div>

              <div className="flex-1 grid grid-cols-8 md:grid-cols-16 gap-1 md:gap-2">
                {track.steps.map((step, stepIdx) => (
                  <button
                    key={stepIdx}
                    onClick={() => toggleStep(trackIdx, stepIdx)}
                    className={`
                      aspect-square rounded-lg transition-all duration-150 relative overflow-hidden
                      ${step.active ? '' : 'bg-white/5 hover:bg-white/10 border border-white/5'}
                      ${currentStep === stepIdx ? 'ring-2 ring-white/30 scale-105 z-20' : ''}
                    `}
                    style={{ 
                      backgroundColor: step.active ? track.color : undefined,
                      boxShadow: step.active ? `0 0 15px ${track.color}66` : 'none',
                      borderColor: step.active ? 'transparent' : undefined
                    }}
                  >
                    {/* Step indicator dot */}
                    <div className={`absolute top-1 right-1 w-1 h-1 rounded-full ${step.active ? 'bg-white' : 'bg-white/20'}`} />
                    
                    {/* Beat markers */}
                    {stepIdx % 4 === 0 && !step.active && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-10">
                        <Circle size={4} fill="currentColor" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          
          {/* Add Track Button */}
          <button
            onClick={addTrack}
            className="w-full py-3 rounded-2xl border border-dashed border-white/20 text-white/40 hover:text-white/80 hover:border-white/40 hover:bg-white/5 transition-all flex items-center justify-center gap-2"
          >
            <Plus size={16} />
            <span className="text-xs font-bold uppercase tracking-widest">Ajouter une ligne</span>
          </button>
        </div>

        {/* Playhead indicator */}
        <div className="mt-4 flex items-center gap-4">
          <div className="w-32" />
          <div className="flex-1 grid grid-cols-8 md:grid-cols-16 gap-1 md:gap-2">
            {Array(STEPS_COUNT).fill(0).map((_, i) => (
              <div key={i} className="flex justify-center">
                <div className={`w-1 h-1 rounded-full transition-all duration-100 ${currentStep === i ? 'bg-white scale-150' : 'bg-white/10'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="w-full max-w-4xl mt-8 flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4 bg-white/5 px-4 py-3 rounded-xl border border-white/10 shadow-sm">
          <div className="flex items-center gap-2 text-[#FFB7B2]">
            <Zap size={16} />
            <span className="text-[10px] uppercase font-bold">État du Moteur</span>
          </div>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-[#44ff44] animate-pulse' : 'bg-white/10'}`} />
            <span className="text-[10px] opacity-60">{isPlaying ? 'EN LECTURE' : 'ARRÊTÉ'}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={clearSteps}
            className="text-[10px] uppercase tracking-widest hover:text-[#FFB7B2] transition-colors border border-white/10 px-4 py-2 rounded-lg bg-white/5 shadow-sm"
          >
            Effacer le Motif
          </button>
          
          <div className="flex items-center gap-2 text-white/20">
            <Volume2 size={16} />
            <div className="w-24 h-1 bg-white/10 rounded-full overflow-hidden">
              <div className="w-3/4 h-full bg-white/40" />
            </div>
          </div>
        </div>
      </div>

      {/* Visualizer Section */}
      <div className="mt-12 w-full max-w-4xl h-24 bg-white/5 rounded-2xl border border-white/10 relative overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-around px-8 opacity-20">
          {Array(12).fill(0).map((_, i) => (
            <motion.div
              key={i}
              className="w-1 bg-white rounded-full"
              animate={{ 
                height: isPlaying ? [20, Math.random() * 60 + 20, 20] : 20 
              }}
              transition={{ 
                repeat: Infinity, 
                duration: 0.6, 
                delay: i * 0.1 
              }}
            />
          ))}
        </div>
        
        <div className="relative z-10 flex gap-4">
          <AnimatePresence>
            {visualNotes.slice(-8).map((note) => (
              <motion.div
                key={`bottom-${note.id}`}
                initial={{ opacity: 0, scale: 0, y: 20 }}
                animate={{ opacity: 1, scale: 1.2, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, x: 20 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="text-3xl font-serif drop-shadow-[0_0_8px_rgba(255,255,255,0.3)]"
                style={{ color: note.color }}
              >
                {note.symbol}
              </motion.div>
            ))}
          </AnimatePresence>
          {!isPlaying && visualNotes.length === 0 && (
            <div className="text-[10px] uppercase tracking-[0.3em] opacity-30 animate-pulse">
              En attente du rythme...
            </div>
          )}
        </div>
        
        {/* Decorative corner labels */}
        <div className="absolute top-2 left-3 text-[8px] font-bold opacity-20 uppercase tracking-widest">Spectral Analysis</div>
        <div className="absolute bottom-2 right-3 text-[8px] font-bold opacity-20 uppercase tracking-widest">Note Stream v1.0</div>
      </div>

      {/* Filename Prompt Modal */}
      <AnimatePresence>
        {showFilenameModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-[#1a1a1a] border border-white/10 p-8 rounded-3xl max-w-md w-full shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-[#FFB7B2]/20 flex items-center justify-center text-[#FFB7B2]">
                  <Music size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Nommer votre création</h3>
                  <p className="text-xs opacity-50 uppercase tracking-widest">Format: {pendingFormat?.toUpperCase()}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-40 mb-2 block tracking-widest">Nom du fichier</label>
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && executeDownload()}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#FFB7B2]/50 transition-colors"
                    placeholder="Mon super beat..."
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowFilenameModal(false);
                      setPendingFormat(null);
                    }}
                    className="flex-1 px-6 py-3 rounded-xl border border-white/10 text-sm font-bold hover:bg-white/5 transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={executeDownload}
                    className="flex-1 px-6 py-3 rounded-xl bg-[#FFB7B2] text-black text-sm font-bold hover:opacity-90 transition-opacity shadow-lg shadow-[#FFB7B2]/20"
                  >
                    Télécharger
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
