import React from 'react';

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

export function PrivacyPolicyView({ onBack }: PrivacyPolicyViewProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-semibold text-[#4F46E5] dark:text-[#A5B4FC] hover:underline whitespace-nowrap"
        >
          Back to Codemania
        </button>
      </div>

      <article className="bg-white dark:bg-[#1A1D28] border border-[#D5DCE8] dark:border-[#363D57] rounded-2xl p-6 space-y-6">
        <header className="border-b border-[#D5DCE8] dark:border-[#363D57] pb-4">
          <h1 className="font-display text-2xl font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            Privacy Policy
          </h1>
          <p className="text-xs text-[#4B556B] dark:text-[#B4BCD0] mt-1 font-mono">
            Effective date: November 20, 2026
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            1. Information We Collect
          </h2>
          <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
            When you create a Codemania account, we collect your email address, password hash,
            selected timezone, optional display name, and age confirmation for commitment
            contracts. As you use the platform, we record lesson attempts, quiz answers, review
            queue intervals, streaks, and earned points.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            2. How We Use Your Data
          </h2>
          <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
            Your data is used to grade exercises, track unit progression, schedule spaced-repetition
            reviews, compute Zugzwang leaderboard rankings, and enforce any commitment contract
            you choose to activate. We do not sell personal information to advertisers or third
            parties.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            3. Payment & Billing Processing
          </h2>
          <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
            Simulated commitments do not process payments. When you create a live deposit or
            penalty commitment, payment method setup and charges are handled by Stripe. Codemania
            stores Stripe customer, setup intent, and payment intent identifiers along with webhook
            delivery logs for auditability, and never stores raw card numbers.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            4. Optional Voice & Study Assistant
          </h2>
          <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
            Microphone audio is recorded only when you press the microphone button inside the
            study assistant. Audio clips and question help requests are transmitted solely to
            generate transcriptions, spoken prompts, and study hints during your session.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            5. Session Storage, Security & Controls
          </h2>
          <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
            Authentication tokens and your light or dark theme preference are stored locally in
            your browser. Signing out revokes your active refresh token on the server. Display names
            submitted for public leaderboards pass automated moderation before appearing publicly.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-bold text-[#1D2433] dark:text-[#E8EBF4]">
            6. Contact
          </h2>
          <p className="text-sm text-[#4B556B] dark:text-[#B4BCD0] leading-relaxed">
            For account inquiries, data export requests, or deletion requests, contact your
            workspace administrator at support@codemania.dev.
          </p>
        </section>
      </article>
    </div>
  );
}
