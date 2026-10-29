const CACHE_NAME = 'budget-app-v1';
const ASSETS_TO_CACHE = [
  'index.html',
  'manifest.json',
  'css/variables.css',
  'css/styles.css',
  'css/components/header.css',
  'css/components/sidebar.css',
  'css/components/dashboard.css',
  'css/components/transactions.css',
  'css/components/categories.css',
  'css/components/reports.css',
  'css/components/settings.css',
  'css/components/colorPicker.css',
  'css/components/debts.css',
  'js/app.js',
  'js/modules/dashboard.js',
  'js/modules/transactions.js',
  'js/modules/categories.js',
  'js/modules/reports.js',
  'js/modules/settings.js',
  'js/modules/debts.js',
  'js/config/routes.js',
  'js/config/constants.js',
  'js/data/storage.js',
  'js/components/modal.js',
  'js/components/toast.js',
  'js/components/chart.js',
  'js/components/colorPicker.js',
  'js/utils/dateHelpers.js',
  'templates/dashboard.html',
  'templates/transactions.html',
  'templates/categories.html',
  'templates/reports.html',
  'templates/settings.html',
  'templates/debts.html',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Кэширование файлов');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Удаление старого кэша');
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        if (
          !response ||
          response.status !== 200 ||
          response.type !== 'basic' ||
          event.request.url.includes('data:')
        ) {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      });
    })
  );
});