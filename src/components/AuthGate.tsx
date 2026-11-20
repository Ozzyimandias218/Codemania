import React, { useState } from 'react';
import { ApiError, AuthUser, StoredSession, api } from '../lib/api.ts';

interface AuthGateProps {
  onAuthenticated: (session: StoredSession) => void;
}

export function AuthGate({ onAuthenticated }: AuthGateProps) {
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

  const [heroImgFailed, setHeroImgFailed] = useState(false);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="grid gap-10 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-7 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <p className="text-xs font-semibold text-blue-600">
              Structured Programming Mastery
            </p>
            <h1
              className="font-display text-4xl font-bold tracking-tight text-slate-900 leading-tight"
              style={{ textWrap: 'balance' }}
            >
              Follow the coding road, master fundamentals, and stay accountable.
            </h1>
            <p className="text-base text-slate-600 leading-relaxed max-w-xl">
              Progress unit by unit along interactive lesson paths, sum up every five steps with
              targeted quizzes, reinforce mistakes via spaced repetition, and practice daily with
              Aristotle.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden aspect-16/9">
            {!heroImgFailed ? (
              <img
                src="/src/assets/images/hero_course_roadmap_1795160958261.jpg"
                alt="Architectural winding programming course path"
                referrerPolicy="no-referrer"
                onError={() => setHeroImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-linear-to-br from-slate-100 to-blue-50 flex items-center justify-center text-sm font-medium text-slate-600">
                Interactive Course Road
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-6 pt-4 border-t border-slate-200">
            <div>
              <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">50</div>
              <div className="text-xs text-slate-500 mt-1">Steps per track</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">5</div>
              <div className="text-xs text-slate-500 mt-1">Lesson sum-up cadence</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">1·3·7d</div>
              <div className="text-xs text-slate-500 mt-1">Review intervals</div>
            </div>
          </div>
        </div>

        <div
          id="auth-card"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
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
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ada Lovelace"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Timezone
                    </label>
                    <input
                      type="text"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={isAdult}
                      onChange={(e) => setIsAdult(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>I confirm I am 18+ (required to create commitment contracts).</span>
                  </label>
                </>
              )}

              {error && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>
          </div>

          {mode === 'login' && (
            <div className="mt-6 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-2">Quick fill demo credentials:</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmail('learner@codemania.dev');
                    setPassword('CodemaniaUser123!');
                  }}
                  className="flex-1 py-1.5 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                >
                  Demo Learner
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmail('admin@codemania.dev');
                    setPassword('CodemaniaAdmin123!');
                  }}
                  className="flex-1 py-1.5 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
                >
                  Demo Admin
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
