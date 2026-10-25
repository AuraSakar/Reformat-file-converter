import { Moon, Sun } from 'lucide-react';
import { IconButton } from './Button';
import { useTheme } from '../hooks/useTheme';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';

  return (
    <IconButton
      label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={dark}
      onClick={toggle}
    >
      {dark ? (
        <Sun size={17} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Moon size={17} strokeWidth={1.5} aria-hidden="true" />
      )}
    </IconButton>
  );
}
