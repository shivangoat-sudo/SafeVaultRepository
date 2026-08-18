import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('theme');
      if (stored === 'dark' || stored === 'light') return stored;
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));

  return { theme, toggleTheme };
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="btn-ghost px-2.5 transition-colors focus:outline-none"
      title={theme === 'dark' ? 'Schakel naar Lichte modus' : 'Schakel naar Donkere modus'}
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 text-amber-400 hover:text-amber-300 transition-colors" />
      ) : (
        <Moon className="h-5 w-5 text-ink-600 hover:text-ink-900 transition-colors" />
      )}
    </button>
  );
}
