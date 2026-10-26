import { Link } from 'react-router-dom';
import { CREATOR_LINKS } from '../lib/links';
import { GitHubIcon } from './icons/GitHubIcon';
import { InstagramIcon } from './icons/InstagramIcon';
import { LinkedInIcon } from './icons/LinkedInIcon';
import { WhatsAppIcon } from './icons/WhatsAppIcon';

const ICONS = {
  github: GitHubIcon,
  linkedin: LinkedInIcon,
  whatsapp: WhatsAppIcon,
  instagram: InstagramIcon,
};

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[880px] flex-col items-center gap-5 px-4 py-6 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 sm:text-left">
        <p className="text-[13px] text-ink-2">
          Designed and built by{' '}
          <span className="font-serif text-[17px] leading-none text-ink">AuraSakar</span>
        </p>
        <nav aria-label="Creator links" className="flex shrink-0 flex-nowrap items-center gap-2">
          {CREATOR_LINKS.map((link) => {
            const Icon = ICONS[link.id];
            return (
              <a
                key={link.id}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.label}
                title={link.label}
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-[6px] border border-line text-ink-2 transition-colors duration-150 hover:text-ink focus-visible:text-ink"
              >
                <Icon />
              </a>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[880px] flex-col items-center gap-1 px-4 py-3 text-center text-[12px] text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:text-left">
          <p>Files are processed on your device and are not uploaded.</p>
          <Link
            to="/privacy"
            className="inline-flex min-h-10 w-fit items-center underline underline-offset-2 hover:text-ink focus-visible:text-ink sm:min-h-0"
          >
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
