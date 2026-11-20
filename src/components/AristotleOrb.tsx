import React, { useEffect, useRef, useState } from 'react';
import {
  Compass,
  Lightbulb,
  Loader2,
  Mic,
  Send,
  Square,
  Terminal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ApiError, api } from '../lib/api.ts';

export interface AristotleLiveContext {
  activeTab: string;
  trackTitle?: string;
  unitTitle?: string;
  levelNumber?: number;
  levelType?: string;
  questionPrompt?: string;
  codeSnippet?: string | null;
  stats?: {
    xp?: number;
    currentStreak?: number;
    totalPoints?: number;
    passedLevelsCount?: number;
  };
}

export interface AristotleQuickRequest {
  id: number;
  prompt: string;
  mode: 'hint' | 'explain' | 'debug' | 'plan' | 'general';
}

interface AristotleOrbProps {
  context: AristotleLiveContext;
  quickRequest?: AristotleQuickRequest | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

const ARISTOTLE_EMBLEM_SRC = '/src/assets/images/aristotle_emblem_1795160958685.jpg';

export function AristotleOrb({ context, quickRequest }: AristotleOrbProps) {
  const [open, setOpen] = useState(false);
  const [emblemFailed, setEmblemFailed] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Greetings, scholar. I am Aristotle—your coding and voice mentor. Ask me for a hint without spoiling the answer, trace a snippet together, or tap the mic to talk through a concept.',
    },
  ]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const lastQuickIdRef = useRef<number | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    if (quickRequest && quickRequest.id !== lastQuickIdRef.current) {
      lastQuickIdRef.current = quickRequest.id;
      setOpen(true);
      void sendToAristotle(quickRequest.prompt, quickRequest.mode);
    }
  }, [quickRequest]);

  function stopAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeakingId(null);
  }

  async function speakText(messageId: string, text: string) {
    stopAudio();
    setSpeakingId(messageId);
    try {
      const res = await api.aristotleSpeak({ text });
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => setSpeakingId(null);
      audio.onerror = () => setSpeakingId(null);
      await audio.play();
    } catch (err) {
      setSpeakingId(null);
      if (err instanceof ApiError) {
        setError(err.message);
      }
    }
  }

  async function sendToAristotle(
    promptText: string,
    mode: 'hint' | 'explain' | 'debug' | 'plan' | 'general' = 'general',
  ) {
    const trimmed = promptText.trim();
    if (!trimmed || sending) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    const nextHistory = [...messages.filter((m) => m.id !== 'welcome'), userMsg];
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await api.aristotleChat({
        message: trimmed,
        mode,
        history: nextHistory.slice(-10).map((m) => ({ role: m.role, text: m.text })),
        context,
      });

      const replyMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: 'model',
        text: res.reply,
      };
      setMessages((prev) => [...prev, replyMsg]);

      if (autoSpeak) {
        void speakText(replyMsg.id, res.reply);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Aristotle could not respond right now. Please try again.',
      );
    } finally {
      setSending(false);
    }
  }

  async function toggleMicrophone() {
    setError(null);
    if (recording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone capture is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 256) return;

        setTranscribing(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = String(reader.result ?? '');
              const comma = result.indexOf(',');
              resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.onerror = () => reject(new Error('Failed to read audio recording'));
            reader.readAsDataURL(blob);
          });

          const { transcript } = await api.aristotleTranscribe({
            audioBase64: base64,
            mimeType,
          });
          if (transcript.trim()) {
            await sendToAristotle(transcript, 'general');
          } else {
            setError('Could not hear clear speech. Please try speaking closer to the mic.');
          }
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Voice transcription failed');
        } finally {
          setTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError('Microphone permission was denied.');
    }
  }

  const contextSummary = [
    context.trackTitle,
    context.unitTitle,
    context.levelNumber ? `Step ${context.levelNumber}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3">
      {open && (
        <section
          aria-label="Aristotle Voice Assistant"
          className="w-[380px] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[76vh]"
        >
          {/* Header */}
          <div className="bg-slate-900 text-white px-4 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full overflow-hidden border border-amber-400/70 bg-slate-800 shrink-0 flex items-center justify-center">
                {!emblemFailed ? (
                  <img
                    src={ARISTOTLE_EMBLEM_SRC}
                    alt="Aristotle emblem"
                    referrerPolicy="no-referrer"
                    onError={() => setEmblemFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Compass className="w-5 h-5 text-amber-400" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-sm font-bold tracking-tight text-white truncate">
                  Aristotle
                </h2>
                <p className="text-[11px] text-slate-300 truncate">
                  {speakingId ? 'Speaking...' : recording ? 'Listening...' : 'Voice & Study Mentor'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const next = !autoSpeak;
                  setAutoSpeak(next);
                  if (!next) stopAudio();
                }}
                title={autoSpeak ? 'Mute auto-speak' : 'Enable voice replies'}
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                {autoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  stopAudio();
                  setOpen(false);
                }}
                aria-label="Close Aristotle Assistant"
                className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Live Context Ribbon */}
          {contextSummary && (
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 truncate">
              Viewing: <span className="font-medium text-slate-900">{contextSummary}</span>
            </div>
          )}

          {/* Helper Modes */}
          <div className="px-3.5 py-2.5 border-b border-slate-100 bg-white flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                void sendToAristotle(
                  context.questionPrompt
                    ? 'Give me a Socratic hint for this exact question without revealing the answer.'
                    : 'Give me a quick study tip for my current unit.',
                  'hint',
                )
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
              Hint
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                void sendToAristotle(
                  context.questionPrompt
                    ? 'Explain the core programming concept behind the question on screen.'
                    : `Explain the core concepts in ${context.unitTitle ?? 'my current Python unit'}.`,
                  'explain',
                )
              }
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Explain Topic
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                void sendToAristotle(
                  context.codeSnippet
                    ? 'Walk me through the code snippet line by line.'
                    : 'Teach me a quick mental model for tracing loops and functions.',
                  'debug',
                )
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Terminal className="w-3.5 h-3.5 text-blue-600" />
              Trace Logic
            </button>
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                void sendToAristotle(
                  'Based on my XP, streak, and progress, what should I focus on next?',
                  'plan',
                )
              }
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Next Step
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/70">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  <p>{msg.text}</p>
                  {msg.role === 'model' && (
                    <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          speakingId === msg.id ? stopAudio() : void speakText(msg.id, msg.text)
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-blue-600 transition-colors"
                      >
                        <Volume2 className="w-3 h-3" />
                        {speakingId === msg.id ? 'Stop voice' : 'Listen'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {(sending || transcribing) && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{transcribing ? 'Transcribing your voice...' : 'Aristotle is thinking...'}</span>
              </div>
            )}

            {error && (
              <div className="p-2.5 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg">
                {error}
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendToAristotle(input, 'general');
            }}
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => void toggleMicrophone()}
              disabled={sending || transcribing}
              title={recording ? 'Stop recording' : 'Speak to Aristotle'}
              className={`p-2.5 rounded-lg transition-colors shrink-0 ${
                recording
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={recording ? 'Recording voice...' : 'Ask Aristotle anything...'}
              disabled={sending || recording}
              className="flex-1 min-w-0 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-600"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message to Aristotle"
              className="p-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-lg transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </section>
      )}

      {/* Floating Circular Ball on the Right */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? 'Minimize Aristotle Assistant' : 'Open Aristotle Voice Assistant'}
        className={`group relative w-14 h-14 rounded-full bg-slate-900 border-2 shadow-lg transition-transform duration-200 hover:scale-105 focus-visible:outline-2 focus-visible:outline-blue-600 flex items-center justify-center overflow-hidden ${
          recording
            ? 'border-red-500 ring-4 ring-red-500/20'
            : speakingId
              ? 'border-blue-400 ring-4 ring-blue-500/20'
              : 'border-amber-400/80'
        }`}
      >
        {!emblemFailed ? (
          <img
            src={ARISTOTLE_EMBLEM_SRC}
            alt="Aristotle voice mentor"
            referrerPolicy="no-referrer"
            onError={() => setEmblemFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Compass className="w-6 h-6 text-amber-400" />
        )}
      </button>
    </div>
  );
}
