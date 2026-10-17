/**
 * CaptchaModal — обработка сообщений из WebView (handleMessage).
 *
 * Проверяем ветки postMessage из HTML-капчи:
 *  - `success` → onSuccess(token), без onExpired/onError;
 *  - `expired` → onExpired();
 *  - `loaded`  → колбэки не вызываются;
 *  - `error`   → onError(текст);
 *  - `error` без текста → onError('reCAPTCHA ошибка');
 *  - `diag` и некорректный JSON → колбэки не вызываются, исключения нет.
 *
 * WebView замокан (__mocks__/react-native-webview), сеть не открывается.
 */

import React from 'react';
import renderer, {act, ReactTestRenderer} from 'react-test-renderer';
import WebView from 'react-native-webview';

jest.mock('../../src/diag/accept-log', () => ({
  logDiag: jest.fn(),
  getDiagLog: jest.fn(() => ''),
  hasDiagLog: jest.fn(() => false),
  shareDiagLog: jest.fn(() => Promise.resolve()),
  shareCookieBank: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/native/KeepAlive', () => ({
  getCaptchaUserAgent: jest.fn(() => ''),
}));

import CaptchaModal from '../../src/components/CaptchaModal';
import {logDiag} from '../../src/diag/accept-log';
import {getCaptchaUserAgent} from '../../src/native/KeepAlive';

const mockLogDiag = logDiag as jest.MockedFunction<typeof logDiag>;
const mockGetCaptchaUserAgent = getCaptchaUserAgent as jest.MockedFunction<typeof getCaptchaUserAgent>;

const onSuccess = jest.fn();
const onExpired = jest.fn();
const onError = jest.fn();
const onCancel = jest.fn();

function renderModal(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <CaptchaModal
        visible
        siteKey="test-site-key"
        baseUrl="https://elma.test"
        onSuccess={onSuccess}
        onExpired={onExpired}
        onError={onError}
        onCancel={onCancel}
      />,
    );
  });
  return tree;
}

/** Доставить сообщение из WebView так, как это делает window.ReactNativeWebView.postMessage. */
function postFromWebView(tree: ReactTestRenderer, data: string): void {
  const webview = tree.root.findByType(WebView);
  act(() => {
    webview.props.onMessage({nativeEvent: {data}});
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CaptchaModal — handleMessage', () => {
  it('`loaded` → колбэки не вызываются', () => {
    const tree = renderModal();

    postFromWebView(tree, JSON.stringify({type: 'loaded'}));

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('`success` → onSuccess(token), остальные колбэки не вызываются', () => {
    const tree = renderModal();

    postFromWebView(tree, JSON.stringify({type: 'success', token: 'tok-abc'}));

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith('tok-abc');
    expect(onExpired).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(mockLogDiag).toHaveBeenCalledWith('captcha', 'postMessage success');
  });

  it('`expired` → onExpired()', () => {
    const tree = renderModal();

    postFromWebView(tree, JSON.stringify({type: 'expired'}));

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('`error` → onError(текст)', () => {
    const tree = renderModal();

    postFromWebView(tree, JSON.stringify({type: 'error', error: 'api.js недоступен'}));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('api.js недоступен');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('`error` без текста → onError(«reCAPTCHA ошибка»)', () => {
    const tree = renderModal();

    postFromWebView(tree, JSON.stringify({type: 'error'}));

    expect(onError).toHaveBeenCalledWith('reCAPTCHA ошибка');
  });

  it('`success` без токена и `diag` — колбэки не вызываются', () => {
    const tree = renderModal();

    postFromWebView(tree, JSON.stringify({type: 'success'}));
    postFromWebView(tree, JSON.stringify({type: 'diag', name: 'ua', value: 'test'}));

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
    expect(mockLogDiag).toHaveBeenCalledWith('captcha', 'ua: test');
  });

  it('некорректный JSON игнорируется без исключения', () => {
    const tree = renderModal();

    expect(() => postFromWebView(tree, 'не json')).not.toThrow();

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe('CaptchaModal — userAgent WebView', () => {
  it('передаёт userAgent, если нативная обёртка вернула непустую строку', () => {
    mockGetCaptchaUserAgent.mockReturnValue(
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120.0.0.0 Mobile Safari/537.36',
    );

    const tree = renderModal();
    const webview = tree.root.findByType(WebView);

    expect(webview.props.userAgent).toBe(
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120.0.0.0 Mobile Safari/537.36',
    );
  });

  it('не передаёт userAgent при пустой строке', () => {
    mockGetCaptchaUserAgent.mockReturnValue('');

    const tree = renderModal();
    const webview = tree.root.findByType(WebView);

    expect(webview.props.userAgent).toBeUndefined();
  });

  it('явно задаёт incognito={false} и cacheMode=LOAD_DEFAULT', () => {
    const tree = renderModal();
    const webview = tree.root.findByType(WebView);

    expect(webview.props.incognito).toBe(false);
    expect(webview.props.cacheMode).toBe('LOAD_DEFAULT');
  });
});
