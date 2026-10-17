/** Сборка HTML для reCAPTCHA v2 с динамической загрузкой скрипта и диагностикой. */
export function buildCaptchaHtml(siteKey: string, origin: string): string {
  const safeKey = siteKey
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\x3c');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="color-scheme" content="only light">
<link rel="preconnect" href="https://www.google.com" crossorigin>
<link rel="preconnect" href="https://www.gstatic.com" crossorigin>
<link rel="dns-prefetch" href="https://www.google.com">
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:0; display:flex; justify-content:center; align-items:flex-start; min-height:100vh; background:#fff; color:#000; font-family:system-ui,sans-serif; }
  .wrap { padding:20px; text-align:center; width:100%; }
  #status { margin-bottom:12px; padding:8px 12px; border-radius:6px; font-size:13px; word-break:break-word; }
  #status.ok { color:#666; background:#f5f5f5; }
  #status.err { color:#fff; background:#E53935; }
  #status .meta { font-size:11px; margin-top:4px; opacity:0.7; }
</style>
</head>
<body>
<div class="wrap">
  <div id="status" class="ok">Загрузка…</div>
  <div id="captcha-container"></div>
</div>

<script>
(function() {
  var statusEl = document.getElementById('status');
  var SITEKEY = '${safeKey}';
  var ORIGIN = '${origin.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c')}';
  var attempts = 0;
  var MAX_ATTEMPTS = 20;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls || 'ok';
  }

  function appendMeta() {
    var m = document.createElement('div');
    m.className = 'meta';
    m.textContent = 'origin: ' + ORIGIN + ' | key: ' + SITEKEY.substring(0, 8) + '…';
    statusEl.appendChild(m);
  }

  if (!SITEKEY) {
    setStatus('Не получен ключ reCAPTCHA (site_key пустой)', 'err');
    appendMeta();
    post('error', 'site_key пустой');
    return;
  }

  function post(type, data) {
    try {
      if (type === 'success') {
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'success', token:data}));
      } else if (type === 'expired') {
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'expired'}));
      } else if (type === 'loaded') {
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'loaded'}));
      } else {
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'error', error:data}));
      }
    } catch(e) {}
  }

  function renderCaptcha() {
    if (typeof grecaptcha === 'undefined' || typeof grecaptcha.render !== 'function') {
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        setStatus('Таймаут загрузки reCAPTCHA (grecaptcha не загрузился)', 'err');
        appendMeta();
        post('error', 'Таймаут загрузки reCAPTCHA');
        return;
      }
      setTimeout(renderCaptcha, 250);
      return;
    }
    var doRender = function() {
      try {
        var widgetId = grecaptcha.render('captcha-container', {
          sitekey: SITEKEY,
          callback: function(token) { diag('token: получен, длина ' + String(token).length, ts()); post('success', token); },
          'expired-callback': function() { diag('token: истёк', ts()); post('expired'); },
          'error-callback': function() { diag('widget: error-callback', ts()); post('error', 'reCAPTCHA widget error'); }
        });
        // Скрываем статус, чтобы не мешать самой капче
        statusEl.style.display = 'none';
        diag('widget: отрендерен', ts());
        post('loaded');
        // Попытка пройти без клика: если Google доверяет сессии — execute сразу
        // вернёт токен в существующий callback; иначе виджет остаётся как есть.
        try {
          if (grecaptcha.execute) {
            var execPromise = grecaptcha.execute(widgetId);
            if (execPromise && execPromise.catch) { execPromise.catch(function() {}); }
            diag('execute: вызван', ts());
          }
        } catch (execErr) {
          diag('execute: ошибка', String(execErr));
        }
      } catch(e) {
        var msg = 'Ошибка render: ' + (e && e.message ? e.message : e) + ' (key=' + SITEKEY.substring(0,8) + '…)';
        setStatus(msg, 'err');
        appendMeta();
        post('error', msg);
      }
    };
    if (typeof grecaptcha.ready === 'function') {
      grecaptcha.ready(doRender);
    } else {
      doRender();
    }
  }

  function diag(name, value) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'diag', name:String(name), value:String(value).slice(0,800)})); } catch(e) {}
  }
  function ts() { try { return Math.round(performance.now()); } catch(e) { return 0; } }
  diag('ua', navigator.userAgent);
  diag('uaData', navigator.userAgentData ? ('brands=' + JSON.stringify(navigator.userAgentData.brands) + ' mobile=' + navigator.userAgentData.mobile + ' platform=' + navigator.userAgentData.platform) : 'НЕТ (client hints отсутствуют)');
  diag('platform', navigator.platform);
  diag('languages', (navigator.languages || []).join(','));
  diag('cores', navigator.hardwareConcurrency);
  diag('window.chrome', typeof window.chrome);
  diag('screen', window.screen.width + 'x' + window.screen.height + ' dpr=' + window.devicePixelRatio);
  diag('cookies', document.cookie ? 'есть' : 'нет');
  diag('href', String(location.href).slice(0, 120));
  window.addEventListener('message', function(e) {
    var d = e.data, t;
    if (d && typeof d === 'object') { t = d.type || d.event || 'object'; } else { t = String(d).slice(0, 60); }
    diag('msg@' + ts() + ' ' + e.origin, t + ' | ' + (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400));
  });

  // Динамическая загрузка api.js
  var s = document.createElement('script');
  diag('api.js: старт загрузки', ts());
  s.src = 'https://www.google.com/recaptcha/api.js?hl=ru&render=explicit';
  s.async = true;
  s.defer = true;
  s.onload = function() { diag('api.js: загружен', ts()); renderCaptcha(); };
  s.onerror = function() {
    diag('api.js: ошибка загрузки', ts());
    setStatus('Не удалось загрузить скрипт reCAPTCHA (нет доступа к www.google.com)', 'err');
    appendMeta();
    post('error', 'Не удалось загрузить скрипт reCAPTCHA (нет доступа к www.google.com)');
  };
  document.head.appendChild(s);
})();
</script>
</body>
</html>`;
}
