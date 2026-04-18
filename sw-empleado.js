/**
 * SERVICE WORKER - PANEL DEL EMPLEADO
 * ====================================
 * Estrategia: Cache First con revalidación en segundo plano
 * Prioriza la experiencia offline para el empleado
 */

// Nombre de la caché - Incluye versión para facilitar actualizaciones
const CACHE_NAME = 'tienda-empleado-v3';

// Recursos a cachear durante la instalación
// Estos archivos estarán disponibles offline desde el primer momento
const STATIC_CACHE_URLS = [
  '/',                          // Página principal
  '/empleado/index.html',       // HTML principal
  '/empleado/style-empleado.css', // Estilos
  '/empleado/app-empleado.js',   // Lógica principal
  '/empleado/manifest.json',     // Configuración PWA
  '/empleado/icons/icon-72.png',
  '/empleado/icons/icon-96.png',
  '/empleado/icons/icon-128.png',
  '/empleado/icons/icon-144.png',
  '/empleado/icons/icon-152.png',
  '/empleado/icons/icon-192.png',
  '/empleado/icons/icon-384.png',
  '/empleado/icons/icon-512.png',
  '/empleado/config.json',       // Configuración inicial (opcional)
  'https://fonts.googleapis.com/css2?family=Segoe+UI', // Fuentes externas
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js' // Librerías
];

// URLs que deben ser siempre actualizadas (no cachear por mucho tiempo)
const DYNAMIC_URLS = [
  '/api/productos.json',        // Datos dinámicos de productos
  '/api/ventas',                // Endpoint de ventas
  '/empleado/productos.json'    // Archivo externo de productos
];

// Tiempo máximo de caché para datos dinámicos (24 horas en milisegundos)
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;

/**
 * EVENTO: INSTALL
 * Se ejecuta cuando el Service Worker se instala por primera vez
 * Ideal para cachear recursos estáticos
 */
self.addEventListener('install', (event) => {
  console.log('[SW Empleado] 📦 Instalando Service Worker...');
  
  // Esperar a que termine el cacheo antes de activar
  event.waitUntil(
    (async () => {
      try {
        // Abrir la caché
        const cache = await caches.open(CACHE_NAME);
        
        // Cachear recursos estáticos
        console.log('[SW Empleado] 💾 Cacheando recursos estáticos...');
        await cache.addAll(STATIC_CACHE_URLS);
        
        console.log('[SW Empleado] ✅ Recursos cacheados correctamente');
        
        // Forzar la activación inmediata del nuevo SW
        await self.skipWaiting();
        
      } catch (error) {
        console.error('[SW Empleado] ❌ Error durante el cacheo:', error);
        
        // Cachear individualmente los que fallaron (estrategia de recuperación)
        for (const url of STATIC_CACHE_URLS) {
          try {
            await cache.add(url);
            console.log(`[SW Empleado] ✓ Reintento exitoso: ${url}`);
          } catch (err) {
            console.warn(`[SW Empleado] ✗ No se pudo cachear: ${url}`);
          }
        }
      }
    })()
  );
});

/**
 * EVENTO: ACTIVATE
 * Se ejecuta después de install, cuando el SW está activo
 * Limpia cachés antiguas y toma control de las páginas
 */
self.addEventListener('activate', (event) => {
  console.log('[SW Empleado] 🚀 Activando Service Worker...');
  
  event.waitUntil(
    (async () => {
      // Obtener todas las claves de caché
      const cacheNames = await caches.keys();
      
      // Eliminar cachés antiguas (que no coincidan con la versión actual)
      const deletePromises = cacheNames.map((cacheName) => {
        if (cacheName !== CACHE_NAME) {
          console.log(`[SW Empleado] 🗑️ Eliminando caché antigua: ${cacheName}`);
          return caches.delete(cacheName);
        }
      });
      
      await Promise.all(deletePromises);
      
      // Tomar control inmediato de todos los clientes (páginas abiertas)
      await self.clients.claim();
      
      console.log('[SW Empleado] ✅ Service Worker activo y controlando la aplicación');
      
      // Notificar a la aplicación que el SW está listo
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'SW_ACTIVATED',
          version: CACHE_NAME,
          timestamp: new Date().toISOString()
        });
      });
    })()
  );
});

/**
 * EVENTO: FETCH
 * Intercepta todas las peticiones HTTP y decide cómo responder
 * Implementa diferentes estrategias según el tipo de recurso
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Estrategia 1: API y datos dinámicos (Network First con fallback a caché)
  if (DYNAMIC_URLS.some(dynamicUrl => request.url.includes(dynamicUrl))) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // Estrategia 2: Archivos JSON de productos (Cache First con revalidación)
  if (request.url.includes('productos.json')) {
    event.respondWith(cacheFirstWithRevalidation(request));
    return;
  }
  
  // Estrategia 3: Imágenes y assets (Cache First)
  if (request.destination === 'image' || request.url.match(/\.(png|jpg|jpeg|gif|svg|ico)$/)) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }
  
  // Estrategia 4: HTML y navegación (Cache First con fallback offline)
  if (request.destination === 'document' || request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request));
    return;
  }
  
  // Estrategia 5: Por defecto (Cache First, luego red)
  event.respondWith(cacheFirstStrategy(request));
});

/**
 * ESTRATEGIA: Network First (con fallback a caché)
 * Prioriza la red, si falla usa la caché
 * Útil para datos que cambian frecuentemente
 */
async function networkFirstStrategy(request) {
  try {
    // Intentar obtener de la red
    console.log(`[SW Empleado] 🌐 Network First: ${request.url}`);
    
    const networkResponse = await fetch(request);
    
    // Si la respuesta es válida, cachearla para futuros usos
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
    
  } catch (error) {
    // Si falla la red, buscar en caché
    console.log(`[SW Empleado] 📴 Red fallida, usando caché: ${request.url}`);
    
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Si no hay caché, mostrar página offline personalizada
    if (request.destination === 'document') {
      return offlineFallbackPage();
    }
    
    // Para otros recursos, retornar error
    return new Response('Recurso no disponible offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({
        'Content-Type': 'text/plain'
      })
    });
  }
}

/**
 * ESTRATEGIA: Cache First (con actualización en segundo plano)
 * Prioriza la caché, luego actualiza en background
 * Ideal para recursos que no cambian frecuentemente
 */
async function cacheFirstStrategy(request) {
  // Buscar en caché primero
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    console.log(`[SW Empleado] 💾 Cache hit: ${request.url}`);
    
    // Revalidar en segundo plano (actualizar caché silenciosamente)
    fetch(request).then(async (networkResponse) => {
      if (networkResponse && networkResponse.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
        console.log(`[SW Empleado] 🔄 Cache actualizado: ${request.url}`);
      }
    }).catch(() => {
      // Ignorar errores de revalidación
    });
    
    return cachedResponse;
  }
  
  // Si no está en caché, ir a la red
  console.log(`[SW Empleado] 🌐 Cache miss, fetching: ${request.url}`);
  try {
    const networkResponse = await fetch(request);
    
    // Cachear la respuesta para futuras solicitudes
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error(`[SW Empleado] ❌ Error fetching: ${request.url}`, error);
    return new Response('Error de conexión', { status: 503 });
  }
}

/**
 * ESTRATEGIA: Cache First con Revalidación
 * Similar a Cache First pero valida la edad del recurso
 * Útil para JSON de productos que tienen versión
 */
async function cacheFirstWithRevalidation(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  // Intentar obtener versión fresca de la red
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      // Comparar versiones si es JSON
      const cachedData = cachedResponse ? await cachedResponse.clone().json() : null;
      const networkData = await networkResponse.clone().json();
      
      // Si la versión es diferente, actualizar
      if (!cachedData || cachedData.version !== networkData.version) {
        console.log(`[SW Empleado] 📦 Nueva versión detectada: ${networkData.version}`);
        await cache.put(request, networkResponse.clone());
        
        // Notificar a la aplicación sobre la actualización
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({
            type: 'CATALOG_UPDATE_AVAILABLE',
            version: networkData.version,
            timestamp: new Date().toISOString()
          });
        });
      }
      
      return networkResponse;
    }
  } catch (error) {
    console.log(`[SW Empleado] 📴 Usando versión cacheada de productos`);
  }
  
  // Si hay caché, devolverla
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // Si no hay nada, error
  return new Response(JSON.stringify({ error: 'No hay catálogo disponible' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * ESTRATEGIA: Navegación
 * Para peticiones de página, con fallback a página offline
 */
async function navigationStrategy(request) {
  try {
    // Intentar obtener de la red primero
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    
    throw new Error('Respuesta no válida');
    
  } catch (error) {
    // Fallback a la página principal cacheada
    const cachedResponse = await caches.match('/empleado/index.html');
    
    if (cachedResponse) {
      console.log(`[SW Empleado] 📄 Fallback a página offline: ${request.url}`);
      return cachedResponse;
    }
    
    // Último recurso: página offline personalizada
    return offlineFallbackPage();
  }
}

/**
 * Página de fallback cuando no hay conexión ni caché
 */
async function offlineFallbackPage() {
  const offlineHTML = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sin conexión - Tienda Barrio</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                text-align: center;
            }
            .offline-container {
                padding: 20px;
            }
            .offline-icon {
                font-size: 80px;
                margin-bottom: 20px;
            }
            button {
                background: white;
                color: #667eea;
                border: none;
                padding: 12px 24px;
                border-radius: 25px;
                font-size: 16px;
                cursor: pointer;
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <div class="offline-container">
            <div class="offline-icon">📡</div>
            <h1>Sin conexión a internet</h1>
            <p>La aplicación está funcionando en modo offline.</p>
            <p>Revisa tu conexión para sincronizar los datos.</p>
            <button onclick="location.reload()">Reintentar</button>
        </div>
    </body>
    </html>
  `;
  
  return new Response(offlineHTML, {
    status: 200,
    headers: { 'Content-Type': 'text/html' }
  });
}

/**
 * EVENTO: MESSAGE
 * Escucha mensajes desde la aplicación principal
 * Permite comunicación bidireccional con el SW
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  
  switch (data.type) {
    case 'SKIP_WAITING':
      // Forzar activación del SW cuando está en espera
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      // Limpiar toda la caché (útil para depuración)
      (async () => {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(cache => caches.delete(cache)));
        console.log('[SW Empleado] 🧹 Caché limpiada');
        
        // Notificar a la aplicación
        if (event.source) {
          event.source.postMessage({ type: 'CACHE_CLEARED' });
        }
      })();
      break;
      
    case 'GET_CACHE_INFO':
      // Obtener información del estado de la caché
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        
        event.source.postMessage({
          type: 'CACHE_INFO',
          cacheName: CACHE_NAME,
          totalItems: keys.length,
          urls: keys.map(req => req.url)
        });
      })();
      break;
      
    default:
      console.log('[SW Empleado] Mensaje no reconocido:', data);
  }
});

/**
 * EVENTO: SYNC (Background Sync)
 * Sincronización en segundo plano cuando hay conexión
 * Ideal para ventas pendientes de subir
 */
self.addEventListener('sync', (event) => {
  console.log('[SW Empleado] 🔄 Background Sync activado:', event.tag);
  
  if (event.tag === 'sync-sales') {
    event.waitUntil(syncPendingSales());
  }
});

/**
 * Sincronizar ventas pendientes con el servidor
 * (Implementación básica - se puede expandir)
 */
async function syncPendingSales() {
  console.log('[SW Empleado] 📤 Sincronizando ventas pendientes...');
  
  // Obtener ventas pendientes de IndexedDB
  // Esta función se conecta con la lógica de la aplicación
  const clients = await self.clients.matchAll();
  
  clients.forEach(client => {
    client.postMessage({
      type: 'SYNC_SALES_REQUEST',
      timestamp: new Date().toISOString()
    });
  });
}

/**
 * EVENTO: PUSH
 * Manejo de notificaciones push (si se implementan)
 */
self.addEventListener('push', (event) => {
  console.log('[SW Empleado] 📨 Notificación push recibida:', event);
  
  let data = {
    title: 'Mi Tienda Barrio',
    body: 'Nueva actualización disponible',
    icon: '/empleado/icons/icon-192.png',
    badge: '/empleado/icons/icon-72.png'
  };
  
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/empleado/',
      dateOfArrival: Date.now()
    },
    actions: [
      {
        action: 'open',
        title: 'Abrir aplicación'
      },
      {
        action: 'close',
        title: 'Cerrar'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

/**
 * EVENTO: NOTIFICATION CLICK
 * Manejo cuando el usuario hace clic en una notificación
 */
self.addEventListener('notificationclick', (event) => {
  console.log('[SW Empleado] 🔔 Notificación clickeada:', event);
  
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/empleado/';
  
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      // Si ya hay una ventana abierta, enfocarla
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir una nueva
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
