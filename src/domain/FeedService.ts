// ---------------------------------------------------------------------------
// FeedService — доменный сервис ленты (каналы, сообщения, unread).
// Инкапсулирует маппинг сырых данных ELMA и персистентность.
// Зависит от интерфейсов персистентности (FeedPersistence, AccountPersistence)
// и API-слоя (elma-api) — НЕ от zustand-сторов напрямую.
// ---------------------------------------------------------------------------

import {ElmaAccount} from '../types/account';
import {FeedMessage, FeedChannel} from '../types/feed';
import {extractField} from '../utils/extract-field';
import {
  FeedPersistence,
  AccountPersistence,
} from '../interfaces/persistence';
import {
  feedChannels as apiFeedChannels,
  feedMessages as apiFeedMessages,
  feedTargetsUnread as apiFeedTargetsUnread,
  resolveUserNames as apiResolveUserNames,
} from '../services/elma-api';
import {ElmaRequestError, ElmaRequestKind} from '../types/errors';
import {persistUpdatedAccount} from './account-persistence';

// ---------------------------------------------------------------------------
// RefreshResult
// ---------------------------------------------------------------------------

export interface FeedRefreshResult {
  ok: boolean;
  error?: string;
  kind?: ElmaRequestKind;
}

// ---------------------------------------------------------------------------
// FeedService
// ---------------------------------------------------------------------------

/**
 * Доменный сервис ленты.
 *
 * Инкапсулирует бизнес-логику: загрузку сообщений, каналов и unread-счётчика.
 * Маппинг сырых данных ELMA → доменные модели (FeedMessage, FeedChannel)
 * выполняется через extractField (tolerant field extraction).
 *
 * Использует FeedPersistence вместо прямого импорта feed-store.
 * Использует AccountPersistence вместо прямого импорта auth-store.
 */
export class FeedService {
  constructor(
    private feedPersistence: FeedPersistence,
    private accountPersistence: AccountPersistence,
  ) {}

  // -----------------------------------------------------------------------
  // Публичные методы
  // -----------------------------------------------------------------------

  /**
   * Загрузить сообщения ленты (с поддержкой пагинации).
   * Порядок operations идентичен оригиналу из feed-service.ts.
   */
  async loadMessages(
    account: ElmaAccount,
    offset: number = 0,
  ): Promise<FeedRefreshResult> {
    this.feedPersistence.setLoading(account.id, true);
    this.feedPersistence.setError(account.id, null);

    try {
      const {messages: raw, updatedAccount} = await apiFeedMessages(account, offset);
      if (updatedAccount) {
        persistUpdatedAccount(this.accountPersistence, account.id, updatedAccount);
      }
      const mapped = (raw as Record<string, unknown>[]).map(mapRawMessage);

      const SYSTEM_GUID = '00000000-0000-0000-0000-000000000000';

      // Резолв GUID авторов → человекочитаемые имена
      const authorGuids = [
        ...new Set(
          mapped
            .map(m => m.author)
            .filter((a): a is string => !!a && a !== SYSTEM_GUID),
        ),
      ];
      if (authorGuids.length > 0) {
        const nameMap = await apiResolveUserNames(account, authorGuids);
        for (const m of mapped) {
          if (m.author && m.author !== SYSTEM_GUID && nameMap.has(m.author)) {
            m.author = nameMap.get(m.author) || '';
          }
        }
      }
      // Системный GUID и пустые авторы — очищаем, чтобы UI их скрыл
      for (const m of mapped) {
        if (!m.author || m.author === SYSTEM_GUID) {
          m.author = '';
        }
      }

      const append = offset > 0;
      this.feedPersistence.setMessages(account.id, mapped, append);
      this.feedPersistence.setOffset(account.id, offset + mapped.length);
      this.feedPersistence.setHasMore(account.id, mapped.length >= 20);
      this.feedPersistence.setLoading(account.id, false);
      return {ok: true};
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = e instanceof ElmaRequestError ? e.kind : ('other' as ElmaRequestKind);
      this.feedPersistence.setError(account.id, msg);
      this.feedPersistence.setLoading(account.id, false);
      return {ok: false, error: msg, kind};
    }
  }

  /**
   * Загрузить активные каналы ленты.
   */
  async loadChannels(
    account: ElmaAccount,
  ): Promise<FeedRefreshResult> {
    try {
      const {channels: raw, updatedAccount} = await apiFeedChannels(account);
      if (updatedAccount) {
        persistUpdatedAccount(this.accountPersistence, account.id, updatedAccount);
      }
      const mapped = (raw as Record<string, unknown>[]).map(mapRawChannel);
      this.feedPersistence.setChannels(account.id, mapped);
      return {ok: true};
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = e instanceof ElmaRequestError ? e.kind : ('other' as ElmaRequestKind);
      return {ok: false, error: msg, kind};
    }
  }

  /**
   * Загрузить количество непрочитанных сообщений.
   */
  async loadUnread(
    account: ElmaAccount,
  ): Promise<FeedRefreshResult> {
    try {
      const {targets: raw, updatedAccount} = await apiFeedTargetsUnread(account);
      if (updatedAccount) {
        persistUpdatedAccount(this.accountPersistence, account.id, updatedAccount);
      }
      const count = Array.isArray(raw) ? raw.length : 0;
      this.feedPersistence.setUnreadCount(account.id, count);
      return {ok: true};
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const kind = e instanceof ElmaRequestError ? e.kind : ('other' as ElmaRequestKind);
      return {ok: false, error: msg, kind};
    }
  }
}

// ---------------------------------------------------------------------------
// Маппинг сырых данных ELMA → доменные модели
// ---------------------------------------------------------------------------

/**
 * Маппинг сырого сообщения ленты в FeedMessage.
 * Использует extractField для толерантного извлечения полей.
 */
export function mapRawMessage(raw: Record<string, unknown>): FeedMessage {
  return {
    id: extractField(raw, ['id', 'Id', '__id']) || String(Math.random()),
    title: extractField(raw, ['title', 'Title', 'subject', 'Subject', '__name']),
    text: extractField(raw, ['text', 'Text', 'body', 'Body', 'message', 'Message', 'content']),
    author: extractField(raw, ['author', 'Author', 'userName', 'UserName', 'name', 'Name']),
    createdAt: extractField(raw, ['createdAt', 'CreatedAt', '__createdAt', 'date', 'Date']),
    raw,
  };
}

/**
 * Маппинг сырого канала ленты в FeedChannel.
 * Использует extractField для толерантного извлечения полей.
 */
function mapRawChannel(raw: Record<string, unknown>): FeedChannel {
  return {
    id: extractField(raw, ['id', 'Id', '__id']) || String(Math.random()),
    name: extractField(raw, ['name', 'Name', 'title', 'Title', '__name']),
    raw,
  };
}
