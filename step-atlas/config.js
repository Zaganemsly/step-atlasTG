/* СТЕПЬ: настройки, которые меняет владелец. Здесь НЕТ секретов (токена бота, ключей): этот файл публичный. */
window.STEP_CONFIG = {
  /* Адрес сервера Pro (Cloudflare Worker), без слэша в конце. Пока пусто — Pro выключен:
     туры показываются как витрина, кнопка покупки сообщает «скоро».
     Пример: "https://step-pro.ваш-аккаунт.workers.dev" */
  PRO_API: "https://steppro.danvoloshin99.workers.dev",
  BOT_LINK: "https://t.me/AtlasFishingbot/atlas",
  /* Цены в Telegram Stars показываются из ответа сервера. Здесь запасные значения для витрины до подключения сервера. */
  FALLBACK_PLANS: [
    { id: "1w", months: 0, days: 7, stars: 60, title: "7 дней" },
    { id: "1m", months: 1, days: 30, stars: 150, title: "1 месяц" },
    { id: "3m", months: 3, days: 90, stars: 400, title: "3 месяца" },
    { id: "12m", months: 12, days: 365, stars: 1200, title: "12 месяцев" }
  ]
};
