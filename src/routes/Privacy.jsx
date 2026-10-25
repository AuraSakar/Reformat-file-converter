import { PageHeader } from '../components/PageHeader';

export default function Privacy() {
  return (
    <div className="max-w-[68ch]">
      <PageHeader
        title="Privacy"
        description="Reformat is a static web app. It does not send your files anywhere."
      />

      <div className="space-y-6 border-t border-line pt-5 text-[13px] leading-6 text-ink-2">
        <section>
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Files stay on your device</h2>
          <p>
            Files are processed on your device and are not uploaded. Conversion, PDF assembly,
            page rendering and ZIP creation all run in your browser. No file contents are sent to
            a server.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-semibold text-ink">No accounts or tracking</h2>
          <p>
            There are no accounts, cookies, analytics, trackers or third-party scripts. Fonts and
            code are served from this site; no CDN fonts or external assets are loaded.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Hosting logs</h2>
          <p>
            The site is hosted on Vercel. Like most hosts, Vercel may record standard request
            information such as IP address and user agent when the app&apos;s static files are
            loaded. Those requests contain no file contents, because files are never uploaded.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-semibold text-ink">What stays in memory</h2>
          <p>
            Selected files and generated results remain in this browser tab until you remove
            them, close the tab, or reload the page. Downloading a result saves it through your
            browser. Temporary download URLs are revoked after use.
          </p>
        </section>

        <section>
          <h2 className="mb-1 text-[15px] font-semibold text-ink">Metadata</h2>
          <p>
            Converted images are re-encoded, which removes EXIF and other metadata. In Images to
            PDF, Original quality embeds JPG and PNG data directly, so metadata already in those
            files can remain; Balanced and Small rebuild each page as a new JPEG, which removes it.
            Merge PDF and Split PDF copy the selected pages, so data inside those pages is kept.
            Compress PDF keeps selectable text by default, replaces page images only when a smaller
            JPEG can be made, and strips document metadata and unused objects. Maximum compression
            rebuilds every page as a new JPEG, so original text structure and metadata are not
            copied into the result.
          </p>
        </section>
      </div>
    </div>
  );
}
