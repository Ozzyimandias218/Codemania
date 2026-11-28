import React, { useState } from 'react';
import { ApiError, AuthUser, StoredSession, api } from '../lib/api.ts';

interface AuthGateProps {
  onAuthenticated: (session: StoredSession) => void;
  onOpenPrivacy: () => void;
}

const PREVIEW_STEPS = [
  { step: '01', title: 'Variables & Types', kind: 'Lesson', status: 'done' as const },
  { step: '02', title: 'Expressions & Operators', kind: 'Lesson', status: 'done' as const },
  { step: '03', title: 'Conditionals & Branching', kind: 'Lesson', status: 'active' as const },
  { step: '04', title: 'Loops & Iteration', kind: 'Lesson', status: 'locked' as const },
  { step: '05', title: 'Unit Foundations Quiz', kind: 'Sum-Up Quiz', status: 'milestone' as const },
];

export function AuthGate({ onAuthenticated, onOpenPrivacy }: AuthGateProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('learner@codemania.dev');
  const [password, setPassword] = useState('CodemaniaUser123!');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [isAdult, setIsAdult] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login({ email, password })
          : await api.register({
              email,
              password,
              name: name.trim() || undefined,
              timezone,
              isAdult,
            });
      onAuthenticated({
        user: res.user as AuthUser,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12 items-stretch">
      <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
        <div className="space-y-4">
          <h1
            className="font-display text-4xl font-bold tracking-tight text-[#1D2433] dark:text-[#E8EBF4] leading-tight"
            style={{ textWrap: 'balance' }}
          >
            Learn Python step by step with sum-up quizzes and spaced review.
          </h1>
          <p className="text-base text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed max-w-xl">
            Work through one unit at a time, check recall with a sum-up quiz every fifth step,
            revisit missed questions on a scheduled review queue, and keep daily study habits.
          </p>
        </div>

        <div className="rounded-2xl border border-[#D5DCE8] dark:border-[#363D57] bg-white dark:bg-[#1A1D28] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#D5DCE8] dark:border-[#363D57] pb-3">
            <span className="font-display text-sm font-bold text-[#1D2433] dark:text-[#E8EBF4]">
              Unit 1 Preview: Foundations
            </span>
            <span className="text-xs font-mono text-[#4B556B] dark:text-[#B4BCD0]">
              Python Track
            </span>
          </div>

          <div className="divide-y divide-[#D5DCE8] dark:divide-[#363D57]">
            {PREVIEW_STEPS.map((item) => (
              <div
                key={item.step}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0 text-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono text-[11px] font-semibold shrink-0 ${
                      item.status === 'done'
                        ? 'bg-[#15803D] dark:bg-[#4ADE80] text-white dark:text-[#0B1F13]'
                        : item.status === 'active'
                          ? 'bg-[#4F46E5] text-white'
                          : item.status === 'milestone'
                            ? 'bg-[#F59E0B] text-[#1D2433]'
                            : 'bg-[#EEF1F7] dark:bg-[#222638] text-[#4B556B] dark:text-[#B4BCD0]'
                    }`}
                  >
                    {item.step}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1D2433] dark:text-[#E8EBF4] truncate">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">
                      {item.kind}
                    </div>
                  </div>
                </div>
                <span
                  className={`font-mono text-[11px] font-semibold shrink-0 ${
                    item.status === 'done'
                      ? 'text-[#15803D] dark:text-[#4ADE80]'
                      : item.status === 'active'
                        ? 'text-[#4F46E5] dark:text-[#A5B4FC]'
                        : item.status === 'milestone'
                          ? 'text-[#B45309] dark:text-[#F59E0B]'
                          : 'text-[#4B556B] dark:text-[#B4BCD0]'
                  }`}
                >
                  {item.status === 'done'
                    ? 'Done'
                    : item.status === 'active'
                      ? 'Current'
                      : item.status === 'milestone'
                        ? 'Quiz'
                        : 'Locked'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        id="auth-card"
        className="lg:col-span-5 bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6 flex flex-col justify-between"
      >
        <div>
          <div className="flex items-center gap-1 p-1 bg-[#EEF1F7] dark:bg-[#222638] rounded-lg mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white dark:bg-[#1A1D28] text-[#1D2433] dark:text-[#E8EBF4]'
                  : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-white dark:bg-[#1A1D28] text-[#1D2433] dark:text-[#E8EBF4]'
                  : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada Lovelace"
                  className="w-full px-3 py-2 text-sm bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
                Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
              />
            </div>

            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] mb-1">
                    Timezone
                  </label>
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F6F7FB] dark:bg-[#12141C] text-[#1D2433] dark:text-[#E8EBF4] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                  />
                </div>

                <label className="flex items-start gap-2.5 text-xs text-[#4B556B] dark:text-[#B4BCD0] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={isAdult}
                    onChange={(e) => setIsAdult(e.target.checked)}
                    className="mt-0.5 rounded border-[#D5DCE8] dark:border-[#363D57] accent-[#4F46E5]"
                  />
                  <span>I confirm I am 18+ (required to create commitment contracts).</span>
                </label>

                <p className="text-[11px] text-[#4B556B] dark:text-[#B4BCD0]">
                  By creating an account, you agree to our{' '}
                  <button
                    type="button"
                    onClick={onOpenPrivacy}
                    className="text-[#4F46E5] dark:text-[#A5B4FC] hover:underline font-medium"
                  >
                    Privacy Policy
                  </button>
                  .
                </p>
              </>
            )}

            {error && (
              <div className="p-3 text-xs font-medium text-[#DC2626] dark:text-[#F87171] bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] disabled:bg-[#9CA3AF] dark:disabled:bg-[#374151] rounded-lg transition-colors whitespace-nowrap"
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>

        {mode === 'login' && (
          <div className="mt-6 pt-4 border-t border-[#D5DCE8] dark:border-[#363D57]">
            <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] mb-2">
              Demo account presets:
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEmail('learner@codemania.dev');
                  setPassword('CodemaniaUser123!');
                }}
                className="flex-1 py-1.5 px-3 text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-md transition-colors whitespace-nowrap"
              >
                Demo Learner
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail('admin@codemania.dev');
                  setPassword('CodemaniaAdmin123!');
                }}
                className="flex-1 py-1.5 px-3 text-xs font-medium text-[#1D2433] dark:text-[#E8EBF4] bg-[#EEF1F7] dark:bg-[#222638] hover:bg-[#E2E7F2] dark:hover:bg-[#2E344D] rounded-md transition-colors whitespace-nowrap"
              >
                Demo Admin
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
