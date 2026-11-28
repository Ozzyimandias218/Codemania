import React from 'react';
import { useTheme } from '../lib/theme.ts';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="inline-flex items-center gap-1 p-1 bg-[#EEF1F7] dark:bg-[#222638] border border-[#D5DCE8] dark:border-[#363D57] rounded-lg"
    >
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
          theme === 'light'
            ? 'bg-white text-[#1D2433]'
            : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
        }`}
      >
        Light
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
          theme === 'dark'
            ? 'bg-[#1A1D28] text-[#E8EBF4]'
            : 'text-[#4B556B] dark:text-[#B4BCD0] hover:text-[#1D2433] dark:hover:text-[#E8EBF4]'
        }`}
      >
        Dark
      </button>
    </div>
  );
}
