import React, { useEffect, useRef, useState } from 'react';
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

export function AristotleOrb({ context, quickRequest }: AristotleOrbProps) {
  const [open, setOpen] = useState(false);
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
      text: 'Ask for a hint without revealing the answer, trace a code snippet, or use the mic to record a spoken question.',
    },
  ]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const lastQuickIdRef = useRef<number | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView();
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
          aria-label="Aristotle Study Assistant"
          className="w-[380px] max-w-[calc(100vw-2rem)] bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl shadow-lg overflow-hidden flex flex-col max-h-[76vh]"
        >
          <div className="bg-[#1D2433] dark:bg-[#12141C] border-b border-[#363D57] text-[#E8EBF4] px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-sm font-bold tracking-tight text-[#E8EBF4] truncate">
                Aristotle
              </h2>
              <p className="text-[11px] text-[#B4BCD0] truncate">
                {speakingId ? 'Speaking...' : recording ? 'Listening...' : 'Voice & Study Helper'}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const next = !autoSpeak;
                  setAutoSpeak(next);
                  if (!next) stopAudio();
                }}
                className="px-2 py-1 rounded-md text-[11px] font-medium text-[#E8EBF4] bg-[#2C344A] hover:bg-[#3A435E] transition-colors whitespace-nowrap"
              >
                {autoSpeak ? 'Voice On' : 'Muted'}
              </button>
              <button
                type="button"
                onClick={() => {
                  stopAudio();
                  setOpen(false);
                }}
                aria-label="Close Aristotle Assistant"
                className="px-2 py-1 rounded-md text-[11px] font-medium text-[#E8EBF4] bg-[#2C344A] hover:bg-[#3A435E] transition-colors whitespace-nowrap"
              >
                Close
              </button>
            </div>
          </div>

          {contextSummary && (
            <div className="px-4 py-2 bg-[#EEF1F7] dark:bg-[#222638] border-b border-[#D5DCE8] dark:border-[#363D57] text-[11px] text-[#4B556B] dark:text-[#B4BCD0] truncate">
              Viewing:{' '}
              <span className="font-medium text-[#1D2433] dark:text-[#E8EBF4]">
                {contextSummary}
              </span>
            </div>
          )}

          <div className="px-3.5 py-2.5 border-b border-[#D5DCE8] dark:border-[#363D57] bg-white dark:bg-[#1A1D28] flex flex-wrap gap-1.5">
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
              className="px-2.5 py-1.5 text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
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
              className="px-2.5 py-1.5 text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg transition-colors whitespace-nowrap shrink-0"
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
              className="px-2.5 py-1.5 text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
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
              className="px-2.5 py-1.5 text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Next Step
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[#F6F7FB] dark:bg-[#12141C]">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-[#7C3AED] text-white'
                      : 'bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] text-[#1D2433] dark:text-[#E8EBF4]'
                  }`}
                >
                  <p>{msg.text}</p>
                  {msg.role === 'model' && (
                    <div className="mt-2 pt-1.5 border-t border-[#D5DCE8] dark:border-[#363D57] flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          speakingId === msg.id ? stopAudio() : void speakText(msg.id, msg.text)
                        }
                        className="text-[11px] font-semibold text-[#7C3AED] dark:text-[#C4B5FD] hover:underline"
                      >
                        {speakingId === msg.id ? 'Stop voice' : 'Listen'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {(sending || transcribing) && (
              <div className="text-xs font-medium text-[#4B556B] dark:text-[#B4BCD0]">
                {transcribing ? 'Transcribing audio...' : 'Thinking...'}
              </div>
            )}

            {error && (
              <div className="p-2.5 text-xs font-medium text-[#C2410C] dark:text-[#FB923C] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
                {error}
              </div>
            )}
            <div ref={scrollEndRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendToAristotle(input, 'general');
            }}
            className="p-3 bg-white dark:bg-[#1A1D28] border-t border-[#D5DCE8] dark:border-[#363D57] flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => void toggleMicrophone()}
              disabled={sending || transcribing}
              className={`px-2.5 py-2 text-xs font-semibold rounded-lg transition-colors shrink-0 whitespace-nowrap ${
                recording
                  ? 'bg-[#DC2626] text-white hover:bg-[#B91C1C]'
                  : 'bg-[#EEF1F7] dark:bg-[#222638] text-[#1D2433] dark:text-[#E8EBF4] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D]'
              }`}
            >
              {recording ? 'Stop' : 'Mic'}
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={recording ? 'Recording voice...' : 'Ask a question...'}
              disabled={sending || recording}
              className="flex-1 min-w-0 px-3 py-2 text-xs bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#7C3AED]"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="px-3 py-2 text-xs font-semibold bg-[#7C3AED] hover:bg-[#6D28D9] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] text-white rounded-lg transition-colors shrink-0 whitespace-nowrap"
            >
              Send
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? 'Minimize Aristotle Assistant' : 'Open Aristotle Assistant'}
        className={`px-4 py-3 rounded-2xl text-xs font-semibold text-white shadow-lg transition-colors whitespace-nowrap ${
          recording
            ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
            : 'bg-[#7C3AED] hover:bg-[#6D28D9]'
        }`}
      >
        {open ? 'Hide Helper' : 'Aristotle'}
      </button>
    </div>
  );
}
