import { Suspense, lazy, useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from './components/Toasts';
import { useOnline } from './hooks/useOnline';

const ImageConverter = lazy(() => import('./routes/ImageConverter'));
const ImagesToPdf = lazy(() => import('./routes/ImagesToPdf'));
const MergePdf = lazy(() => import('./routes/MergePdf'));
const SplitPdf = lazy(() => import('./routes/SplitPdf'));
const PdfToImages = lazy(() => import('./routes/PdfToImages'));
const CompressPdf = lazy(() => import('./routes/CompressPdf'));
const Privacy = lazy(() => import('./routes/Privacy'));

const TOOLS = [
  { to: '/', label: 'Images', end: true },
  { to: '/images-to-pdf', label: 'Images to PDF' },
  { to: '/merge-pdf', label: 'Merge PDF' },
  { to: '/split-pdf', label: 'Split PDF' },
  { to: '/pdf-to-images', label: 'PDF to images' },
  { to: '/compress-pdf', label: 'Compress PDF' },
];

function RouteFallback() {
  return (
    <div className="mx-auto max-w-[1120px] px-4 py-10 sm:px-6">
      <p className="text-[13px] text-ink-2" role="status">
        Loading tool…
      </p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-[1120px] px-4 py-10 sm:px-6">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-[13px] text-ink-2">
        That address does not match a tool.{' '}
        <Link className="inline-flex min-h-10 items-center underline sm:min-h-0" to="/">
          Open the image converter
        </Link>
        .
      </p>
    </div>
  );
}

function Shell() {
  const online = useOnline();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[4px] focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:text-white"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-bg">
        <div className="mx-auto flex max-w-[1120px] flex-col px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link
            to="/"
            className="flex h-11 shrink-0 items-center text-[15px] font-semibold tracking-[-0.01em] text-ink sm:h-12 sm:pr-6"
          >
            Reformat
          </Link>
          <div className="no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <nav aria-label="Tools" className="flex gap-5 sm:gap-6">
              {TOOLS.map((tool) => (
                <NavLink
                  key={tool.to}
                  to={tool.to}
                  end={tool.end}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center whitespace-nowrap border-b-2 text-[13px] transition-colors duration-150 sm:min-h-12 ${
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
        </div>
      </header>

      {!online ? (
        <div className="border-b border-line bg-[#fbf6e9]">
          <p className="mx-auto max-w-[1120px] px-4 py-2 text-[12px] text-warn sm:px-6" role="status">
            You are offline. Open tools keep working on this device. Reloading needs a connection.
          </p>
        </div>
      ) : null}

      <main id="main-content" className="mx-auto w-full max-w-[1120px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<ImageConverter />} />
            <Route path="/images-to-pdf" element={<ImagesToPdf />} />
            <Route path="/merge-pdf" element={<MergePdf />} />
            <Route path="/split-pdf" element={<SplitPdf />} />
            <Route path="/pdf-to-images" element={<PdfToImages />} />
            <Route path="/compress-pdf" element={<CompressPdf />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-1 px-4 py-4 text-[12px] text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-6">
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
