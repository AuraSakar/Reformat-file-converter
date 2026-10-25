import { Suspense, lazy, useEffect, useRef } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/Toasts';
import { useOnline } from './hooks/useOnline';

const ImageConverter = lazy(() => import('./routes/ImageConverter'));
const ImagesToPdf = lazy(() => import('./routes/ImagesToPdf'));
const TextToPdf = lazy(() => import('./routes/TextToPdf'));
const MergePdf = lazy(() => import('./routes/MergePdf'));
const SplitPdf = lazy(() => import('./routes/SplitPdf'));
const OrganizePdf = lazy(() => import('./routes/OrganizePdf'));
const PdfToImages = lazy(() => import('./routes/PdfToImages'));
const CompressPdf = lazy(() => import('./routes/CompressPdf'));
const Privacy = lazy(() => import('./routes/Privacy'));

const SECTIONS = [
  { to: '/images', label: 'Images' },
  { to: '/pdf', label: 'PDF' },
];

const PDF_TOOLS = [
  { to: '/pdf/images-to-pdf', label: 'Images to PDF' },
  { to: '/pdf/text-to-pdf', label: 'Text to PDF' },
  { to: '/pdf/merge', label: 'Merge' },
  { to: '/pdf/split', label: 'Split / Extract' },
  { to: '/pdf/organize', label: 'Organize pages' },
  { to: '/pdf/pdf-to-images', label: 'PDF to Images' },
  { to: '/pdf/compress', label: 'Compress' },
];

function RouteFallback() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <p className="text-[13px] text-ink-2" role="status">
        Loading tool…
      </p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-[13px] text-ink-2">
        That address does not match a tool.{' '}
        <Link className="inline-flex min-h-10 items-center underline sm:min-h-0" to="/images">
          Open the image converter
        </Link>
        .
      </p>
    </div>
  );
}

function PdfToolNav() {
  const location = useLocation();
  const navRef = useRef(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector('[aria-current="page"]');
    if (!active) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [location.pathname]);

  return (
    <div className="border-t border-line">
      <nav
        ref={navRef}
        aria-label="PDF tools"
        className="no-scrollbar mx-auto flex max-w-[880px] gap-5 overflow-x-auto px-4 sm:px-6"
      >
        {PDF_TOOLS.map((tool) => (
          <NavLink
            key={tool.to}
            to={tool.to}
            className={({ isActive }) =>
              `flex min-h-10 items-center whitespace-nowrap border-b-2 text-[12px] transition-colors duration-150 ${
                isActive
                  ? 'border-ink font-medium text-ink'
                  : 'border-transparent text-ink-2 hover:text-ink'
              }`
            }
          >
            {tool.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function Shell() {
  const online = useOnline();
  const location = useLocation();
  const pdfActive = location.pathname === '/pdf' || location.pathname.startsWith('/pdf/');

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[4px] focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:text-bg"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex max-w-[880px] items-center gap-4 px-4 sm:gap-7 sm:px-6">
          <div className="flex shrink-0 items-baseline gap-3">
            <Link
              to="/images"
              className="flex h-12 items-center font-serif text-[26px] font-normal leading-none tracking-[-0.01em] text-ink sm:h-14 sm:text-[30px]"
            >
              Reformat
            </Link>
            <span className="hidden text-[11px] leading-4 text-ink-2 sm:block">
              Convert images and PDFs on your device
            </span>
          </div>
          <nav aria-label="Sections" className="flex self-stretch gap-4 sm:gap-6">
            {SECTIONS.map((section) => (
              <NavLink
                key={section.to}
                to={section.to}
                className={({ isActive }) =>
                  `flex min-h-12 items-center border-b-2 text-[13px] transition-colors duration-150 sm:min-h-14 ${
                    isActive
                      ? 'border-ink font-medium text-ink'
                      : 'border-transparent text-ink-2 hover:text-ink'
                  }`
                }
              >
                {section.label}
              </NavLink>
            ))}
          </nav>
        </div>
        {pdfActive ? <PdfToolNav /> : null}
      </header>

      {!online ? (
        <div className="border-b border-line bg-surface">
          <p className="mx-auto max-w-[880px] px-4 py-2 text-[12px] text-warn sm:px-6" role="status">
            You are offline. Open tools keep working on this device. Reloading needs a connection.
          </p>
        </div>
      ) : null}

      <main id="main-content" className="mx-auto w-full max-w-[880px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/images" replace />} />
            <Route path="/images" element={<ImageConverter />} />
            <Route path="/pdf" element={<Navigate to="/pdf/images-to-pdf" replace />} />
            <Route path="/pdf/images-to-pdf" element={<ImagesToPdf />} />
            <Route path="/pdf/text-to-pdf" element={<TextToPdf />} />
            <Route path="/pdf/merge" element={<MergePdf />} />
            <Route path="/pdf/split" element={<SplitPdf />} />
            <Route path="/pdf/organize" element={<OrganizePdf />} />
            <Route path="/pdf/pdf-to-images" element={<PdfToImages />} />
            <Route path="/pdf/compress" element={<CompressPdf />} />
            <Route path="/images-to-pdf" element={<Navigate to="/pdf/images-to-pdf" replace />} />
            <Route path="/merge-pdf" element={<Navigate to="/pdf/merge" replace />} />
            <Route path="/split-pdf" element={<Navigate to="/pdf/split" replace />} />
            <Route path="/pdf-to-images" element={<Navigate to="/pdf/pdf-to-images" replace />} />
            <Route path="/compress-pdf" element={<Navigate to="/pdf/compress" replace />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[880px] flex-col gap-1 px-4 py-4 text-[12px] text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Files are processed on your device and are not uploaded.</p>
          <Link
            to="/privacy"
            className="inline-flex min-h-10 w-fit items-center underline underline-offset-2 hover:text-ink sm:min-h-0"
          >
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
