(function () {
  var key = 'reformat-theme';
  var theme = null;

  try {
    var stored = window.localStorage.getItem(key);
    if (stored === 'light' || stored === 'dark') theme = stored;
  } catch (error) {
    theme = null;
  }

  if (!theme) {
    theme =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  }

  document.documentElement.setAttribute('data-theme', theme);

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#111214' : '#FAF9F6');
})();
