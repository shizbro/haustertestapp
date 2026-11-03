# HAUSTER Telegram Mini App: static prototype

Frontend-only prototype of a Telegram Mini App for the HAUSTER store, built for a
stakeholder demo. Plain HTML/CSS/JS with no build step and no backend. All data is local
and all state lives in memory: reloading the page resets the cart and the form.

## Run locally

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open http://127.0.0.1:8000. Use a server rather than opening `index.html` directly,
because the catalog is loaded with `fetch('src/data/products.json')`.

Opening it in Telegram requires a public HTTPS URL (a tunnel or static hosting) and a bot
configured with @BotFather. This prototype does neither.

## Files

| File | Purpose |
|---|---|
| `index.html` | Single entry point; loads the Telegram Web Apps SDK |
| `src/app.js` | Hash routing (`#/catalog`, `#/product/<id>`, `#/cart`, `#/checkout`, `#/done`), in-memory cart and form, order-form preview, Telegram integration |
| `src/styles/tokens.css` | Brand colors (from the logo and hauster.kz) and design tokens |
| `src/styles/app.css` | Layout and components |
| `src/data/products.json` | Catalog: the 5 items from the customer's order form |
| `assets/brand/logo.png` | HAUSTER logo, from `hauster.kz/static/img/logo_h.png` with the empty margins cropped |
| `assets/products/*.jpg` | Product photos extracted from `Бланк заказа покупателя.pdf`, one file per article |

## Data source

The catalog comes from the customer's sample form **«Бланк заказа покупателя»**
(Форма № 2, order 00000000530 of 21.10.2026). Articles, names, units and prices are copied
from it exactly:

| Article | Name | Unit | Price |
|---|---|---|---|
| VT.218.N.04 | Кран шар. BASE, рукоятка бабочка 1/2" вн.-нар. | шт | 1 490 |
| VT.227.N.04 | Кран шар. BASE с полусгоном 1/2" вн.-нар. | шт | 1 760 |
| VT.227.N.05 | Кран шар. BASE с полусгоном 3/4" вн.-нар. | шт | 2 815 |
| VTm.231.N.202020 | Тройник пресс 20 | шт | 1 810 |
| VTm.253.N.001604 | Угольник пресс с переходом на нар. р. 16х1/2" | шт | 850 |

Notes:
- **Stock** values are the quantities ordered in that form (24, 10, 10, 10, 10). They are
  test values, not real warehouse stock.
- **Categories** ("Шаровые краны", "Фитинги") were assigned by us. The form has no categories.
  Category chips are built from the data, so new categories appear automatically.
- **Photos** were extracted from the PDF without changes (embedded JPEGs, about 110 px).
  VT.227.N.04 and VT.227.N.05 use the **same photo** in the customer's form, so both show
  it here too. Confirm whether the 3/4" valve needs its own photo.
- The photos are low resolution, so they are shown at a modest size on white. Higher-resolution
  images from 1C or the site will look sharper on the large product view.
- A product with an empty `image` shows «Фото отсутствует» and is never given a similar
  product's photo (ТЗ 3.5).
- The earlier test catalog (8 items from the first brief) was replaced. Its prices
  disagreed with this form; for example, «Тройник пресс 20» was 2 504 тг there but
  1 810 тг in the form.

## What is mocked (stubs)

- **Catalog:** `products.json` is static. Prices and stock are not live.
- **Stock:** shown for information only, never decremented.
- **Order submission:** «Подтвердить заказ» validates the form, saves a local snapshot of the
  cart, clears the cart and shows the success screen. Nothing is sent anywhere. A guard
  ignores repeated taps while confirming.
- **Order number `00000000531`:** hard-coded (`MOCK_ORDER_NUMBER` in `src/app.js`). It is
  the next number after the sample form's.
- **«Создан в 1С» status:** static text. No 1C call takes place.
- **PDF card «Бланк заказа 00000000531.pdf»:** a placeholder. No file exists behind it.
- **«Бланк заказа покупателя» preview on the success screen:** rendered in the browser from
  the confirmed cart and form. It mirrors the customer's form fields: client, order №,
  placement date, delivery method and address, payment method, then a numbered list with
  photo, article, name, unit, quantity, price and sum, the ИТОГО line, and «Всего: … (сумма
  прописью) тенге». It is not the 1C print form.
- **«Цена и наличие проверяются в 1С…» note:** static text only.
- **Hero line «Сантехника и отопление с доставкой»:** our own short tagline, not copied from the site.

## Design

The look was modernized while keeping the HAUSTER identity:

- **Logo black `#0b070b`:** primary buttons and the active category chip.
- **Logo cyan `#00b4f8`:** cart badge, icons, focus rings, highlights and the success state.
- **Site green `#70c1ac`** (the site's «В корзину» button): add-to-cart buttons and the
  stock indicator. Its text is dark rather than white, because white on this green has only
  2.2:1 contrast.
- **Layout:** white cards with 12–18px radius on a soft grey page, horizontally scrolling
  benefit cards, pill category chips with counts, and a + button that turns into a
  quantity stepper on each card.
- **Header:** always white, so the black logo stays legible in every theme.

### Telegram behavior

- `window.Telegram.WebApp` is used only when `platform !== "unknown"`. In a normal browser
  the SDK still loads but reports `unknown`.
- Inside Telegram the app:
  - calls `ready()` and `expand()`
  - maps `themeParams` onto surfaces and text (`secondary_bg_color`, `bg_color`,
    `text_color`, `hint_color`, `section_separator_color`)
  - in dark themes, switches primary buttons from logo black to logo cyan
  - sets the header color to white
  - shows the native BackButton on inner screens
  - uses haptics
- Brand colors are never overridden.

## Connecting to 1C and the Telegram Bot API later

These are the places to replace:

1. **`src/data/products.json`:** replace with an API call to a backend that reads 1C
   (nomenclature, prices by price type, stock, units and photos linked by article). Update
   the `fetch` at the bottom of `src/app.js`.
2. **`src/app.js`, `confirm` action and `renderDone()`:** POST the order to the backend.
   The backend re-checks prices and stock, creates «Заказ покупателя» in 1C with an
   idempotency key, and returns the real number, date and PDF. Remove `MOCK_ORDER_NUMBER`.
3. **`renderOrderForm()`:** keep it as an on-screen summary or drop it. The real PDF with
   embedded photos must be produced on the server (ТЗ 3.5) and sent to the chat through the
   Bot API.
4. **Backend (new, not part of this repo):** verify Telegram `initData` on every request,
   talk to 1C, and send documents through the Bot API. The bot token must live only on that
   server, never in this frontend.

## Unverified values

- **Error color `#d33a2c`:** no error style was visible on the site.
- **Fonts are not downloaded:** "SF Pro Display" is self-hosted by the site but not
  hotlinked here. The stack uses the system font, which is SF Pro on Apple devices.
- **Radii, spacing, page background `#f3f5f7`, tints and line color `#e3e6ea`:** design
  choices for the modern look, not taken from the site.
- **Product categories and stock values:** see "Data source" above.
- **Logo usage:** the logo file was downloaded from hauster.kz for this demo. Confirm with
  HAUSTER that it may be used in the Mini App, and ask for a vector (SVG) version for
  sharper rendering.

## Checks run

These were run in a desktop browser pane, outside Telegram, on 2026-11-03:

- Catalog at 390px:
  - logo, hero, search, benefits strip, chips with counts, and grid with all 5 photos
  - search «тройник» → 1, «VT.227» → 2
  - chip «Фитинги» → 2
- Cart flow:
  - + on a card turns into a stepper, and the card quantity and badge stay in sync
  - added from the product page, which then shows «Перейти в корзину» and a stepper
  - totals: 3×1 490 + 1 810 + 850 = 7 130 тг; after removing the tee with −, 5 320 тг
- Checkout:
  - choosing «Курьер» reveals the address field
  - confirming empty shows three inline errors (name, phone, address) and stays on checkout
  - after filling the fields (typed, not scripted) and choosing «Банк», the order was created
- Order created:
  - success state, mock status, PDF placeholder
  - form preview with photos, items, ИТОГО and the total in words
- `amountInWords` checked against the sample form (108 110 → «сто восемь тысяч сто десять»)
  and against 1, 11, 21, 1 000, 2 000, 21 001, 1 000 000 and 2 345 678.
- 1280px: the column is centered.
- Console: no errors. Network: only local files and `telegram.org`.

**Not checked:** the real Telegram client (theme mapping, dark mode, BackButton, haptics),
and real iOS/Android devices.
