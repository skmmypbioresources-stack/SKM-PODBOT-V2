import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { Mic, Square, Play, Loader2, Volume2, Circle, Music, Maximize2, Minimize2, Download, ExternalLink, Copy, Check, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// PCM 16kHz to Float32 conversion
function pcmToFloat32(base64Data: string): Float32Array {
  const binaryString = window.atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const int16Array = new Int16Array(bytes.buffer, 0, len / 2);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  return float32Array;
}

// Float32 to Int16 PCM conversion (for sending to Gemini)
function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

// Helper to convert Int16Array to Base64
function int16ToBase64(int16Array: Int16Array): string {
  const uint8Array = new Uint8Array(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < uint8Array.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(uint8Array.slice(i, i + chunk)));
  }
  return window.btoa(binary);
}

type SessionStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'ending';

type TranscriptItem = {
  role: 'user' | 'ai';
  text: string;
};

const BIOLOGY_TOPICS = [
  "Characteristics and classification of living organisms",
  "Organisation of the organism",
  "Movement into and out of cells",
  "Biological molecules",
  "Enzymes",
  "Plant nutrition",
  "Human nutrition",
  "Transport in plants",
  "Transport in animals",
  "Diseases and immunity",
  "Gas exchange in humans",
  "Respiration",
  "Excretion in humans",
  "Coordination and response",
  "Drugs",
  "Reproduction",
  "Inheritance",
  "Variation and selection",
  "Organisms and their environment",
  "Human influences on ecosystems",
  "Biotechnology and genetic modification"
];

const BIOTUNES_DATA = {
  "Adaptations": [
    "Red blood cell", "White blood cell", "Neuron", "Muscle cell", "Root hair cell",
    "Palisade mesophyll cell", "Guard cell", "Sperm cell", "Ovum", "Ciliated epithelial cell",
    "Xylem vessel", "Phloem sieve tube", "Stomata", "Leaf (internal structure)", "Chloroplast",
    "Alveolus", "Artery", "Vein", "Capillary", "Heart", "Villus", "Small intestine",
    "Stomach", "Liver", "Pancreas", "Kidney nephron", "Glomerulus", "Bowman’s capsule",
    "Loop of Henle", "Trachea", "Bronchus", "Bronchiole", "Cartilage", "Skin (epidermis)",
    "Sweat gland"
  ],
  "Processes": [
    "Diffusion", "Osmosis", "Active transport", "Enzyme", "Digestion", "Ingestion",
    "Absorption", "Assimilation", "Egestion", "Respiration", "Aerobic respiration",
    "Anaerobic respiration", "Photosynthesis", "Transpiration", "Excretion",
    "Homeostasis", "Growth", "Development", "Mitosis", "Meiosis", "Fertilization",
    "Tissue", "Organ", "Organ system", "Metabolism", "Catalyst", "Denaturation",
    "Substrate", "Concentration gradient", "Surface area to volume ratio"
  ],
  "Advanced Concepts": [
    "Pathogen", "Antibody", "Antigen", "Hormone", "Synapse", "Reflex arc",
    "Natural selection", "Mutation", "Allele", "Genotype", "Phenotype",
    "Ecosystem", "Trophic level", "Decomposer"
  ]
};

const BEAT_POOL = [
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
  "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3"
];

export default function App() {
  const [userEmail, setUserEmail] = useState<string>("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<'discuss' | 'tunes'>('discuss');
  const [isAdminView, setIsAdminView] = useState(false);
  const [selectedTune, setSelectedTune] = useState<string>("");
  const [customTuneWord, setCustomTuneWord] = useState<string>("");
  const [selectedLevel, setSelectedLevel] = useState<'basic' | 'elaborate'>('basic');
  const [isPlayingTune, setIsPlayingTune] = useState(false);
  const [isTuneFullscreen, setIsTuneFullscreen] = useState(false);
  const [userGlobalApiKey, setUserGlobalApiKey] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [enableVisuals, setEnableVisuals] = useState(false);
  const [tuneLyrics, setTuneLyrics] = useState<string>("");
  const [tuneImage, setTuneImage] = useState<string>("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminStats, setAdminStats] = useState<{ total: number, users: any[] } | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptItems, setTranscriptItems] = useState<TranscriptItem[]>([]);
  const [topic, setTopic] = useState<string>("");
  const [isSettingTopic, setIsSettingTopic] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [aiLevel, setAiLevel] = useState(0);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [currentTranscription, setCurrentTranscription] = useState("");
  const [bytesSent, setBytesSent] = useState(0);
  const statusRef = useRef<SessionStatus>('idle');

  const addLog = (msg: string) => {
    console.log(msg);
    setLogs(prev => [msg, ...prev].slice(0, 5));
  };

  useEffect(() => {
    const savedKey = localStorage.getItem('skm_gemini_api_key');
    if (savedKey) {
      setUserGlobalApiKey(savedKey);
      addLog("Personal API Key loaded from local storage.");
    }
  }, []);

  useEffect(() => {
    if (userGlobalApiKey) {
      localStorage.setItem('skm_gemini_api_key', userGlobalApiKey);
    }
  }, [userGlobalApiKey]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
      addLog("App is installable!");
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      addLog("User accepted the install prompt");
    } else {
      addLog("User dismissed the install prompt");
    }
    setDeferredPrompt(null);
    setIsInstallable(false);
  };

  const setStatusWithRef = (s: SessionStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  useEffect(() => {
    const apiKey = process.env.GEMINI_API_KEY as string;
    if (!apiKey) {
      addLog("WARNING: GEMINI_API_KEY is not set in environment.");
    } else {
      addLog("GEMINI_API_KEY is available.");
    }
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Refs for audio handling
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const mixedDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const aiGainRef = useRef<GainNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextStartTimeRef = useRef<number>(0);
  const aiCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const isUserEndingRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECTS = 5;

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcriptItems]);

  // Initialize Audio Context and Nodes
  const initAudio = async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();

    // Mixed destination for recording
    mixedDestinationRef.current = ctx.createMediaStreamDestination();

    // AI Audio output nodes
    const aiCompressor = ctx.createDynamicsCompressor();
    aiCompressor.threshold.setValueAtTime(-24, ctx.currentTime);
    aiCompressor.knee.setValueAtTime(30, ctx.currentTime);
    aiCompressor.ratio.setValueAtTime(12, ctx.currentTime);
    aiCompressor.attack.setValueAtTime(0.003, ctx.currentTime);
    aiCompressor.release.setValueAtTime(0.25, ctx.currentTime);
    aiCompressorRef.current = aiCompressor;

    aiGainRef.current = ctx.createGain();
    aiGainRef.current.gain.value = 1.5; // Slightly lower to avoid clipping, compressor will handle clarity
    addLog(`AI Gain set to: ${aiGainRef.current.gain.value}`);
    
    aiGainRef.current.connect(aiCompressor);
    aiCompressor.connect(ctx.destination);
    aiGainRef.current.connect(mixedDestinationRef.current);

    // Mic input nodes
    const micStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 24000
      } 
    });
    micStreamRef.current = micStream;
    const micSource = ctx.createMediaStreamSource(micStream);
    micGainRef.current = ctx.createGain();
    addLog(`Mic Gain initialized.`);
    micSource.connect(micGainRef.current);
    micGainRef.current.connect(mixedDestinationRef.current);

    // Setup mic processing for Gemini - Use smaller buffer for lower latency
    const processor = ctx.createScriptProcessor(1024, 1, 1);
    micGainRef.current.connect(processor);
    
    // Analyzer for Mic
    const micAnalyzer = ctx.createAnalyser();
    micAnalyzer.fftSize = 256;
    micGainRef.current.connect(micAnalyzer);
    const micDataArray = new Uint8Array(micAnalyzer.frequencyBinCount);

    // Analyzer for AI
    const aiAnalyzer = ctx.createAnalyser();
    aiAnalyzer.fftSize = 256;
    aiGainRef.current.connect(aiAnalyzer);
    const aiDataArray = new Uint8Array(aiAnalyzer.frequencyBinCount);

    const updateLevels = () => {
      if (statusRef.current === 'idle') return;
      micAnalyzer.getByteFrequencyData(micDataArray);
      aiAnalyzer.getByteFrequencyData(aiDataArray);
      
      const mSum = micDataArray.reduce((a, b) => a + b, 0);
      const aSum = aiDataArray.reduce((a, b) => a + b, 0);
      
      setMicLevel(mSum / micDataArray.length);
      setAiLevel(aSum / aiDataArray.length);
      
      requestAnimationFrame(updateLevels);
    };
    updateLevels();

    // Create a silent gain node for the processor to prevent audio feedback to speakers
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    let totalBytes = 0;
    let lastLogTime = 0;
    processor.onaudioprocess = (e) => {
      const currentStatus = statusRef.current;
      if (sessionRef.current && (currentStatus === 'listening' || currentStatus === 'speaking')) {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Send all audio to Gemini for maximum responsiveness
        try {
          const pcmData = float32ToInt16(inputData);
          const base64Data = int16ToBase64(pcmData);
          sessionRef.current.sendRealtimeInput({
            media: { data: base64Data, mimeType: 'audio/pcm;rate=24000' }
          });
          
          totalBytes += pcmData.byteLength;
          const now = Date.now();
          const hasActivity = inputData.some(v => Math.abs(v) > 0.05);
          if (hasActivity) {
            setIsAiThinking(true);
          }

          if (now - lastLogTime > 2000) {
            setBytesSent(totalBytes);
            addLog(`Mic active: ${Math.round(totalBytes / 1024)}KB uploaded`);
            lastLogTime = now;
          }
        } catch (err) {
          addLog(`Send error: ${err}`);
          console.error("Error sending audio:", err);
        }
      }
    };

    // Start recording the mixed stream AFTER all connections are made
    recordedChunksRef.current = [];
    
    // Try to find a supported mimeType, but keep it simple
    let mimeType = '';
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) {
        mimeType = t;
        break;
      }
    }

    try {
      addLog(`Stream tracks: ${mixedDestinationRef.current.stream.getTracks().length}`);
      const mediaRecorder = mimeType 
        ? new MediaRecorder(mixedDestinationRef.current.stream, { mimeType })
        : new MediaRecorder(mixedDestinationRef.current.stream);
        
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
          // Only log every few chunks to avoid spam
          if (recordedChunksRef.current.length % 5 === 0) {
            addLog(`Recording: ${recordedChunksRef.current.length} chunks collected`);
          }
        }
      };
      mediaRecorder.onstop = () => {
        addLog(`Recorder stopped. Total chunks: ${recordedChunksRef.current.length}`);
        if (recordedChunksRef.current.length > 0) {
          const blob = new Blob(recordedChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
          addLog(`Blob created: ${Math.round(blob.size / 1024)} KB, type: ${blob.type}`);
          const url = URL.createObjectURL(blob);
          
          setRecordingUrl(url);
          setRecordingBlob(blob);

          // Immediate Auto-Download
          try {
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            const fileName = topic.trim() ? `${topic.replace(/\s+/g, '_')}_session.webm` : 'session_recording.webm';
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
              if (document.body.contains(a)) document.body.removeChild(a);
              addLog("Auto-download complete.");
            }, 500);
          } catch (downloadErr) {
            addLog(`Auto-download failed: ${downloadErr}`);
          }
        } else {
          addLog("Error: No audio data was captured during the session.");
          alert("Recording failed: No audio data captured. Please check your microphone permissions.");
        }
      };
      mediaRecorder.start(1000); // Record in 1s chunks
      addLog(`Recorder started (${mediaRecorder.mimeType || 'default'})`);
      setIsRecording(true);
    } catch (e) {
      addLog(`MediaRecorder init failed: ${e}`);
      console.error("MediaRecorder error:", e);
    }

    return { ctx, micStream };
  };

  // Playback queue for AI audio using scheduling to eliminate gaps
  const scheduleNextInQueue = useCallback(async () => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current || !aiGainRef.current) {
      if (audioQueueRef.current.length === 0 && status === 'speaking' && !isPlayingRef.current) {
        setStatus('listening');
      }
      return;
    }

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') await ctx.resume();

    const data = audioQueueRef.current.shift()!;
    const buffer = ctx.createBuffer(1, data.length, 24000);
    buffer.getChannelData(0).set(data);
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(aiGainRef.current);
    
    // Schedule playback
    const now = ctx.currentTime;
    let startTime = Math.max(now, nextStartTimeRef.current);
    
    // If we're too far behind, catch up
    if (startTime < now) startTime = now;
    
    source.start(startTime);
    isPlayingRef.current = true;
    
    const duration = buffer.duration;
    nextStartTimeRef.current = startTime + duration;

    source.onended = () => {
      // Check if this was the last chunk
      if (ctx.currentTime >= nextStartTimeRef.current - 0.05) {
        isPlayingRef.current = false;
      }
      scheduleNextInQueue();
    };
  }, [status]);

  useEffect(() => {
    if (audioQueueRef.current.length > 0) {
      scheduleNextInQueue();
    }
  }, [audioQueueRef.current.length, scheduleNextInQueue]);

  const testAudio = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();
      
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, ctx.currentTime);
      
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.5);
      addLog("Test beep played.");
    } catch (err) {
      addLog(`Test Audio Failed: ${err}`);
    }
  };

  const copyLogs = () => {
    const logText = logs.join('\n');
    navigator.clipboard.writeText(logText);
    alert("Logs copied to clipboard!");
  };

  const startSession = async (isReconnect = false) => {
    if (!topic.trim()) {
      alert("Please enter a topic first.");
      return;
    }
    try {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      if (!isReconnect) {
        addLog("Starting session...");
        setTranscriptItems([]);
        reconnectCountRef.current = 0;
        isUserEndingRef.current = false;
      } else {
        addLog(`Reconnecting session (Attempt ${reconnectCountRef.current + 1})...`);
      }

      setIsSettingTopic(false);
      setStatusWithRef('connecting');
      
      const { ctx, micStream } = await initAudio();
      addLog("Audio initialized.");
      
      const apiKey = userGlobalApiKey.trim() || process.env.GEMINI_API_KEY as string;
      if (!apiKey) {
        addLog("Error: No API Key provided.");
        setShowSettings(true);
        throw new Error("Please provide your personal Gemini API Key in Settings to start.");
      }
      addLog(`Using API Key: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);

      const ai = new GoogleGenAI({ apiKey });
      
      // If reconnecting, provide a brief summary of the previous conversation to maintain context
      const historyContext = isReconnect && transcriptItems.length > 0 
        ? `\n\nPREVIOUS CONVERSATION CONTEXT (Continue from here):\n${transcriptItems.slice(-5).map(item => `${item.role.toUpperCase()}: ${item.text}`).join('\n')}`
        : "";

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          systemInstruction: `You are SKM, a world-class tutor and conversationalist with a professional male voice. Topic: "${topic}". ${historyContext}
          
          CRITICAL: ${isReconnect ? "The session just reconnected. Continue the conversation naturally from where we left off." : `You MUST start the conversation immediately by saying: 'Hi, I am SKM, your PodBot. Before we dive into ${topic}, could you let me know if you are studying at the MYP, IGCSE, A-Level, or IBDP level?'`}
          
          1. This is a LIVE, ultra-fast voice conversation. 
          2. Speak with a natural, authoritative yet friendly male tone.
          3. Match the user's energy and tone where appropriate to create a seamless conversation.
          4. When you hear the user speak, respond IMMEDIATELY. No long pauses.
          5. DEPTH CONTROL:
             - MYP/IGCSE: Keep it clear, fundamental, and focused on core syllabus points.
             - A-Level/IBDP: Shift to "Genius Mode". Provide university-level depth, complex biochemical/physiological mechanisms, multiple perspectives, and sophisticated analogies. Do not give superficial answers.
          6. RESPONSE LENGTH:
             - For MYP/IGCSE: Keep responses brief (under 15 seconds).
             - For A-Level/IBDP: You may speak for up to 2 minutes non-stop if explaining a complex concept, but ensure it remains a dialogue by checking in with the student.
          7. If the user is silent for more than 3 seconds, ask a quick follow-up question about ${topic} relevant to their level.`,
        },
        callbacks: {
          onopen: () => {
            addLog("Connection opened.");
            setStatusWithRef('listening');
            reconnectCountRef.current = 0; // Reset on successful connection
            sessionPromise.then((session) => {
              addLog("Sending initial nudge...");
              // Send 200ms of silence at 24kHz to ensure the model wakes up
              const silentData = window.btoa(String.fromCharCode(...new Uint8Array(4800).fill(0)));
              session.sendRealtimeInput({
                media: { data: silentData, mimeType: 'audio/pcm;rate=24000' }
              });
              addLog("Nudge sent.");
            });
          },
          onmessage: async (message) => {
            setIsAiThinking(false);
            // Comprehensive debug log
            const msgKeys = Object.keys(message);
            addLog(`Msg: ${msgKeys.join(', ')}`);
            
            if (message.serverContent) {
              const content = message.serverContent;
              const contentKeys = Object.keys(content);
              addLog(`Content: ${contentKeys.join(', ')}`);
              
              if (content.modelTurn) {
                const parts = content.modelTurn.parts || [];
                addLog(`AI Turn: ${parts.length} parts`);
                const textPart = parts.find(p => p.text);
                if (textPart) addLog(`AI Text: ${textPart.text}`);
              }
              if ((content as any).userTurn) {
                const parts = (content as any).userTurn.parts || [];
                addLog(`User Turn: ${parts.length} parts (Transcribed)`);
                const textPart = parts.find(p => p.text);
                if (textPart) addLog(`User Text: ${textPart.text}`);
              }
              if (content.interrupted) addLog("AI Interrupted.");
            }
            
            // Handle AI Turn
            const modelParts = message.serverContent?.modelTurn?.parts;
            if (modelParts) {
              for (const part of modelParts) {
                if (part.inlineData?.data) {
                  addLog(`AI Audio received. Queue: ${audioQueueRef.current.length + 1}`);
                  const base64Audio = part.inlineData.data;
                  const float32Data = pcmToFloat32(base64Audio);
                  audioQueueRef.current.push(float32Data);
                  setStatusWithRef('speaking');
                  if (!isPlayingRef.current) {
                    addLog("Starting playback.");
                    scheduleNextInQueue();
                  }
                }
                if (part.text) {
                  addLog("AI Text received.");
                  setTranscriptItems(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === 'ai') {
                      return [...prev.slice(0, -1), { ...last, text: last.text + " " + part.text }];
                    }
                    return [...prev, { role: 'ai', text: part.text }];
                  });
                }
              }
            }

            // Handle User Turn (Transcription)
            const userParts = (message.serverContent as any)?.userTurn?.parts;
            if (userParts) {
              for (const part of userParts) {
                if (part.text) {
                  addLog(`User Text: ${part.text}`);
                  setCurrentTranscription(part.text);
                  setTranscriptItems(prev => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === 'user') {
                      return [...prev.slice(0, -1), { ...last, text: part.text }];
                    }
                    return [...prev, { role: 'user', text: part.text }];
                  });
                  // Clear current transcription after a short delay
                  setTimeout(() => setCurrentTranscription(""), 3000);
                }
              }
            }

            if (message.serverContent?.interrupted) {
              addLog("AI Interrupted.");
              audioQueueRef.current = [];
              isPlayingRef.current = false;
              setStatusWithRef('listening');
            }
          },
          onclose: (event) => {
            addLog(`Connection closed: ${event?.reason || 'No reason'}`);
            if (!isUserEndingRef.current && reconnectCountRef.current < MAX_RECONNECTS) {
              reconnectCountRef.current++;
              addLog(`Unexpected disconnection. Attempting auto-reconnect...`);
              startSession(true);
            } else {
              endSession();
            }
          },
          onerror: (err) => {
            const msg = err?.message || JSON.stringify(err);
            const isQuotaError = msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("limit");
            if (isQuotaError) {
              addLog("AI is currently resting (Quota Limit). Please try again in a few minutes!");
              setTranscriptItems(prev => [...prev, { 
                role: 'ai', 
                text: "I'm currently a bit overwhelmed with requests (Quota Limit). Please give me a moment to breathe and try again shortly!" 
              }]);
              endSession();
            } else {
              addLog(`Error: ${msg}`);
              if (!isUserEndingRef.current && reconnectCountRef.current < MAX_RECONNECTS) {
                reconnectCountRef.current++;
                addLog(`Error occurred. Attempting auto-reconnect...`);
                startSession(true);
              } else {
                endSession();
              }
            }
          }
        }
      });

      const session = await sessionPromise;
      sessionRef.current = session;
      addLog("Session resolved and ready.");
    } catch (err) {
      addLog(`Failed: ${err}`);
      setStatusWithRef('idle');
    }
  };

  const endSession = () => {
    isUserEndingRef.current = true;
    setStatusWithRef('ending');
    addLog("Ending session...");
    
    // Stop recorder first to ensure it captures the final chunks
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      addLog("Stopping recorder...");
      mediaRecorderRef.current.stop();
    }

    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    
    // Delay track cleanup slightly to allow recorder to finish
    setTimeout(() => {
      if (micStreamRef.current) {
        addLog("Cleaning up mic tracks.");
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
      setIsRecording(false);
      setStatusWithRef('idle');
    }, 500);
  };

  const playRecording = () => {
    if (recordingUrl) {
      addLog("Playing recording...");
      const audio = new Audio(recordingUrl);
      audio.play();
    }
  };

  const saveSession = () => {
    addLog("Manual save requested.");
    if (recordingBlob) {
      try {
        const url = URL.createObjectURL(recordingBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const fileName = topic.trim() ? `${topic.replace(/\s+/g, '_')}_session.webm` : 'session_recording.webm';
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (document.body.contains(a)) document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
          addLog("Manual save complete.");
        }, 500);
      } catch (err) {
        addLog(`Manual save failed: ${err}`);
      }
    } else {
      addLog("Manual save failed: No recording blob available.");
      alert("No recording found. Did you start and end a session?");
    }
  };

  const resetSession = () => {
    addLog("Resetting session...");
    setRecordingUrl(null);
    setRecordingBlob(null);
    setTopic("");
    setIsSettingTopic(true);
    setTranscriptItems([]);
    setStatusWithRef('idle');
  };

  const sendTextMessage = () => {
    if (sessionRef.current && textInput.trim()) {
      addLog(`Sending text: ${textInput}`);
      sessionRef.current.sendRealtimeInput({
        text: textInput
      });
      setTranscriptItems(prev => [...prev, { role: 'user', text: textInput }]);
      setTextInput("");
      setIsAiThinking(true);
    }
  };

  const manualNudge = () => {
    if (sessionRef.current && audioContextRef.current) {
      addLog("Sending audio tone nudge...");
      // Create a 440Hz tone for 200ms at 24kHz
      const sampleRate = 24000;
      const duration = 0.2;
      const numSamples = sampleRate * duration;
      const samples = new Float32Array(numSamples);
      for (let i = 0; i < numSamples; i++) {
        samples[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5;
      }
      const pcmData = float32ToInt16(samples);
      const base64Data = int16ToBase64(pcmData);
      
      sessionRef.current.sendRealtimeInput({
        media: { data: base64Data, mimeType: 'audio/pcm;rate=24000' }
      });
      setIsAiThinking(true);
    } else {
      addLog("No active session.");
    }
  };

  const backgroundBeatRef = useRef<HTMLAudioElement | null>(null);
  const tuneSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const beatSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const beatGainRef = useRef<GainNode | null>(null);

  const lastBeatIndexRef = useRef<number>(-1);

  const stopBioTune = () => {
    if (tuneSourceRef.current) {
      try { tuneSourceRef.current.stop(); } catch (e) {}
      tuneSourceRef.current = null;
    }
    if (beatSourceRef.current) {
      try { beatSourceRef.current.stop(); } catch (e) {}
      beatSourceRef.current = null;
    }
    if (backgroundBeatRef.current) {
      backgroundBeatRef.current.pause();
      backgroundBeatRef.current.currentTime = 0;
    }
    setIsPlayingTune(false);
    setIsTuneFullscreen(false);
    setTuneLyrics("");
    setTuneImage("");
  };

  const playBioTune = async () => {
    const tuneToPlay = customTuneWord.trim() || selectedTune;
    if (!tuneToPlay) return;
    
    // 1. Pick a DIFFERENT beat every time
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * BEAT_POOL.length);
    } while (nextIndex === lastBeatIndexRef.current && BEAT_POOL.length > 1);
    
    lastBeatIndexRef.current = nextIndex;
    const randomBeatUrl = BEAT_POOL[nextIndex];
    addLog(`Initiating unique beat: ${randomBeatUrl}`);
    
    // Stop any existing beat
    if (backgroundBeatRef.current) {
      backgroundBeatRef.current.pause();
      backgroundBeatRef.current = null;
    }
    if (beatSourceRef.current) {
      try { beatSourceRef.current.stop(); } catch (e) {}
      beatSourceRef.current = null;
    }

    const beat = new Audio();
    beat.src = randomBeatUrl;
    beat.loop = true;
    beat.volume = 0.15; // Documentary-style low background volume
    backgroundBeatRef.current = beat;
    
    beat.load();
    
    const beatPlayPromise = beat.play();
    if (beatPlayPromise !== undefined) {
      beatPlayPromise.catch(err => {
        addLog(`Beat play failed: ${err.message}`);
      });
    }

    setIsPlayingTune(true);
    setTuneLyrics("Fetching exam-standard answer and mixing beats...");
    setTuneImage("");
    addLog(`Generating BioTune for: ${tuneToPlay}`);

    try {
      // 2. Initialize Audio Engine for TTS
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      const apiKey = userGlobalApiKey.trim() || process.env.GEMINI_API_KEY as string;
      if (!apiKey) {
        addLog("Error: No API Key provided.");
        setShowSettings(true);
        throw new Error("Please provide your personal Gemini API Key in Settings to start.");
      }

      const ai = new GoogleGenAI({ apiKey });

      // Step 1: Generate Content based on Level
      const levelPrompt = selectedLevel === 'basic' 
        ? `Provide ONLY the very first basic marking point or core definition for: "${tuneToPlay}". 
           Write exactly 1 or 2 short sentences in very simple English. 
           Do NOT explain, do NOT use analogies, and do NOT teach. 
           Just state the primary factual marking point.`
        : `Provide a strictly exam-standard definition and description for the biological concept: "${tuneToPlay}". 
           CRITICAL: Do NOT write "lyrics" or use any filler words, intros, or outros. 
           Write EXACTLY what a student must reproduce in an IGCSE/A-Level exam script to get full marks. 
           Focus on specific structural adaptations and biological functions. 
           Use high-yield keywords like "<u>large surface area</u>," "<u>concentration gradient</u>," "<u>thin walls</u>," etc. 
           IMPORTANT: Wrap every single key examination term or mark-earning keyword in <u>tags</u>. 
           The text should be rhythmic so it can be performed to a beat, but the words must be 100% factual exam answers. 
           Keep it to 3-5 concise, high-impact lines.`;

      const lyricsResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ 
          parts: [{ 
            text: levelPrompt
          }] 
        }]
      });

      const lyrics = lyricsResponse.text || `Definition for ${tuneToPlay}: [Content Missing]`;
      setTuneLyrics(lyrics);
      addLog(`${selectedLevel === 'basic' ? 'Basic' : 'Exam'} answer generated. Mixing audio...`);

      // Step 2: Generate Background Image (Non-blocking and isolated)
      // Only triggered if user has enabled visuals and provided their own API key to save shared quota.
      if (enableVisuals && userGlobalApiKey.trim()) {
        setTimeout(() => {
          try {
            const imageAi = new GoogleGenAI({ apiKey: userGlobalApiKey.trim() });
            imageAi.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: {
                parts: [
                  {
                    text: `A high-quality, educational, and visually stunning biological illustration or scientific diagram representing: "${tuneToPlay}". 
                           Style: Clean, professional, documentary-style, with a soft focus background. 
                           No text in the image. Vibrant colors but not distracting.`,
                  },
                ],
              },
            }).then(res => {
              const imagePart = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
              if (imagePart?.inlineData?.data) {
                setTuneImage(`data:image/png;base64,${imagePart.inlineData.data}`);
                addLog("Background visual generated using personal API key.");
              }
            }).catch(err => {
              console.warn("BioTune Visual Generation Error (User Key):", err);
              addLog("Visual generation failed (Check your personal API key). Continuing with audio...");
            });
          } catch (e) {
            console.error("Image AI init failed:", e);
          }
        }, 100);
      } else if (enableVisuals) {
        addLog("Visuals enabled but no personal API key provided. Skipping visuals.");
      }

      // Step 3: Generate Audio
      const audioResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ 
          parts: [{ 
            text: `Perform this ${selectedLevel === 'basic' ? 'basic marking point' : 'exam-standard answer'} with a calm, authoritative, and clear documentary narrator tone: ${lyrics}` 
          }] 
        }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
          },
        },
      });

      const base64Audio = audioResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (base64Audio) {
        const float32Data = pcmToFloat32(base64Audio);
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();
        
        addLog("Playing BioTune TTS audio...");
        const buffer = ctx.createBuffer(1, float32Data.length, 24000);
        buffer.getChannelData(0).set(float32Data);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        
        const ttsGain = ctx.createGain();
        ttsGain.gain.value = 1.0; // Voice at full volume
        source.connect(ttsGain);
        ttsGain.connect(ctx.destination);
        
        tuneSourceRef.current = source;
        source.onended = () => {
          if (tuneSourceRef.current === source) {
            setIsPlayingTune(false);
            setTuneLyrics("");
            backgroundBeatRef.current?.pause();
            if (backgroundBeatRef.current) backgroundBeatRef.current.currentTime = 0;
          }
        };
        source.start();
      } else {
        throw new Error("No audio data received from Gemini.");
      }
    } catch (err: any) {
      console.error("BioTune Error:", err);
      const isQuotaError = err.message?.toLowerCase().includes("quota") || err.message?.toLowerCase().includes("limit");
      
      if (isQuotaError) {
        setTuneLyrics("The AI is currently resting (Quota Limit). Please try again in a few minutes! Your learning progress is still safe.");
        addLog("Gemini API Quota Exceeded. Graceful fallback triggered.");
      } else {
        setTuneLyrics(`Oops! Something went wrong: ${err.message}`);
        addLog(`BioTune Error: ${err.message}`);
      }
      
      // Stop the beat but keep the message visible for the user to read
      backgroundBeatRef.current?.pause();
      if (backgroundBeatRef.current) backgroundBeatRef.current.currentTime = 0;
      setIsPlayingTune(false);
      // We don't call stopBioTune() here because it clears the lyrics we just set
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userEmail && userEmail.includes('@')) {
      try {
        await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: userEmail })
        });
      } catch (err) {
        console.error("Failed to log login", err);
      }
      setIsLoggedIn(true);
      addLog(`User logged in: ${userEmail}`);
    }
  };

  const fetchAdminStats = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { "x-admin-password": adminPassword }
      });
      
      if (res.status === 401) {
        alert("Invalid Admin Password");
      } else if (!res.ok) {
        alert(`Server Error (${res.status}): The backend might not be configured correctly on Vercel.`);
      } else {
        const data = await res.json();
        setAdminStats(data);
      }
    } catch (err) {
      alert("Connection Error: Could not reach the server. Check your Vercel deployment logs.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f4] flex flex-col items-center justify-center p-6 font-sans text-[#1c1917]">
      {/* Top Banner for Download */}
      <AnimatePresence>
        {isInstallable && (
          <motion.div 
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            className="fixed top-0 left-0 right-0 z-[200] bg-indigo-600 text-white p-3 flex items-center justify-center space-x-4 shadow-lg"
          >
            <p className="text-[10px] font-black uppercase tracking-widest">Download PodBot to your Desktop for permanent access</p>
            <button 
              onClick={handleInstallClick}
              className="bg-white text-indigo-600 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-indigo-50 transition-all active:scale-95 flex items-center space-x-2"
            >
              <Download className="w-3 h-3" />
              <span>Install Now</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {isAdminView ? (
          <motion.div 
            key="admin"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-2xl bg-white rounded-[32px] shadow-sm border border-black/5 p-10 flex flex-col space-y-8"
          >
            <div className="flex justify-between items-center">
              <h1 className="text-2xl font-black tracking-tight text-stone-900">Admin Dashboard</h1>
              <button onClick={() => { setIsAdminView(false); setAdminStats(null); setAdminPassword(""); }} className="text-xs font-bold text-stone-400 hover:text-stone-600 uppercase tracking-widest">Back</button>
            </div>

            {!adminStats ? (
              <form onSubmit={fetchAdminStats} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 ml-1">Admin Password</label>
                  <input 
                    type="password" 
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password..."
                    className="w-full px-4 py-4 bg-stone-50 border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                  />
                </div>
                <button type="submit" className="w-full py-4 bg-stone-900 text-white rounded-2xl font-bold text-sm shadow-lg transition-all active:scale-[0.98]">View Stats</button>
              </form>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-1">Total Sessions</p>
                    <p className="text-4xl font-black text-indigo-600">{adminStats.total}</p>
                  </div>
                  <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 mb-1">Status</p>
                    <p className="text-4xl font-black text-stone-600">Active</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 ml-1">Recent Logins</p>
                  <div className="max-h-64 overflow-y-auto border border-stone-100 rounded-2xl divide-y divide-stone-100">
                    {adminStats.users.map((u, i) => (
                      <div key={i} className="p-4 flex justify-between items-center bg-white hover:bg-stone-50 transition-colors">
                        <span className="text-sm font-medium text-stone-700">{u.email}</span>
                        <span className="text-[10px] font-mono text-stone-400">{new Date(u.timestamp).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        ) : !isLoggedIn ? (
          <motion.div 
            key="login"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md bg-white rounded-[32px] shadow-sm border border-black/5 p-10 flex flex-col items-center space-y-8"
          >
            <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 rotate-3">
              <span className="text-white text-3xl font-black tracking-tighter">SKM</span>
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-stone-900">Welcome</h1>
              <p className="text-sm text-stone-500 font-medium">Please enter your email to start the session</p>
            </div>
            <form onSubmit={handleLogin} className="w-full space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 ml-1">Email Address</label>
                <input 
                  type="email" 
                  required
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="teacher@school.com"
                  className="w-full px-4 py-4 bg-stone-50 border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                />
              </div>
              <button 
                type="submit"
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-indigo-200 transition-all active:scale-[0.98]"
              >
                Science Hub
              </button>
            </form>
            <div className="flex flex-col items-center space-y-4 w-full">
              <button 
                onClick={() => setShowSettings(true)}
                className="text-[10px] font-bold text-indigo-500 hover:underline flex items-center space-x-1"
              >
                <Settings className="w-3 h-3" />
                <span>How to get your free API Key?</span>
              </button>
              <button 
                onClick={handleInstallClick}
                className={`w-full py-3 border-2 border-dashed border-stone-200 text-stone-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:border-indigo-200 hover:text-indigo-400 transition-all flex items-center justify-center space-x-2 ${!isInstallable ? 'hidden' : ''}`}
              >
                <Download className="w-3 h-3" />
                <span>Download App to Desktop</span>
              </button>
              <p className="text-[10px] text-stone-400 text-center leading-relaxed">
                By continuing, you agree to use PodBot for educational purposes.<br/>
                Your session data helps us improve the learning experience.
              </p>
              <button 
                onClick={() => setIsAdminView(true)}
                className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-300 hover:text-indigo-400 transition-colors"
              >
                Admin Access
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="app"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md bg-white rounded-[32px] shadow-sm border border-black/5 p-8 flex flex-col items-center space-y-12 relative"
          >
            <div className="flex flex-col items-center space-y-4 relative w-full">
              <button 
                onClick={() => setShowSettings(true)}
                className="absolute -top-4 -right-4 p-3 bg-stone-100 hover:bg-stone-200 rounded-full text-stone-500 transition-all active:scale-95"
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 rotate-3">
                <span className="text-white text-3xl font-black tracking-tighter">SKM</span>
              </div>
              <div className="text-center space-y-1">
                <h1 className="text-3xl font-black tracking-tight text-stone-900">PodBot</h1>
                <p className="text-[10px] text-stone-400 font-bold uppercase tracking-[0.2em]">Live AI Voice Session</p>
              </div>
            </div>

            {/* Tab Switcher */}
            <div className="w-full flex bg-stone-100 p-1 rounded-2xl border border-stone-200">
              <button 
                onClick={() => setActiveTab('discuss')}
                className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'discuss' ? 'bg-white text-indigo-600 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
              >
                Discuss
              </button>
              <button 
                onClick={() => setActiveTab('tunes')}
                className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'tunes' ? 'bg-white text-indigo-600 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
              >
                BioTunes
              </button>
            </div>

            {activeTab === 'discuss' ? (
              <>
                {/* Topic Setup or Session Info */}
        {isSettingTopic ? (
          <div className="w-full space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 ml-1">Biology Board Prep</label>
              <select 
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm font-medium text-stone-700"
                value={BIOLOGY_TOPICS.includes(topic) ? topic : ""}
              >
                <option value="" disabled>Select a Biology Topic...</option>
                {BIOLOGY_TOPICS.map((t, i) => (
                  <option key={i} value={t}>{i + 1}. {t}</option>
                ))}
              </select>
            </div>

            <div className="relative flex items-center">
              <div className="flex-grow border-t border-stone-100"></div>
              <span className="flex-shrink mx-4 text-[9px] font-black text-stone-300 uppercase tracking-[0.3em]">OR</span>
              <div className="flex-grow border-t border-stone-100"></div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 ml-1">Custom Discussion</label>
              <input 
                type="text" 
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Type any other topic..."
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
              />
            </div>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center space-x-2">
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-500">Current Topic</p>
              <div className={`w-2 h-2 rounded-full ${status === 'idle' ? 'bg-stone-300' : 'bg-emerald-500 animate-pulse'}`} />
            </div>
            <p className="text-lg font-medium text-stone-800">{topic}</p>
          </div>
        )}

        {/* System Dashboard */}
        {!isSettingTopic && (
          <div className="w-full bg-stone-100/50 rounded-xl p-3 border border-stone-200 grid grid-cols-2 gap-2">
            <div className="flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${process.env.GEMINI_API_KEY ? 'bg-emerald-500' : 'bg-red-500'}`} />
              <span className="text-[9px] font-bold uppercase text-stone-500">API Link</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${micStreamRef.current ? 'bg-emerald-500' : 'bg-stone-300'}`} />
              <span className="text-[9px] font-bold uppercase text-stone-500">Mic Active</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${sessionRef.current ? 'bg-emerald-500' : 'bg-stone-300'}`} />
              <span className="text-[9px] font-bold uppercase text-stone-500">AI Core</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className={`w-1.5 h-1.5 rounded-full ${audioContextRef.current?.state === 'running' ? 'bg-emerald-500' : 'bg-stone-300'}`} />
              <span className="text-[9px] font-bold uppercase text-stone-500">Audio Engine</span>
            </div>
            <div className="flex items-center space-x-2 col-span-2 border-t border-stone-200 pt-1 mt-1">
              <span className="text-[8px] font-bold uppercase text-stone-400">Data Uploaded:</span>
              <span className="text-[8px] font-mono text-stone-600">{Math.round(bytesSent / 1024)} KB</span>
            </div>
          </div>
        )}

        {/* Status Indicator */}
        <div className="flex flex-col items-center space-y-6">
          <div className="relative flex items-center justify-center">
            {/* Mic Visualizer Ring */}
            <motion.div 
              animate={{ scale: 1 + (micLevel / 100) }}
              className="absolute w-40 h-40 rounded-full border-2 border-emerald-500/20"
            />
            {/* AI Visualizer Ring */}
            <motion.div 
              animate={{ scale: 1 + (aiLevel / 100) }}
              className="absolute w-48 h-48 rounded-full border-2 border-indigo-500/10"
            />

            <div className={`w-32 h-32 rounded-full flex items-center justify-center bg-stone-50 border border-stone-100 z-10 relative shadow-inner`}>
              {status === 'idle' && <Circle className="w-12 h-12 text-stone-300" />}
              {status === 'connecting' && <Loader2 className="w-12 h-12 text-stone-400 animate-spin" />}
              {status === 'listening' && (
                <div className="relative">
                  <Mic className="w-12 h-12 text-emerald-600" />
                  {micLevel > 10 && (
                    <motion.div 
                      className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full"
                      animate={{ scale: [1, 1.5, 1] }}
                      transition={{ repeat: Infinity, duration: 0.5 }}
                    />
                  )}
                </div>
              )}
              {status === 'speaking' && <Volume2 className="w-12 h-12 text-indigo-600 animate-pulse" />}
            </div>
          </div>
          
          <div className="flex flex-col items-center space-y-1">
            <AnimatePresence mode="wait">
              <motion.span
                key={status}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-sm font-bold text-stone-700 uppercase tracking-tighter"
              >
                {status === 'idle' && "System Ready"}
                {status === 'connecting' && "Establishing Link..."}
                {status === 'listening' && "AI is Listening"}
                {status === 'speaking' && "AI is Responding"}
                {status === 'ending' && "Finalizing Tape..."}
              </motion.span>
            </AnimatePresence>
            {isAiThinking && (
              <motion.span 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[10px] text-indigo-400 font-medium animate-pulse"
              >
                AI is processing...
              </motion.span>
            )}
          </div>
        </div>

        {/* Level Meters */}
        {!isSettingTopic && status !== 'idle' && (
          <div className="w-full grid grid-cols-2 gap-4 px-4">
            <div className="space-y-1">
              <div className="flex justify-between text-[8px] uppercase font-bold text-stone-400">
                <span>Mic Input</span>
                <span>{Math.round(micLevel)}%</span>
              </div>
              <div className="h-1 bg-stone-200 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-emerald-500"
                  animate={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[8px] uppercase font-bold text-stone-400">
                <span>AI Output</span>
                <span>{Math.round(aiLevel)}%</span>
              </div>
              <div className="h-1 bg-stone-200 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-indigo-500"
                  animate={{ width: `${aiLevel}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Transcription Area */}
        <AnimatePresence>
          {(status === 'speaking' || status === 'listening') && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="w-full bg-stone-900 rounded-2xl p-6 shadow-lg border border-white/10 max-h-80 overflow-y-auto space-y-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Live Transcript & Chat</span>
                </div>
              </div>
              
              <div className="space-y-3">
                {currentTranscription && (
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] font-bold uppercase tracking-tighter text-emerald-500 mb-1 animate-pulse">
                      Live Transcription...
                    </span>
                    <p className="text-sm py-2 px-3 rounded-xl max-w-[90%] bg-emerald-900/20 text-emerald-100 border border-emerald-500/20 rounded-tr-none italic">
                      "{currentTranscription}"
                    </p>
                  </div>
                )}
                {transcriptItems.length === 0 && !currentTranscription && (
                  <p className="text-stone-500 text-xs italic text-center py-4">Waiting for conversation to start...</p>
                )}
                {transcriptItems.map((item, idx) => (
                  <div key={idx} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <span className="text-[9px] font-bold uppercase tracking-tighter text-stone-500 mb-1">
                      {item.role === 'user' ? 'You' : 'PodBot'}
                    </span>
                    <p className={`text-sm py-2 px-3 rounded-xl max-w-[90%] ${
                      item.role === 'user' 
                        ? 'bg-stone-800 text-stone-200 rounded-tr-none' 
                        : 'bg-indigo-900/40 text-indigo-100 border border-indigo-500/20 rounded-tl-none'
                    }`}>
                      {item.text}
                    </p>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>

              {/* Text Fallback Input */}
              <div className="pt-4 border-t border-white/5 flex space-x-2">
                <input 
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendTextMessage()}
                  placeholder="Type to PodBot..."
                  className="flex-1 bg-stone-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
                <button 
                  onClick={sendTextMessage}
                  className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Play className="w-3 h-3" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls */}
        <div className="w-full grid grid-cols-1 gap-4">
          {isSettingTopic ? (
            <button
              onClick={() => startSession()}
              className="w-full py-4 bg-[#1c1917] text-white rounded-2xl font-medium flex items-center justify-center space-x-2 hover:bg-stone-800 transition-colors"
            >
              <Mic className="w-5 h-5" />
              <span>Start Session</span>
            </button>
          ) : status !== 'idle' ? (
            <button
              onClick={endSession}
              disabled={status === 'ending'}
              className="w-full py-4 bg-red-50 text-red-600 border border-red-100 rounded-2xl font-medium flex items-center justify-center space-x-2 hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              <Square className="w-5 h-5 fill-current" />
              <span>End Session</span>
            </button>
          ) : (
            <div className="space-y-4">
              <button
                onClick={playRecording}
                disabled={!recordingUrl}
                className="w-full py-4 bg-white text-stone-700 border border-stone-200 rounded-2xl font-medium flex items-center justify-center space-x-2 hover:bg-stone-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Play Podcast Recording</span>
              </button>
              
              <button
                onClick={saveSession}
                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-medium flex items-center justify-center space-x-2 hover:bg-indigo-700 transition-colors active:scale-[0.98]"
              >
                <Circle className="w-5 h-5 fill-current" />
                <span>Save Session</span>
              </button>

              <button
                onClick={manualNudge}
                disabled={status === 'idle'}
                className="w-full py-2 text-indigo-400 text-[10px] font-medium hover:text-indigo-600 transition-colors border border-dashed border-indigo-200 rounded-xl disabled:opacity-30"
              >
                Manual AI Nudge
              </button>

              <button
                onClick={testAudio}
                className="w-full py-2 text-stone-400 text-[10px] font-medium hover:text-stone-600 transition-colors border border-dashed border-stone-200 rounded-xl"
              >
                Test Audio Output
              </button>

              <button
                onClick={resetSession}
                className="w-full py-2 text-stone-400 text-xs font-medium hover:text-stone-600 transition-colors"
              >
                Start New Session
              </button>
            </div>
          )}
        </div>

        {isRecording && (
          <div className="flex items-center space-x-2 text-xs font-semibold text-red-500 uppercase tracking-widest">
            <motion.div 
              animate={{ opacity: [1, 0, 1] }}
              transition={{ repeat: Infinity, duration: 1 }}
              className="w-2 h-2 bg-red-500 rounded-full"
            />
            <span>Recording Active</span>
          </div>
        )}
              </>
            ) : (
              <div className="w-full space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-xl font-black text-stone-900">BioTunes Library</h2>
                  <p className="text-xs text-stone-500">Catchy pop tunes to help you memorize key concepts.</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 ml-1">Select a Concept</label>
                    <select 
                      value={selectedTune}
                      onChange={(e) => { setSelectedTune(e.target.value); setCustomTuneWord(""); }}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm font-medium text-stone-700"
                    >
                      <option value="" disabled>Choose a term...</option>
                      {Object.entries(BIOTUNES_DATA).map(([category, terms]) => (
                        <optgroup key={category} label={category}>
                          {terms.map((term, i) => (
                            <option key={i} value={term}>{term}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div className="relative flex items-center">
                    <div className="flex-grow border-t border-stone-100"></div>
                    <span className="flex-shrink mx-4 text-[9px] font-black text-stone-300 uppercase tracking-[0.3em]">OR</span>
                    <div className="flex-grow border-t border-stone-100"></div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-400 ml-1">Custom Word/Concept</label>
                    <input 
                      type="text" 
                      value={customTuneWord}
                      onChange={(e) => { setCustomTuneWord(e.target.value); setSelectedTune(""); }}
                      placeholder="Type any word (e.g. Photosynthesis, Gravity...)"
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 ml-1">Learning Level</label>
                    <div className="flex bg-stone-100 p-1 rounded-xl border border-stone-200">
                      <button 
                        onClick={() => setSelectedLevel('basic')}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${selectedLevel === 'basic' ? 'bg-white text-indigo-600 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                      >
                        Basic
                      </button>
                      <button 
                        onClick={() => setSelectedLevel('elaborate')}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${selectedLevel === 'elaborate' ? 'bg-white text-indigo-600 shadow-sm' : 'text-stone-400 hover:text-stone-600'}`}
                      >
                        Elaborate
                      </button>
                    </div>
                  </div>

                  {/* Visuals Settings */}
                  <div className="space-y-4 pt-4 border-t border-stone-100">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-stone-500 ml-1">Enable Background Visuals</label>
                        <p className="text-[9px] text-stone-400 ml-1">Uses your personal API key quota</p>
                      </div>
                      <button 
                        onClick={() => setEnableVisuals(!enableVisuals)}
                        className={`w-10 h-5 rounded-full transition-all relative ${enableVisuals ? 'bg-indigo-600' : 'bg-stone-300'}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${enableVisuals ? 'left-6' : 'left-1'}`} />
                      </button>
                    </div>
                    
                    {!userGlobalApiKey && enableVisuals && (
                      <p className="text-[8px] text-red-400 text-center font-bold">Please set your API Key in Settings first!</p>
                    )}
                  </div>

                  <div className="flex space-x-2">
                    <button 
                      onClick={playBioTune}
                      disabled={(!selectedTune && !customTuneWord.trim()) || isPlayingTune}
                      className={`flex-1 py-4 rounded-2xl font-bold text-sm shadow-lg transition-all flex items-center justify-center space-x-2 ${
                        isPlayingTune 
                          ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed' 
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200 active:scale-[0.98]'
                      }`}
                    >
                      {isPlayingTune ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <span>Mixing...</span>
                        </>
                      ) : (
                        <>
                          <Music className="w-5 h-5" />
                          <span>Play BioTune</span>
                        </>
                      )}
                    </button>

                    {isPlayingTune && (
                      <button 
                        onClick={stopBioTune}
                        className="px-6 py-4 bg-red-50 text-red-600 border border-red-100 rounded-2xl font-bold text-sm hover:bg-red-100 transition-all active:scale-[0.98]"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                </div>

                {isPlayingTune && (
                  <div className="relative bg-indigo-900 border border-indigo-800 rounded-2xl p-6 flex flex-col items-center text-center space-y-4 overflow-hidden shadow-2xl">
                    {/* Animated Background Image */}
                    {tuneImage && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 1.1 }}
                        animate={{ opacity: 0.3, scale: 1 }}
                        transition={{ duration: 2 }}
                        className="absolute inset-0 z-0"
                      >
                        <motion.img 
                          src={tuneImage} 
                          alt={customTuneWord.trim() || selectedTune}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          animate={{ 
                            scale: [1, 1.05, 1],
                            x: [0, 5, 0],
                            y: [0, -5, 0]
                          }}
                          transition={{ 
                            duration: 20, 
                            repeat: Infinity, 
                            ease: "linear" 
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-b from-indigo-900/80 via-transparent to-indigo-900/80" />
                      </motion.div>
                    )}

                    <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center text-white animate-pulse z-10 relative">
                      <Volume2 className="w-6 h-6" />
                    </div>
                    
                    {/* Theater Mode Toggle */}
                    <button 
                      onClick={() => setIsTuneFullscreen(true)}
                      className="absolute top-4 right-4 z-20 p-2 bg-white/10 hover:bg-white/20 rounded-lg text-white/60 hover:text-white transition-all backdrop-blur-sm border border-white/10"
                      title="Theater Mode"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>

                    <div className="space-y-3 w-full z-10 relative">
                      <p className="text-sm font-bold text-white drop-shadow-md">Now Playing: {customTuneWord.trim() || selectedTune}</p>
                      {tuneLyrics && (
                        <div className="bg-black/40 backdrop-blur-md rounded-xl p-4 text-[11px] text-indigo-100 font-medium leading-relaxed italic max-h-40 overflow-y-auto border border-white/10 shadow-inner">
                          {tuneLyrics.split('\n').map((line, i) => (
                            <p key={i} dangerouslySetInnerHTML={{ __html: line }} />
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-indigo-300 uppercase tracking-widest font-black drop-shadow-sm">Turn up the volume!</p>
                    </div>
                  </div>
                )}

                {!isPlayingTune && (
                  <div className="bg-stone-50 border border-stone-200 rounded-2xl p-8 flex flex-col items-center text-center space-y-4 border-dashed">
                    <div className="w-12 h-12 bg-stone-200 rounded-full flex items-center justify-center text-stone-400">
                      <Music className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-stone-400">Select a concept to start</p>
                      <p className="text-[10px] text-stone-300 uppercase tracking-widest font-black">Your musical library is ready</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm bg-white rounded-[32px] p-8 shadow-2xl space-y-6"
            >
              <div className="text-center space-y-2">
                <h2 className="text-xl font-black text-stone-900">Personal Setup</h2>
                <p className="text-xs text-stone-500">To support thousands of users, PodBot works independently using your own free API key.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 ml-1">Your Gemini API Key</label>
                  <div className="relative">
                    <input 
                      type="password" 
                      value={userGlobalApiKey}
                      onChange={(e) => setUserGlobalApiKey(e.target.value)}
                      placeholder="Enter your personal API Key..."
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm pr-12"
                    />
                    <button 
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          if (text) {
                            setUserGlobalApiKey(text);
                            addLog("Key pasted from clipboard!");
                          }
                        } catch (err) {
                          addLog("Clipboard access denied. Please paste manually.");
                        }
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-indigo-500 transition-colors"
                      title="Paste from Clipboard"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Guide Section */}
                <div className="bg-stone-50 rounded-2xl p-4 border border-stone-100 space-y-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">How to get your key:</p>
                  
                  <div className="space-y-3">
                    <div className="flex items-start space-x-3">
                      <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 text-[10px] font-bold flex-shrink-0 mt-0.5">1</div>
                      <div className="space-y-1">
                        <p className="text-[11px] font-bold text-stone-700">Go to Google AI Studio</p>
                        <div className="flex items-center space-x-2">
                          <a 
                            href="https://aistudio.google.com/app/apikey" 
                            target="_blank" 
                            rel="noreferrer" 
                            className="inline-flex items-center space-x-1 text-[10px] text-indigo-500 hover:underline font-bold"
                          >
                            <span>Open AI Studio</span>
                            <ExternalLink className="w-2 h-2" />
                          </a>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText("https://aistudio.google.com/app/apikey");
                              addLog("Link copied!");
                            }}
                            className="p-1 text-stone-400 hover:text-indigo-500 transition-colors"
                            title="Copy Link"
                          >
                            <Copy className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start space-x-3">
                      <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 text-[10px] font-bold flex-shrink-0 mt-0.5">2</div>
                      <p className="text-[11px] text-stone-600 leading-relaxed">Click the <span className="font-bold text-stone-800">"Create API key"</span> button on the top left.</p>
                    </div>

                    <div className="flex items-start space-x-3">
                      <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 text-[10px] font-bold flex-shrink-0 mt-0.5">3</div>
                      <p className="text-[11px] text-stone-600 leading-relaxed">Select <span className="font-bold text-stone-800">"Create API key in new project"</span> and copy the code.</p>
                    </div>

                    <div className="flex items-start space-x-3">
                      <div className="w-5 h-5 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 text-[10px] font-bold flex-shrink-0 mt-0.5">4</div>
                      <p className="text-[11px] text-stone-600 leading-relaxed">Paste the code into the box above and click <span className="font-bold text-stone-800">"Save"</span>.</p>
                    </div>
                  </div>
                </div>

                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                  <p className="text-[10px] text-indigo-600 font-medium leading-relaxed">
                    <strong>Why?</strong> This allows the app to work at full speed for you without sharing a common quota. Your key is stored only on your device.
                  </p>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-indigo-200 transition-all active:scale-[0.98]"
                >
                  Save & Continue
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* BioTunes Theater Mode Overlay */}
      <AnimatePresence>
        {isTuneFullscreen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-12 overflow-hidden"
          >
            {/* Immersive Background */}
            {tuneImage && (
              <motion.div 
                initial={{ scale: 1.2 }}
                animate={{ scale: 1 }}
                className="absolute inset-0 z-0"
              >
                <motion.img 
                  src={tuneImage} 
                  alt={customTuneWord.trim() || selectedTune}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  animate={{ 
                    scale: [1, 1.1, 1],
                    x: [0, 20, 0],
                    y: [0, -20, 0]
                  }}
                  transition={{ 
                    duration: 30, 
                    repeat: Infinity, 
                    ease: "linear" 
                  }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-transparent to-black/80" />
              </motion.div>
            )}

            {/* Close Button */}
            <button 
              onClick={() => setIsTuneFullscreen(false)}
              className="absolute top-8 right-8 z-50 p-4 bg-white/10 hover:bg-white/20 rounded-full text-white/60 hover:text-white transition-all backdrop-blur-md border border-white/10"
            >
              <Minimize2 className="w-6 h-6" />
            </button>

            {/* Content Container */}
            <div className="relative z-10 w-full max-w-5xl flex flex-col items-center text-center mt-auto mb-12 space-y-8">
              <div className="space-y-2">
                <motion.div 
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="flex items-center justify-center space-x-3"
                >
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-2xl shadow-indigo-500/20">
                    <Music className="w-5 h-5" />
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-400">Now Playing</p>
                    <h2 className="text-2xl font-black text-white tracking-tight">{customTuneWord.trim() || selectedTune}</h2>
                  </div>
                </motion.div>
              </div>

              {tuneLyrics && (
                <motion.div 
                  initial={{ y: 40, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="w-full bg-black/40 backdrop-blur-2xl rounded-[32px] p-10 border border-white/10 shadow-2xl"
                >
                  <div className="max-h-[30vh] overflow-y-auto custom-scrollbar pr-4">
                    <div className="text-xl md:text-2xl font-medium text-indigo-50 leading-relaxed italic space-y-4">
                      {tuneLyrics.split('\n').map((line, i) => (
                        <p key={i} dangerouslySetInnerHTML={{ __html: line }} className="drop-shadow-lg" />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="flex flex-col items-center space-y-3">
                <div className="flex items-center space-x-2">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-white/40">Documentary Revision Mode</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
