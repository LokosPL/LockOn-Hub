# Browser module

Moduł jest aktywny. Interfejs znajduje się w `src/pages/BrowserPage.tsx`, a natywny `WebContentsView` Electron w `electron/browser.ts`.

Renderer przesyła do procesu głównego tylko położenie obszaru przeglądarki i komendy nawigacji. Zewnętrzne strony nie dostają `nodeIntegration` i działają z `sandbox: true`.
