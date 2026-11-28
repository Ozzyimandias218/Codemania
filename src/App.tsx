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
import { ZugzwangView } from './components/ZugzwangView.tsx';
import { LearnWorkspace } from './components/LearnWorkspace.tsx';
import { PrivacyPolicyView } from './components/PrivacyPolicyView.tsx';
import { ReviewQueueView } from './components/ReviewQueueView.tsx';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { StoredSession, UserStats, api, loadSession, saveSession } from './lib/api.ts';
import { useTheme } from './lib/theme.ts';

type NavTab = 'learn' | 'zugzwang' | 'review' | 'commitments' | 'admin';

export default function App() {
  useTheme();
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [activeTab, setActiveTab] = useState<NavTab>('learn');
  const [showPrivacy, setShowPrivacy] = useState(false);
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
    setShowPrivacy(false);
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

  function navigateTab(tab: NavTab) {
    setShowPrivacy(false);
    setActiveTab(tab);
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
    <div className="min-h-screen flex flex-col bg-[#F6F7FB] text-[#1D2433] dark:bg-[#12141C] dark:text-[#E8EBF4]">
      <header className="bg-white dark:bg-[#1A1D28] border-b border-[#D5DCE8] dark:border-[#363D57]">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              navigateTab('learn');
            }}
            className="font-display text-lg font-bold tracking-tight text-[#4F46E5] dark:text-[#A5B4FC] whitespace-nowrap shrink-0"
          >
            Codemania
          </a>

          {session ? (
            <nav className="flex items-center gap-6 text-sm font-medium text-[#4B556B] dark:text-[#B4BCD0]">
              <button
                type="button"
                onClick={() => navigateTab('learn')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  !showPrivacy && activeTab === 'learn'
                    ? 'border-[#4F46E5] text-[#1D2433] dark:text-[#E8EBF4]'
                    : 'border-transparent hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                }`}
              >
                Learn
              </button>
              <button
                type="button"
                onClick={() => navigateTab('zugzwang')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  !showPrivacy && activeTab === 'zugzwang'
                    ? 'border-[#7C3AED] text-[#1D2433] dark:text-[#E8EBF4]'
                    : 'border-transparent hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                }`}
              >
                Zugzwang
              </button>
              <button
                type="button"
                onClick={() => navigateTab('review')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  !showPrivacy && activeTab === 'review'
                    ? 'border-[#4F46E5] text-[#1D2433] dark:text-[#E8EBF4]'
                    : 'border-transparent hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                }`}
              >
                Review
              </button>
              <button
                type="button"
                onClick={() => navigateTab('commitments')}
                className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                  !showPrivacy && activeTab === 'commitments'
                    ? 'border-[#4F46E5] text-[#1D2433] dark:text-[#E8EBF4]'
                    : 'border-transparent hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                }`}
              >
                Commitments
              </button>
              {session.user.role === 'ADMIN' && (
                <button
                  type="button"
                  onClick={() => navigateTab('admin')}
                  className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
                    !showPrivacy && activeTab === 'admin'
                      ? 'border-[#4F46E5] text-[#1D2433] dark:text-[#E8EBF4]'
                      : 'border-transparent hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
                  }`}
                >
                  Admin
                </button>
              )}
            </nav>
          ) : (
            <nav className="flex items-center gap-6 text-sm font-medium text-[#4B556B] dark:text-[#B4BCD0]">
              <a
                href="#auth-card"
                onClick={() => setShowPrivacy(false)}
                className="hover:text-[#1D2433] dark:hover:text-[#E8EBF4] transition-colors whitespace-nowrap shrink-0"
              >
                Tracks
              </a>
              <a
                href="#auth-card"
                onClick={() => setShowPrivacy(false)}
                className="hover:text-[#1D2433] dark:hover:text-[#E8EBF4] transition-colors whitespace-nowrap shrink-0"
              >
                Zugzwang
              </a>
              <a
                href="#auth-card"
                onClick={() => setShowPrivacy(false)}
                className="hover:text-[#1D2433] dark:hover:text-[#E8EBF4] transition-colors whitespace-nowrap shrink-0"
              >
                Review
              </a>
              <a
                href="#auth-card"
                onClick={() => setShowPrivacy(false)}
                className="hover:text-[#1D2433] dark:hover:text-[#E8EBF4] transition-colors whitespace-nowrap shrink-0"
              >
                Commitments
              </a>
            </nav>
          )}

          <div className="shrink-0">
            {session ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#1D2433] hover:bg-[#2E384E] dark:bg-[#222638] dark:hover:bg-[#2E344D] dark:border dark:border-[#363D57] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Sign Out
              </button>
            ) : (
              <a
                href="#auth-card"
                onClick={() => setShowPrivacy(false)}
                className="inline-block px-4 py-2 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                Get Started
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {showPrivacy ? (
          <PrivacyPolicyView onBack={() => setShowPrivacy(false)} />
        ) : !session ? (
          <AuthGate
            onAuthenticated={handleAuthenticated}
            onOpenPrivacy={() => setShowPrivacy(true)}
          />
        ) : activeTab === 'learn' ? (
          <LearnWorkspace
            stats={stats}
            onStatsChanged={() => void refreshStats()}
            onNavigateToReview={() => navigateTab('review')}
            onContextChange={(ctx) => setLearnContext(ctx)}
            onAskAristotle={(prompt, mode) =>
              setQuickRequest({ id: Date.now(), prompt, mode })
            }
          />
        ) : activeTab === 'zugzwang' ? (
          <ZugzwangView />
        ) : activeTab === 'review' ? (
          <ReviewQueueView />
        ) : activeTab === 'commitments' ? (
          <CommitmentsView />
        ) : (
          <AdminView />
        )}
      </main>

      <footer className="border-t border-[#D5DCE8] dark:border-[#363D57] bg-white dark:bg-[#1A1D28]">
        <div className="mx-auto max-w-6xl px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-[#4B556B] dark:text-[#B4BCD0]">
          <div className="flex items-center gap-4">
            <span>Codemania</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setShowPrivacy(true)}
              className="hover:text-[#1D2433] dark:hover:text-[#E8EBF4] underline-offset-4 hover:underline transition-colors whitespace-nowrap"
            >
              Privacy Policy
            </button>
          </div>
          <ThemeToggle />
        </div>
      </footer>

      {session && !showPrivacy && (
        <AristotleOrb context={assistantContext} quickRequest={quickRequest} />
      )}
    </div>
  );
}
