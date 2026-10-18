/**
 * Фабрика кастомного WebSocket-конструктора, пробрасывающего cookie-сессию
 * аккаунта заголовком `Cookie` в HTTP-рукопожатие WebSocket.
 *
 * Так же авторизуется браузерный веб-клиент портала: same-origin WebSocket
 * несёт cookie автоматически, а ELMA API-токен Centrifugo НЕ принимает.
 * Паттерн — раздел «Custom WebSocket constructor» в README centrifuge:
 * 1 аргумент (url) → добавляем субпротокол и options, 2 аргумента
 * (url, protocols) → options третьим аргументом. `Authorization` не добавляем.
 *
 * @param cookieHeader Строка cookie аккаунта (account.cookies).
 */
export function createRealtimeWebSocket(cookieHeader: string): typeof WebSocket {
  const options = {headers: {Cookie: cookieHeader}};
  const BaseWebSocket = globalThis.WebSocket as unknown as new (...args: any[]) => WebSocket;

  const RealtimeWebSocket = class extends BaseWebSocket {
    constructor(...args: any[]) {
      if (args.length === 1) {
        super(...[...args, 'centrifuge-json', options]);
      } else {
        super(...[...args, options]);
      }
    }
  };

  return RealtimeWebSocket as unknown as typeof WebSocket;
}
