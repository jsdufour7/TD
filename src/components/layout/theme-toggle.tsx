'use client';

import { Moon, Sun } from 'lucide-react';
import { IconButton } from '@/components/ui/primitives';
import { useStoredString } from '@/lib/use-stored';

const COOKIE = 'ai_core_theme';

/**
 * Dark ⇄ Light.
 *
 * The preference lives in a cookie so the server renders the right class on the
 * first paint (no flash), and in the DOM class for the tokens in globals.css.
 */
export function ThemeToggle({ initial = 'dark' }: { initial?: 'dark' | 'light' }) {
  // localStorage drives the current choice; the cookie is what the server reads
  // on the next navigation so the page never repaints in the wrong theme.
  const [theme, setTheme] = useStoredString('ai-core.theme', initial);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('theme-light', next === 'light');
    document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <IconButton
      label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
      onClick={toggle}
      variant="ghost"
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}
