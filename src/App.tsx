/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, Plus, Minus, Volume2, Activity, Zap, Circle, Drum, Keyboard, Music, Disc, Speaker, Target, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type InstrumentType = 'kick' | 'snare' | 'hihat' | 'tom' | 'piano' | 'violin';

interface Step {
  active: boolean;
}

interface Track {
  id: InstrumentType;
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

// --- Audio Engine ---

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private masterFilter: BiquadFilterNode | null = null;
  private analyser: AnalyserNode | null = null;

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
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
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

const SpectralVisualizer = ({ isEnabled }: { isEnabled: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(null);

  useEffect(() => {
    if (!isEnabled || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const analyser = engine.getAnalyser();
    
    if (!ctx || !analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height;
        
        ctx.fillStyle = `rgba(255, 183, 178, ${0.1 + (dataArray[i] / 255) * 0.5})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isEnabled]);

  if (!isEnabled) return null;

  return (
    <canvas 
      ref={canvasRef} 
      className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
      width={800}
      height={400}
    />
  );
};

export default function App() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [bpm, setBpm] = useState(INITIAL_BPM);
  const [resonance, setResonance] = useState(0);
  const [showVisuals, setShowVisuals] = useState(true);
  const [waitingMode, setWaitingMode] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [visualNotes, setVisualNotes] = useState<VisualNote[]>([]);

  // Update resonance in engine
  useEffect(() => {
    engine.setResonance(resonance);
  }, [resonance]);
  const [tracks, setTracks] = useState<Track[]>(
    TRACKS_CONFIG.map(config => ({
      ...config,
      steps: Array(STEPS_COUNT).fill(null).map(() => ({ active: false })),
    }))
  );

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
        
        // Trigger visual note if enabled
        if (showVisuals) {
          spawnVisualNote(track, step);
        }
      }
    });
  }, [tracks, showVisuals, spawnVisualNote]);

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
      if (showVisuals) {
        spawnVisualNote(track, stepIndex);
      }
    }
  };

  const clearSteps = () => {
    setTracks(tracks.map(t => ({
      ...t,
      steps: t.steps.map(() => ({ active: false }))
    })));
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white/90 font-mono p-4 md:p-8 flex flex-col items-center justify-center transition-colors duration-500 relative overflow-hidden">
      <SpectralVisualizer isEnabled={showVisuals} />
      
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
            <span className="text-[10px] opacity-40 mb-1 uppercase">Visuels</span>
            <button 
              onClick={() => setShowVisuals(!showVisuals)}
              className={`flex items-center justify-center w-12 h-11 rounded-lg border transition-all ${
                showVisuals 
                  ? 'bg-[#FFB7B2]/20 border-[#FFB7B2]/40 text-[#FFB7B2]' 
                  : 'bg-white/5 border-white/10 text-white/40'
              }`}
              title={showVisuals ? "Désactiver les visuels" : "Activer les visuels"}
            >
              {showVisuals ? <Eye size={20} /> : <EyeOff size={20} />}
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
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="w-full max-w-4xl bg-white/5 p-6 rounded-2xl border border-white/10 shadow-2xl relative overflow-hidden">
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
              key={track.id} 
              className="flex items-center gap-4 p-3 rounded-2xl transition-all duration-300 group"
              style={{ 
                backgroundColor: `${track.color}08`, // Very subtle background tint
                borderLeft: `4px solid ${track.color}44` // Colored left border
              }}
            >
              <div className="w-24 flex flex-col items-start">
                <div 
                  className="px-2 py-1 rounded-md mb-1 flex items-center gap-1.5"
                  style={{ backgroundColor: `${track.color}22` }}
                >
                  <span style={{ color: track.color }}>{track.icon}</span>
                  <span className="text-[9px] font-black uppercase tracking-wider" style={{ color: track.color }}>{track.name}</span>
                </div>
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
        </div>

        {/* Playhead indicator */}
        <div className="mt-4 flex items-center gap-4">
          <div className="w-20" />
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
    </div>
  );
}
