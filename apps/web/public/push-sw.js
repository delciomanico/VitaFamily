/*
 * Notificações push no service worker (UC-ALR-06). Carregado pelo service worker gerado pelo
 * vite-plugin-pwa através de `importScripts` (vite.config.ts); ficheiro clássico, sem bundler.
 *
 * O texto recebido é sempre genérico (N8/BR-ALR-08: sem nomes, medicamentos nem horas) — o detalhe
 * só existe dentro da app. As funções puras (`parsePushPayload`, `buildNotification`) estão expostas
 * em `module.exports` só para os testes (apps/web/src/lib/pushServiceWorker.e2e.test.ts).
 */
(function (scope) {
  var DEFAULT_TITLE = 'Vita Family'
  var DEFAULT_BODY = 'Tem uma notificação nova. Abra a app para ver os detalhes.'
  var ALERTS_URL = '/app/alerts'

  /** `text` é o corpo cru do push (JSON {title, body}); qualquer outra coisa cai nos valores genéricos. */
  function parsePushPayload(text) {
    var title = DEFAULT_TITLE
    var body = DEFAULT_BODY
    try {
      var data = JSON.parse(text)
      if (data && typeof data.title === 'string' && data.title.trim()) title = data.title
      if (data && typeof data.body === 'string' && data.body.trim()) body = data.body
    } catch (e) {
      /* sem corpo ou não-JSON: mensagem genérica (o browser exige sempre uma notificação visível) */
    }
    return { title: title, body: body }
  }

  function buildNotification(text) {
    var payload = parsePushPayload(text)
    return {
      title: payload.title,
      options: {
        body: payload.body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-64x64.png',
        // Mesma etiqueta: vários avisos seguidos não enchem a barra; renotify volta a avisar.
        tag: 'vita-alerts',
        renotify: true,
        data: { url: ALERTS_URL },
      },
    }
  }

  function onPush(event) {
    var text = ''
    try {
      text = event.data ? event.data.text() : ''
    } catch (e) {
      text = ''
    }
    var built = buildNotification(text)
    event.waitUntil(scope.registration.showNotification(built.title, built.options))
  }

  function onNotificationClick(event) {
    event.notification.close()
    var url = (event.notification.data && event.notification.data.url) || ALERTS_URL
    event.waitUntil(
      scope.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
        for (var i = 0; i < windows.length; i += 1) {
          var client = windows[i]
          if ('focus' in client) {
            // Reutiliza o separador aberto e leva-o aos alertas.
            if ('navigate' in client) {
              return client.navigate(url).then(
                function (navigated) {
                  return (navigated || client).focus()
                },
                function () {
                  return client.focus()
                },
              )
            }
            return client.focus()
          }
        }
        return scope.clients.openWindow(url)
      }),
    )
  }

  if (typeof scope.addEventListener === 'function') {
    scope.addEventListener('push', onPush)
    scope.addEventListener('notificationclick', onNotificationClick)
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parsePushPayload: parsePushPayload, buildNotification: buildNotification, onPush: onPush, onNotificationClick: onNotificationClick }
  }
})(typeof self !== 'undefined' ? self : this)
