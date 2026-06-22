# Salary Roadmap

Веб-приложение «дорога» проекта ЗПП O!Bank. Читает структуру из Firebase Firestore,
показывает разделы на дороге с процентами, по клику проваливается в раздел, где стоят галочки.
Данные добавляются/удаляются через отдельное приложение **salary-admin**.

## Файлы
- `index.html` — страница
- `style.css` — стили (тёмная тема, бренд O!Bank)
- `firebase-config.js` — подключение к Firebase
- `app.js` — вся логика (чтение из базы, дорога, проценты, галочки)

## Как залить в GitHub (через сайт, без команд)
1. Открой репозиторий https://github.com/dmayrambek/salary-roadmap
2. Кнопка **Add file → Upload files**
3. Перетащи все 4 файла (`index.html`, `style.css`, `firebase-config.js`, `app.js`)
4. Внизу **Commit changes**

## Как открыть сайт (GitHub Pages)
1. В репозитории: **Settings → Pages**
2. Source: **Deploy from a branch**, ветка **main**, папка **/(root)** → Save
3. Через минуту сайт будет по адресу: `https://dmayrambek.github.io/salary-roadmap/`

## Первый запуск
База пустая → при первом открытии приложение само зальёт стартовую структуру
(3 раздела + тестовые пункты ESS, Схема работы, Коммерческое предложение).
Дальше всё добавляешь через salary-admin.

## Правила Firestore
Пока тестируешь — оставь **Test mode** (открыт на 30 дней), всё заработает сразу.

Когда сделаем salary-admin, поставим строгие правила
(Firebase Console → Firestore → Rules):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /nodes/{id} {
      allow read: if true;                       // дорогу видят все
      allow update: if true;                     // галочки может ставить любой
      allow create, delete: if request.auth != null;  // добавлять/удалять — только вход
    }
  }
}
```

## Модель данных (коллекция `nodes`)
Каждый документ — узел дерева:
- `parentId` — id родителя (`null` у разделов верхнего уровня)
- `title_ru`, `title_en` — название на двух языках
- `order` — порядок среди соседей
- `done` — галочка (имеет смысл только для самых нижних пунктов)

Процент = выполнено листьев / всего листьев. Узел без детей = пункт с галочкой;
как только внутри появляются дети — он автоматически становится папкой с процентом.

---
ЗПП O!Bank · Internal · Generated with Claude — review before distribution
