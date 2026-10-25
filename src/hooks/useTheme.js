import { useCallback, useEffect, useState } from 'react';

const THEME_KEY = 'reformat-theme';

function systemTheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function storedTheme() {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function currentTheme() {
  const value = document.documentElement.getAttribute('data-theme');
  if (value === 'light' || value === 'dark') return value;
  return storedTheme() ?? systemTheme();
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#111214' : '#FAF9F6');
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onStorage = (event) => {
      if (event.key !== THEME_KEY) return;
      if (event.newValue === 'light' || event.newValue === 'dark') {
        setTheme(event.newValue);
      } else {
        setTheme(systemTheme());
      }
    };
    const onSystemChange = () => {
      if (!storedTheme()) setTheme(systemTheme());
    };

    window.addEventListener('storage', onStorage);
    media?.addEventListener?.('change', onSystemChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      media?.removeEventListener?.('change', onSystemChange);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      return;
    }
  }, [theme]);

  return { theme, toggle };
}
