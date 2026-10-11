import React, {useCallback, useMemo, useRef} from 'react';
import {Modal, View, StyleSheet, TouchableOpacity, Text} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
import {normalizeBaseUrl} from '../utils/url';
import {useAppTheme} from '../theme';
import {logDiag} from '../diag/accept-log';
import {buildCaptchaHtml} from './captcha-html';

type CaptchaModalProps = {
  visible: boolean;
  siteKey: string;
  baseUrl: string;
  onSuccess: (token: string) => void;
  onExpired: () => void;
  onError: (error: string) => void;
  onCancel: () => void;
};

/**
 * Модальное окно с Google reCAPTCHA v2.
 * Использует WebView для отображения капчи в контексте домена ELMA
 * (иначе Google отклонит ключ сайта).
 */
export default function CaptchaModal({
  visible,
  siteKey,
  baseUrl,
  onSuccess,
  onExpired,
  onError,
  onCancel,
}: CaptchaModalProps) {
  const webViewRef = useRef<WebView>(null);

  const {colors} = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const origin = normalizeBaseUrl(baseUrl) || baseUrl;

  // HTML и source мемоизируем: новая ссылка на source перезагружает WebView,
  // а перезагрузка — это заново скачанная api.js и сброшенная капча.
  const html = useMemo(() => buildCaptchaHtml(siteKey, origin), [siteKey, origin]);
  const source = useMemo(() => ({html, baseUrl: origin}), [html, origin]);

  const handleReload = useCallback(() => {
    webViewRef.current?.reload();
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        logDiag('captcha', 'postMessage ' + String(msg.type));
        if (msg.type === 'success' && typeof msg.token === 'string') {
          onSuccess(msg.token);
        } else if (msg.type === 'expired') {
          onExpired();
        } else if (msg.type === 'error') {
          onError(msg.error || 'reCAPTCHA ошибка');
        } else if (msg.type === 'diag') {
          logDiag('captcha', String(msg.name) + ': ' + String(msg.value));
        }
      } catch {
        // Игнорируем некорректные сообщения
      }
    },
    [onSuccess, onExpired, onError],
  );

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Подтвердите, что вы не робот</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={handleReload}>
            <Text style={styles.headerBtnText}>Обновить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={onCancel}>
            <Text style={styles.headerBtnText}>Закрыть</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <WebView
            ref={webViewRef}
            source={source}
            style={styles.webview}
            onMessage={handleMessage}
            onError={(syntheticEvent: {nativeEvent: {description?: string}}) => {
              const {nativeEvent} = syntheticEvent;
              logDiag('captcha', 'onError ' + String(nativeEvent.description || ''));
              onError(nativeEvent.description || 'Ошибка загрузки WebView');
            }}
            onHttpError={(e: {nativeEvent: {statusCode?: number}}) => {
              logDiag('captcha', 'http error ' + String(e.nativeEvent.statusCode));
            }}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            sharedCookiesEnabled
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            cacheEnabled
            originWhitelist={['https://www.google.com', 'https://www.gstatic.com']}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            onShouldStartLoadWithRequest={(req: {url?: string}) => {
              const u = req.url || '';
              return (
                u.startsWith('https://www.google.com') ||
                u.startsWith('https://www.gstatic.com') ||
                u.startsWith('about:blank') ||
                u.startsWith('data:')
              );
            }}
            androidLayerType="hardware"
            overScrollMode="never"
          />
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    // Полноэкранное непрозрачное окно: капче отдан весь экран, отрисовка без блендинга.
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.separator,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: c.textPrimary,
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 4,
  },
  headerBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: c.primary,
  },
  body: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#fff',
  },
});

// Type declaration for ThemeColors
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];
