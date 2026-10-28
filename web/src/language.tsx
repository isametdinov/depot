import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Language = "en" | "ru";

const STORAGE_KEY = "depot-language";

const russian: Record<string, string> = {
  "Main navigation": "Главная навигация",
  Dashboard: "Главная",
  Inventory: "Склад",
  Reservations: "Резервации",
  "Inventory, kept in view.": "Весь склад — как на ладони.",
  "Live stock and reservation management.": "Управление запасами и резервациями в реальном времени.",
  "Contact us": "Связаться с нами",
  Developer: "Разработчик",
  "Tashkent, Uzbekistan": "Ташкент, Узбекистан",
  "Quick link": "Быстрый переход",
  "Back to dashboard": "Вернуться на главную",
  "© {year} DEPOT. Inventory reservation service.": "© {year} DEPOT. Сервис управления запасами и резервациями.",
  "All figures come from the live API.": "Все данные получены из API в реальном времени.",
  "YOUR OPERATIONS, AT A GLANCE": "ВАШИ ОПЕРАЦИИ — С ПЕРВОГО ВЗГЛЯДА",
  Syncing: "Синхронизация",
  Refresh: "Обновить",
  "Try again": "Повторить",
  "WELCOME TO DEPOT": "ДОБРО ПОЖАЛОВАТЬ В DEPOT",
  "Stock that moves": "Запасы, которые",
  "with your business.": "растут вместе с бизнесом.",
  "A quieter, clearer way to keep inventory in view. Know what is on hand, what is reserved, and what is ready to go — all in one place.": "Удобный и понятный способ следить за запасами. Узнайте, что есть на складе, что зарезервировано и что готово к отправке — всё в одном месте.",
  "Open inventory": "Открыть склад",
  "View reservations": "Посмотреть резервации",
  "Connected to your live inventory": "Подключено к данным склада",
  "Live stock overview": "Обзор запасов в реальном времени",
  "INVENTORY SNAPSHOT": "СОСТОЯНИЕ СКЛАДА",
  "Finding your warehouse…": "Поиск склада…",
  "No warehouse yet": "Склад не найден",
  Live: "Онлайн",
  available: "доступно",
  Available: "Доступно",
  Reserved: "Зарезервировано",
  Physical: "Физический остаток",
  "products stocked": "товаров на складе",
  "STOCK, IN SYNC": "ЗАПАСЫ ОБНОВЛЕНЫ",
  "Inventory summary": "Сводка по складу",
  "Available to move": "Доступно для отгрузки",
  "units ready for orders": "единиц готово к заказам",
  "Held for customers": "Зарезервировано клиентами",
  "units in active reservations": "единиц в активных резервациях",
  "Product catalog": "Каталог товаров",
  "products across {count} locations": "товаров в локациях: {count}",
  "A SIMPLE WORKFLOW": "ПРОСТОЙ РАБОЧИЙ ПРОЦЕСС",
  "From shelf to shipped.": "От полки до отправки.",
  "Built to keep the everyday moving.": "Всё необходимое для ежедневной работы.",
  "Keep stock visible": "Контролируйте запасы",
  "See physical, reserved, and available quantities for every product at a glance.": "Сразу видьте физический остаток, резервы и доступное количество каждого товара.",
  "Explore inventory": "Перейти к складу",
  "Set what you have": "Управляйте остатками",
  "Update warehouse quantities in seconds and keep your live picture accurate.": "Обновляйте остатки за секунды и следите за актуальными данными.",
  "Update stock": "Обновить остатки",
  "Reserve with confidence": "Резервируйте уверенно",
  "Hold items for a customer with all-or-nothing reservations and safe retries.": "Резервируйте товары для клиентов с атомарным подтверждением и безопасными повторами.",
  "See reservations": "Перейти к резервациям",
  "YOUR WORKSPACE": "ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО",
  "Stock highlights": "Ключевые остатки",
  "All stock": "Все остатки",
  "No stocked products here yet. Add stock to see it appear.": "На складе пока нет товаров. Добавьте остатки, чтобы они появились здесь.",
  "Less guesswork. More good work.": "Меньше догадок. Больше результата.",
  "Depot keeps the details in order, so you can keep everything else moving.": "DEPOT следит за деталями, чтобы вы могли сосредоточиться на главном.",
  "Go to inventory": "Перейти к складу",
  "Inventory refreshed": "Склад обновлён",
  "Live stock for the selected warehouse, read from the API on every refresh.": "Актуальные остатки выбранного склада загружаются из API при каждом обновлении.",
  "Refreshing…": "Обновление…",
  "Add stock": "Добавить остатки",
  "Create reservation": "Создать резервацию",
  Warehouse: "Склад",
  "Add warehouse ID": "Добавить ID склада",
  "Warehouse UUID": "UUID склада",
  Add: "Добавить",
  "Track product": "Отслеживать товар",
  "Product UUID": "UUID товара",
  Products: "Товары",
  " / {count} loaded": " / загружено: {count}",
  "No warehouse selected": "Склад не выбран",
  Retry: "Повторить",
  "Loading warehouses from the API…": "Загрузка складов из API…",
  "No warehouse is available yet. Add a warehouse ID, then set stock to create it.": "Склады пока недоступны. Добавьте ID склада, затем укажите остатки, чтобы создать его.",
  "Filter products…": "Фильтр товаров…",
  "Filter products": "Фильтр товаров",
  "Loading inventory…": "Загрузка остатков…",
  "product(s)": "товаров",
  Product: "Товар",
  Status: "Статус",
  Remove: "Удалить",
  "No products tracked": "Нет отслеживаемых товаров",
  "Products appear here when available from the API. Add stock to create a product.": "Товары из API появятся здесь. Добавьте остатки, чтобы создать товар.",
  "Out of stock": "Нет в наличии",
  Low: "Мало",
  "In stock": "В наличии",
  "Loading…": "Загрузка…",
  Unavailable: "Недоступно",
  "Remove from this view": "Убрать из списка",
  "Stop tracking {id}": "Прекратить отслеживание {id}",
  "Enter a valid warehouse UUID.": "Введите корректный UUID склада.",
  "Enter a valid product UUID.": "Введите корректный UUID товара.",
  "Select or add a warehouse first.": "Сначала выберите или добавьте склад.",
  "Could not load products and warehouses: {message}": "Не удалось загрузить товары и склады: {message}",
  "Could not load products and warehouses. Check that the API is reachable.": "Не удалось загрузить товары и склады. Проверьте доступность API.",
  "Some stock could not be loaded. Check that the API is reachable.": "Не удалось загрузить часть остатков. Проверьте доступность API.",
  "Could not load your Depot catalog: {message}": "Не удалось загрузить каталог DEPOT: {message}",
  "Could not load your Depot catalog. Check that the API is reachable.": "Не удалось загрузить каталог DEPOT. Проверьте доступность API.",
  "Could not load live stock: {message}": "Не удалось загрузить актуальные остатки: {message}",
  "Could not load live stock. Check that the API is reachable.": "Не удалось загрузить актуальные остатки. Проверьте доступность API.",
  "Not stocked in this warehouse": "Нет остатков на этом складе",
  "Failed to load this row.": "Не удалось загрузить эту строку.",
  "Look up a reservation by its ID, inspect its status and confirm or cancel it.": "Найдите резервацию по ID, проверьте её статус и подтвердите или отмените.",
  "Reservation ID": "ID резервации",
  "Reservation UUID": "UUID резервации",
  "Looking up…": "Поиск…",
  "Look up": "Найти",
  "No reservation loaded": "Резервация не загружена",
  "The API has no listing endpoint — paste a reservation ID to fetch it. IDs are shown after creating a reservation on the Inventory page.": "В API нет списка резерваций. Вставьте ID, чтобы загрузить её. ID отображается после создания резервации на странице склада.",
  "Confirm reservation?": "Подтвердить резервацию?",
  "Cancel reservation?": "Отменить резервацию?",
  "Confirming finalizes this reservation and releases its stock hold. This cannot be undone.": "Подтверждение завершает резервацию и освобождает зарезервированные остатки. Это действие нельзя отменить.",
  "Cancelling releases the held stock back to the warehouse. This cannot be undone.": "Отмена возвращает зарезервированные остатки на склад. Это действие нельзя отменить.",
  Confirm: "Подтвердить",
  "Cancel reservation": "Отменить резервацию",
  Cancel: "Отмена",
  Back: "Назад",
  "Reservation created": "Резервация создана",
  "Create another": "Создать ещё",
  "Back to inventory": "Вернуться на склад",
  "Open details": "Открыть подробности",
  Items: "Товары",
  "Inventory updated": "Остатки обновлены",
  "Physical stock stays the same while this reservation is active. Reserved stock increases and available stock decreases.": "Физический остаток не меняется, пока резервация активна. Зарезервированное количество увеличивается, доступное — уменьшается.",
  "Refreshing stock from the API…": "Обновление остатков из API…",
  "Confirm or cancel this reservation from the Reservations page.": "Подтвердите или отмените резервацию на странице резерваций.",
  "Submitting…": "Отправка…",
  "Product for line": "Товар в строке",
  "Quantity for line": "Количество в строке",
  "Select product…": "Выберите товар…",
  "Available stock from the last API refresh": "Доступный остаток после последнего обновления API",
  "Remove line": "Удалить строку",
  "Add line": "Добавить строку",
  "Order summary": "Состав заказа",
  "Order summary:": "Состав заказа:",
  "Stock is validated by the server.": "Остатки проверяются сервером.",
  "Select a product.": "Выберите товар.",
  "Not a valid product UUID.": "Некорректный UUID товара.",
  "Duplicate product — each product may appear once (backend contract).": "Товар повторяется — каждый товар можно указать только один раз.",
  "Quantity must be a whole number from 1 to 1,000,000.": "Количество должно быть целым числом от 1 до 1 000 000.",
  "A reservation needs at least one item.": "Добавьте хотя бы один товар в резервацию.",
  "Quantity must be a whole number between 0 and 1,000,000.": "Количество должно быть целым числом от 0 до 1 000 000.",
  "Set physical quantity": "Указать физический остаток",
  "stock is set to an absolute quantity by the API.": "количество остатков задаётся через API.",
  "Select a product…": "Выберите товар…",
  "Something went wrong. Please try again.": "Что-то пошло не так. Попробуйте ещё раз.",
  "The request failed. Please try again.": "Запрос не выполнен. Попробуйте ещё раз.",
  "This reservation expired at {time} and no longer holds stock. Expired reservations cannot be confirmed or cancelled.": "Срок резервации истёк {time}; она больше не удерживает остатки. Истёкшую резервацию нельзя подтвердить или отменить.",
  "Timestamps are shown in your local timezone.": "Время указано в вашем часовом поясе.",
  Quantity: "Количество",
  "The details above were refreshed from the server.": "Данные выше обновлены с сервера.",
  Working: "Выполняется",
  "Confirm reservation": "Подтвердить резервацию",
  "Confirmed — this reservation is finished; no further actions are allowed.": "Подтверждено — резервация завершена, дальнейшие действия недоступны.",
  "Cancelled — this reservation is finished; no further actions are allowed.": "Отменено — резервация завершена, дальнейшие действия недоступны.",
  "Expired — no further actions are allowed.": "Срок истёк — дальнейшие действия недоступны.",
  pending: "ожидает",
  confirmed: "подтверждена",
  cancelled: "отменена",
  expired: "истекла",
  "Close dialog": "Закрыть окно",
  "Dismiss notification": "Закрыть уведомление",
  "Switch to {mode} mode": "Переключить на тему: {mode}",
  "Theme mode dark": "тёмная",
  "Theme mode light": "светлая",
  "Stock summary": "Сводка по остаткам",
  "Set stock": "Задать остатки",
  "Saving…": "Сохранение…",
  "Stock set to {qty} for {id}": "Остаток установлен: {qty}, товар {id}",
  "{id} reserved · {available} available": "зарезервировано: {id} · доступно: {available}",
  "{reserved} reserved · {available} available": "зарезервировано: {reserved} · доступно: {available}",
  "{quantity} unit(s) reserved": "зарезервировано единиц: {quantity}",
  "{lines} line(s), {units} unit(s)": "строк: {lines}, единиц: {units}",
  "avail.": "доступно",
  warehouse: "склад",
  "Reservation": "Резервация",
  "Refresh reservation": "Обновить резервацию",
  "Created": "Создано",
  "Expires": "Истекает",
  "Loading locations…": "Загрузка локаций…",
  "Ready when you are": "Готов к работе",
  "{stocked} of {total} catalog products have stock at this location.": "Товаров с остатками в этой локации: {stocked} из {total}.",
  "Add a warehouse and start building your inventory.": "Добавьте склад, чтобы начать формировать запасы.",
  "Active location": "Активная локация",
  "Select dashboard warehouse": "Выбрать склад для главной страницы",
  "ON YOUR SHELVES": "НА ВАШИХ ПОЛКАХ",
  "Checking your live stock…": "Проверка актуальных остатков…",
  "{count} units available": "Доступно единиц: {count}",
  "just now": "только что",
  "in under a minute": "менее чем через минуту",
  "in {count}{unit}": "через {count} {unit}",
  "{count}{unit} ago": "{count} {unit} назад",
  "Lookup failed. Please try again.": "Не удалось выполнить поиск. Попробуйте ещё раз.",
  "Enter a valid reservation UUID (8-4-4-4-12 hexadecimal).": "Введите корректный UUID резервации (8-4-4-4-12 шестнадцатеричных символов).",
  "Reservation {id} is now {status}.": "Резервация {id}: статус — {status}.",
  "No reservation with id {id}.": "Резервация с ID {id} не найдена.",
  "Reservation succeeded, but updated stock could not be loaded: {message}": "Резервация создана, но не удалось загрузить обновлённые остатки: {message}",
  "Reservation succeeded, but updated stock could not be loaded. Refresh inventory to check it.": "Резервация создана, но не удалось загрузить обновлённые остатки. Обновите склад, чтобы проверить данные.",
  English: "English",
  Russian: "Русский",
  Language: "Язык",
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string, values?: Record<string, string | number>) => string;
}

function interpolate(text: string, values?: Record<string, string | number>): string {
  let result = text;
  for (const [key, value] of Object.entries(values ?? {})) {
    result = result.replaceAll(`{${key}}`, String(value));
  }
  return result;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => undefined,
  t: interpolate,
});

function getInitialLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === "ru" ? "ru" : "en";
  } catch {
    return "en";
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const setLanguage = (next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The selected language still applies for this visit.
    }
  };
  const t = (text: string, values?: Record<string, string | number>) => {
    return interpolate(language === "ru" ? russian[text] ?? text : text, values);
  };
  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
