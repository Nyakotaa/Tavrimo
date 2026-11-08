const SAFE_HOSTS = new Set(['rasp.rea.ru']);

export function createReaHttpError(status, rawUrl, stage = 'обращении к порталу') {
  const httpStatus = Number(status);
  if (httpStatus !== 403) return null;

  let host = 'rasp.rea.ru';
  try {
    const parsed = new URL(String(rawUrl || 'https://rasp.rea.ru/'));
    if (SAFE_HOSTS.has(parsed.hostname)) host = parsed.hostname;
  } catch {}

  const error = new Error(
    `Портал ${host} отклонил автоматический запрос (HTTP 403) при ${stage}. ` +
    'Это не ошибка номера группы: сервер Tavrimo не получил страницу поиска. ' +
    'Сохранённые данные расписания не изменены. Пока доступ не восстановлен, используйте официальный экспорт .ics вручную.'
  );
  error.code = 'REA_UPSTREAM_FORBIDDEN';
  error.upstreamStatus = 403;
  error.upstreamHost = host;
  return error;
}
