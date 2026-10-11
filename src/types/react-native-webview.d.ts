declare module 'react-native-webview' {
  import {Component} from 'react';
  import {ViewStyle} from 'react-native';

  export interface WebViewMessageEvent {
    nativeEvent: {data: string};
  }

  export interface WebViewProps {
    source: {html?: string; uri?: string; baseUrl?: string};
    style?: ViewStyle | ViewStyle[] | undefined;
    ref?: React.RefObject<WebView>;
    onMessage?: (event: WebViewMessageEvent) => void;
    onLoadStart?: () => void;
    onLoadEnd?: () => void;
    onError?: (event: {nativeEvent: {description?: string}}) => void;
    javaScriptEnabled?: boolean;
    domStorageEnabled?: boolean;
    originWhitelist?: string[];
    [key: string]: unknown;
  }

  export default class WebView extends Component<WebViewProps> {
    reload(): void;
  }
}
