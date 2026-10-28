/**
 * Row copy, one flat dictionary per built-in locale.
 *
 * Keys stay flat on purpose: the Client locale runtime resolves a key with a
 * direct property read (`dict[key]`), so a dotted or nested key never resolves.
 */

/** English copy, the key source of truth. */
const en = {
  title: 'Web search provider',
  description:
    'Which backend answers web_search. The list comes from the running web service.',
  stateLoading: 'Reading the registered providers…',
  stateSaving: 'Saving…',
  stateEnv:
    'Falling back to DSH_WEB_SEARCH_PROVIDER ({id}) until a selection is saved.',
  stateAuto:
    'No explicit choice; the single usable provider is picked automatically.',
  stateMemory:
    'No settings service here, so a choice only applies to this process.',
  stateFailed:
    'The host refused the change; the previous provider is still in use.',
  stateError: 'Could not read the provider list: {message}',
  providerUnavailable: '{id} (unavailable)',
  providerUnknown: '{id} (not registered)',
};

/** Every key the row may translate. */
export type CopyKey = keyof typeof en;

/** Dictionaries for the two built-in locales; `zh` must mirror every key. */
export const copy: Record<'en' | 'zh', Record<CopyKey, string>> = {
  en,
  zh: {
    title: '网页搜索提供方',
    description: '选择 web_search 使用的后端，列表来自运行中的 web 服务。',
    stateLoading: '正在读取已注册的提供方…',
    stateSaving: '保存中…',
    stateEnv: '尚未保存选择，当前回退到 DSH_WEB_SEARCH_PROVIDER（{id}）。',
    stateAuto: '没有显式选择，按可用性自动挑选唯一的提供方。',
    stateMemory: '当前部署没有 settings 服务，选择只对本次进程生效。',
    stateFailed: 'Host 拒绝了这次切换；原有提供方仍然生效。',
    stateError: '读取提供方列表失败：{message}',
    providerUnavailable: '{id}（不可用）',
    providerUnknown: '{id}（未注册）',
  },
};

/** The translation function the row receives. */
export type Translate = (
  key: CopyKey,
  params?: Record<string, string>,
) => string;
