/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
import { AdminView } from './components/AdminView.tsx';
import {
  AristotleLiveContext,
  AristotleOrb,
  AristotleQuickRequest,
} from './components/AristotleOrb.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { CommitmentsView } from './components/CommitmentsView.tsx';
import { DailyQuizView } from './components/DailyQuizView.tsx';
import { LearnWorkspace } from './components/LearnWorkspace.tsx';
import { ReviewQueueView } from './components/ReviewQueueView.tsx';
import { StoredSession, UserStats, api, loadSession, saveSession } from './lib/api.ts';

type NavTab = 'learn' | 'daily' | 'review' | 'commitments' | 'admin';

export default function App() {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [activeTab, setActiveTab] = useState<NavTab>('learn');
  const [stats, setStats] = useState<UserStats | null>(null);
  const [learnContext, setLearnContext] = useState<Partial<AristotleLiveContext>>({});
  const [quickRequest, setQuickRequest] = useState<AristotleQuickRequest | null>(null);

  async function refreshStats() {
    if (!loadSession()) return;
    try {
      const s = await api.getMyStats();
      setStats(s);
    } catch {
      // Handled by api refresh / auth state
    }
  }

  useEffect(() => {
    if (session) {
      void refreshStats();
    } else {
      setStats(null);
    }
  }, [session?.user.id]);

  function handleAuthenticated(nextSession: StoredSession) {
    saveSession(nextSession);
    setSession(nextSession);
    setActiveTab('learn');
  }

  async function handleSignOut() {
    const current = loadSession();
    if (current?.refreshToken) {
      await api.logout(current.refreshToken).catch(() => {});
    }
    saveSession(null);
    setSession(null);
  }

  const assistantContext: AristotleLiveContext = {
    activeTab,
    ...(activeTab === 'learn' ? learnContext : {}),
    stats: stats
      ? {
          xp: stats.xp,
          currentStreak: stats.currentStreak,
          totalPoints: stats.totalPoints,
          passedLevelsCount: stats.passedLevelsCount,
        }
      : undefined,
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-slate-900">
      {/* 3-Zone Top Bar Contract */}
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('learn');
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Codemania
          </a>

          {session ? (
            <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
              <button
                type="button"
                onClick={() => setActiveTab('learn')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeTab === 'learn'
                    ? 'border-blue-600 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                Learn
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('daily')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeTab === 'daily'
                    ? 'border-blue-600 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                Daily Quiz
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('review')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeTab === 'review'
                    ? 'border-blue-600 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                Review
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('commitments')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  activeTab === 'commitments'
                    ? 'border-blue-600 text-slate-900'
                    : 'border-transparent hover:text-slate-900'
                }`}
              >
                Commitments
              </button>
              {session.user.role === 'ADMIN' && (
                <button
                  type="button"
                  onClick={() => setActiveTab('admin')}
                  className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                    activeTab === 'admin'
                      ? 'border-blue-600 text-slate-900'
                      : 'border-transparent hover:text-slate-900'
                  }`}
                >
                  Admin
                </button>
              )}
            </nav>
          ) : (
            <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
              <a href="#auth-card" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
                Tracks
              </a>
              <a href="#auth-card" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
                Daily Quiz
              </a>
              <a href="#auth-card" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
                Review
              </a>
              <a href="#auth-card" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
                Commitments
              </a>
            </nav>
          )}

          <div className="shrink-0">
            {session ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Sign Out
              </button>
            ) : (
              <a
                href="#auth-card"
                className="inline-block px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Get Started
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {!session ? (
          <AuthGate onAuthenticated={handleAuthenticated} />
        ) : activeTab === 'learn' ? (
          <LearnWorkspace
            stats={stats}
            onStatsChanged={() => void refreshStats()}
            onContextChange={(ctx) => setLearnContext(ctx)}
            onAskAristotle={(prompt, mode) =>
              setQuickRequest({ id: Date.now(), prompt, mode })
            }
          />
        ) : activeTab === 'daily' ? (
          <DailyQuizView />
        ) : activeTab === 'review' ? (
          <ReviewQueueView />
        ) : activeTab === 'commitments' ? (
          <CommitmentsView />
        ) : (
          <AdminView />
        )}
      </main>

      {session && (
        <AristotleOrb context={assistantContext} quickRequest={quickRequest} />
      )}
    </div>
  );
}
