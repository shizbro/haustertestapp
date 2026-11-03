// HAUSTER Telegram Mini App prototype: hash routing and in-memory state.
// Nothing is persisted or sent anywhere; a reload resets the cart and form.
(function () {
  'use strict';

  // Telegram SDK is optional: the page must work in a normal browser.
  // The SDK defines window.Telegram.WebApp even outside Telegram, with
  // platform "unknown", so check the platform too.
  var tg = window.Telegram && window.Telegram.WebApp;
  var inTelegram = !!(tg && tg.platform && tg.platform !== 'unknown');

  var ALL = 'Все';

  // STUB: order number and the "created in 1C" status are hard-coded.
  // A real build gets both from 1C after the order is submitted.
  // 00000000531 follows the sample form's 00000000530.
  var MOCK_ORDER_NUMBER = '00000000531';

  var DELIVERY = { pickup: 'Самовывоз', courier: 'Курьер' };
  var PAYMENT = { cash: 'Наличные', card: 'Картой', bank: 'Банк' };

  function emptyForm() {
    return { name: '', phone: '', bin: '', delivery: 'pickup', address: '', payment: 'cash', comment: '' };
  }

  var state = {
    products: [],
    query: '',
    category: ALL,
    cart: [], // [{ id, qty }]
    form: emptyForm(),
    errors: {},
    lastOrder: null,
    submitting: false
  };

  var view = document.getElementById('view');
  var badge = document.getElementById('cart-badge');

  // ---------- helpers ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function groups(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  // 1225 -> "1 225 тг" (non-breaking spaces so prices never wrap)
  function money(n) { return groups(n) + ' тг'; }

  // 108110 -> "сто восемь тысяч сто десять", as in the order form's "Всего" line
  function amountInWords(n) {
    var ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    var onesF = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
    var teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    var tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    var hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    var scales = [
      null,
      { f: true, forms: ['тысяча', 'тысячи', 'тысяч'] },
      { f: false, forms: ['миллион', 'миллиона', 'миллионов'] }
    ];
    function plural(x, forms) {
      var a = x % 100, b = x % 10;
      if (a > 10 && a < 20) return forms[2];
      if (b === 1) return forms[0];
      if (b >= 2 && b <= 4) return forms[1];
      return forms[2];
    }
    function triad(x, feminine) {
      var w = [hundreds[Math.floor(x / 100)]];
      var t = x % 100;
      if (t >= 10 && t < 20) w.push(teens[t - 10]);
      else w.push(tens[Math.floor(t / 10)], (feminine ? onesF : ones)[t % 10]);
      return w.filter(Boolean);
    }
    n = Math.round(n);
    if (n === 0) return 'ноль';
    var words = [];
    for (var i = scales.length - 1; i >= 0; i--) {
      var part = Math.floor(n / Math.pow(1000, i)) % 1000;
      if (!part) continue;
      words = words.concat(triad(part, i === 1));
      if (scales[i]) words.push(plural(part, scales[i].forms));
    }
    return words.join(' ');
  }

  function formatDate(d) {
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + 'г. ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ' ч.';
  }

  function findProduct(id) {
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].id === id) return state.products[i];
    }
    return null;
  }

  function qtyOf(id) {
    var line = state.cart.filter(function (l) { return l.id === id; })[0];
    return line ? line.qty : 0;
  }

  function cartCount() {
    return state.cart.reduce(function (n, l) { return n + l.qty; }, 0);
  }

  function cartTotal(cart) {
    return (cart || state.cart).reduce(function (sum, l) {
      var p = findProduct(l.id);
      return sum + (p ? p.price * l.qty : 0);
    }, 0);
  }

  function setQty(id, qty) {
    var line = state.cart.filter(function (l) { return l.id === id; })[0];
    if (!line && qty > 0) state.cart.push({ id: id, qty: qty });
    else if (line && qty > 0) line.qty = qty;
    else state.cart = state.cart.filter(function (l) { return l.id !== id; });
    updateBadge(true);
  }

  function haptic(kind) {
    if (!inTelegram || !tg.HapticFeedback) return;
    if (kind === 'error') tg.HapticFeedback.notificationOccurred('error');
    else if (kind === 'success') tg.HapticFeedback.notificationOccurred('success');
    else tg.HapticFeedback.impactOccurred('light');
  }

  function updateBadge(bump) {
    var n = cartCount();
    badge.textContent = n;
    badge.hidden = n === 0;
    badge.parentElement.setAttribute('aria-label', n ? 'Корзина, товаров: ' + n : 'Корзина');
    if (bump && n) {
      badge.classList.remove('bump');
      void badge.offsetWidth;
      badge.classList.add('bump');
    }
  }

  function go(hash) { location.hash = hash; }

  function categories() {
    var seen = [ALL];
    state.products.forEach(function (p) { if (seen.indexOf(p.category) === -1) seen.push(p.category); });
    return seen;
  }

  function filtered() {
    var q = state.query.trim().toLowerCase();
    return state.products.filter(function (p) {
      var inCat = state.category === ALL || p.category === state.category;
      var hit = !q || p.name.toLowerCase().indexOf(q) !== -1 || p.id.toLowerCase().indexOf(q) !== -1;
      return inCat && hit;
    });
  }

  // ---------- icons ----------

  function icon(path, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }
  var I = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    truck: '<path d="M2 6h11v9H2zM13 9h4l3 3v3h-7"/><circle cx="6" cy="17" r="1.6"/><circle cx="16.5" cy="17" r="1.6"/>',
    ret: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/>',
    support: '<path d="M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v5H4zM17 13h3v5h-3z"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    cart: '<path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/><circle cx="9.5" cy="20" r="1.2"/><circle cx="17.5" cy="20" r="1.2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    camera: '<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>'
  };

  // ---------- pieces ----------

  // Photos come from the customer's order form PDF. A product without a
  // confirmed photo shows "Фото отсутствует" (never a similar product's image).
  function photo(p, alt) {
    if (!p.image) {
      return '<div class="photo photo-missing">' + icon(I.camera, 22) + '<span>Фото отсутствует</span></div>';
    }
    return '<div class="photo"><img src="' + esc(p.image) + '" alt="' + esc(alt || '') + '" loading="lazy"></div>';
  }

  function priceHtml(p) {
    return (p.oldPrice ? '<span class="old-price"><span class="visually-hidden">Старая цена </span>' + money(p.oldPrice) + '</span> ' : '') +
      '<span class="price">' + money(p.price) + ' <span class="unit">/ ' + esc(p.unit || 'шт') + '</span></span>';
  }

  function cardControl(p) {
    var q = qtyOf(p.id);
    if (!q) {
      return '<button class="add-round" type="button" data-action="add" data-id="' + esc(p.id) + '" aria-label="В корзину: ' + esc(p.name) + '">' + icon(I.plus, 20) + '</button>';
    }
    return '<div class="mini-stepper" role="group" aria-label="Количество: ' + esc(p.name) + '">' +
      '<button type="button" data-action="dec" data-id="' + esc(p.id) + '" aria-label="Уменьшить количество">−</button>' +
      '<output>' + q + '</output>' +
      '<button type="button" data-action="inc" data-id="' + esc(p.id) + '" aria-label="Увеличить количество">+</button></div>';
  }

  function stepper(p) {
    return '<div class="stepper" role="group" aria-label="Количество">' +
      '<button type="button" data-action="dec" data-id="' + esc(p.id) + '" aria-label="Уменьшить количество">−</button>' +
      '<output aria-live="polite">' + qtyOf(p.id) + '</output>' +
      '<button type="button" data-action="inc" data-id="' + esc(p.id) + '" aria-label="Увеличить количество">+</button></div>';
  }

  function bottomButton(label, sum, action, variant, disabled) {
    return '<div class="bottom-bar"><button class="btn ' + (variant || '') + '" type="button" data-action="' + action + '"' + (disabled ? ' disabled' : '') + '>' +
      esc(label) + (sum ? ' <span class="btn-sum">· ' + sum + '</span>' : '') + '</button></div>';
  }

  // ---------- screens ----------

  var BENEFITS = [
    [I.truck, 'Бесплатная доставка', 'На все заказы свыше 20 000 тг'],
    [I.ret, 'Бесплатный возврат', 'В течение 14 дней'],
    [I.support, 'Поддержка 24/7', 'Свяжитесь с нами 24 часа в сутки'],
    [I.shield, '100% безопасная оплата', 'Ваш платеж в безопасности']
  ];

  function renderCatalog() {
    var cats = categories();
    return '' +
      '<div class="hero"><h1 class="hero-title">Сантехника и отопление <span>с доставкой</span></h1></div>' +
      '<div class="search">' +
        '<label class="field-label" for="search">Поиск по названию или артикулу</label>' +
        '<div class="search-box">' + icon(I.search, 18) +
          '<input class="input" id="search" type="search" placeholder="Например, VT.227 или тройник" autocomplete="off" value="' + esc(state.query) + '">' +
        '</div>' +
      '</div>' +
      '<ul class="benefits" aria-label="Преимущества">' + BENEFITS.map(function (b) {
        return '<li class="benefit"><span class="benefit-icon">' + icon(b[0], 20) + '</span>' +
          '<div><p class="benefit-title">' + b[1] + '</p><p class="benefit-text">' + b[2] + '</p></div></li>';
      }).join('') + '</ul>' +
      '<div class="chips" role="group" aria-label="Категории">' + cats.map(function (c) {
        var n = c === ALL ? state.products.length : state.products.filter(function (p) { return p.category === c; }).length;
        return '<button class="chip" type="button" data-action="category" data-value="' + esc(c) + '" aria-pressed="' + (c === state.category) + '">' + esc(c) + '<span class="chip-count">' + n + '</span></button>';
      }).join('') + '</div>' +
      '<div class="section-head"><h2 class="section-title">Популярные товары</h2><span class="section-meta" id="grid-count"></span></div>' +
      '<div class="grid" id="grid">' + renderGrid(filtered()) + '</div>';
  }

  function renderGrid(list) {
    if (!list.length) return '<p class="empty-note">Ничего не найдено</p>';
    return list.map(function (p) {
      return '<article class="card">' +
        '<a class="card-link" href="#/product/' + encodeURIComponent(p.id) + '">' +
          photo(p) +
          '<div class="card-body">' +
            '<p class="code">' + esc(p.id) + '</p>' +
            '<h3 class="card-name">' + esc(p.name) + '</h3>' +
          '</div>' +
        '</a>' +
        '<div class="card-foot"><div>' + priceHtml(p) + '</div><div data-control="' + esc(p.id) + '">' + cardControl(p) + '</div></div>' +
      '</article>';
    }).join('');
  }

  function renderProduct(id) {
    var p = findProduct(id);
    if (!p) return renderEmpty('Товар не найден', 'Вернуться в каталог');
    var q = qtyOf(p.id);
    return '<div class="product-photo">' + photo(p, p.name) + '</div>' +
      '<div class="product-info">' +
        '<div class="tags"><span class="tag">Артикул: ' + esc(p.id) + '</span><span class="tag">' + esc(p.category) + '</span><span class="tag">Ед.: ' + esc(p.unit || 'шт') + '</span></div>' +
        '<h1 class="product-name">' + esc(p.name) + '</h1>' +
        '<div class="product-price">' + priceHtml(p) + '</div>' +
        // Stock is informational only and is never decremented.
        '<p class="stock">В наличии: ' + p.stock + ' ' + esc(p.unit || 'шт') + '.</p>' +
      '</div>' +
      '<p class="note">' + icon(I.info, 18) + '<span>Цена и наличие проверяются в 1С перед оформлением заказа</span></p>' +
      (q ? '<div class="qty-row"><span class="qty-label">В корзине</span>' + stepper(p) + '</div>' : '') +
      bottomButton(q ? 'Перейти в корзину' : 'В корзину', q ? money(cartTotal()) : money(p.price), q ? 'to-cart' : 'add-current', q ? '' : 'btn-add');
  }

  function renderEmpty(text, cta) {
    return '<div class="empty"><span class="empty-icon">' + icon(I.cart, 30) + '</span><p>' + text + '</p>' +
      '<a class="btn" href="#/catalog">' + cta + '</a></div>';
  }

  function summary(cart) {
    var qty = cart.reduce(function (n, l) { return n + l.qty; }, 0);
    return '<div class="summary-row"><span>Позиций</span><span>' + cart.length + '</span></div>' +
      '<div class="summary-row"><span>Количество</span><span>' + qty + '</span></div>' +
      '<div class="summary-row total"><span>Итого</span><strong>' + money(cartTotal(cart)) + '</strong></div>';
  }

  function renderCart() {
    var head = '<div class="screen-head"><h1 class="screen-title">Корзина</h1></div>';
    if (!state.cart.length) return head + renderEmpty('Корзина пуста', 'Вернуться в каталог');
    return head +
      '<ul class="cart-list">' + state.cart.map(function (l) {
        var p = findProduct(l.id);
        return '<li class="cart-row">' + photo(p) + '<div>' +
          '<p class="code">' + esc(p.id) + '</p>' +
          '<p class="cart-name">' + esc(p.name) + '</p>' +
          '<p class="cart-unit-price">' + money(p.price) + ' / ' + esc(p.unit || 'шт') + '</p>' +
          '<div class="cart-controls">' + stepper(p) + '<span class="price">' + money(p.price * l.qty) + '</span></div>' +
          '</div></li>';
      }).join('') + '</ul>' +
      '<div class="panel">' + summary(state.cart) + '</div>' +
      bottomButton('Оформить заказ', money(cartTotal()), 'checkout');
  }

  function field(id, label, key, opts) {
    opts = opts || {};
    var err = state.errors[key];
    var attrs = ' id="' + id + '" name="' + key + '"' +
      (opts.type === 'tel' ? ' inputmode="tel" autocomplete="tel"' : '') +
      (opts.numeric ? ' inputmode="numeric"' : '') +
      (err ? ' aria-invalid="true" aria-describedby="' + id + '-error"' : '');
    var control = opts.multiline
      ? '<textarea class="input"' + attrs + '>' + esc(state.form[key]) + '</textarea>'
      : '<input class="input" type="' + (opts.type || 'text') + '"' + attrs + ' value="' + esc(state.form[key]) + '">';
    return '<div class="form-field">' +
      '<label class="field-label" for="' + id + '">' + label + (opts.optional ? ' <span class="optional">(' + opts.optional + ')</span>' : '') + '</label>' +
      control +
      (err ? '<p class="error" id="' + id + '-error">' + icon(I.alert, 14) + err + '</p>' : '') +
      '</div>';
  }

  function segmented(name, legend, options) {
    return '<fieldset><legend>' + legend + '</legend><div class="segmented">' + Object.keys(options).map(function (k) {
      return '<label><input type="radio" name="' + name + '" value="' + k + '"' + (state.form[name] === k ? ' checked' : '') + '><span>' + options[k] + '</span></label>';
    }).join('') + '</div></fieldset>';
  }

  function renderCheckout() {
    if (!state.cart.length) return renderCart();
    return '<div class="screen-head"><h1 class="screen-title">Оформление заказа</h1></div>' +
      '<form id="checkout-form" novalidate>' +
        '<section class="panel"><h2 class="panel-title">Покупатель</h2>' +
          field('f-name', 'Имя или название компании', 'name') +
          field('f-phone', 'Телефон', 'phone', { type: 'tel' }) +
          field('f-bin', 'БИН / ИИН', 'bin', { optional: 'если нужен счёт', numeric: true }) +
        '</section>' +
        '<section class="panel"><h2 class="panel-title">Доставка и оплата</h2>' +
          segmented('delivery', 'Способ доставки', DELIVERY) +
          (state.form.delivery === 'courier' ? field('f-address', 'Адрес доставки', 'address') : '') +
          segmented('payment', 'Способ оплаты', PAYMENT) +
          '<p class="helper">Отсрочка платежа через бота недоступна.</p>' +
          '<fieldset>' + field('f-comment', 'Комментарий', 'comment', { optional: 'необязательно', multiline: true }) + '</fieldset>' +
        '</section>' +
        '<section class="panel"><h2 class="panel-title">Ваш заказ</h2>' + summary(state.cart) + '</section>' +
      '</form>' +
      bottomButton('Подтвердить заказ', money(cartTotal()), 'confirm', '', state.submitting);
  }

  function renderOrderForm(o) {
    var qty = o.cart.reduce(function (n, l) { return n + l.qty; }, 0);
    var total = cartTotal(o.cart);
    return '<section class="panel" aria-labelledby="form-title">' +
      '<h2 class="panel-title" id="form-title">Бланк заказа покупателя</h2>' +
      '<dl class="form-meta">' +
        '<dt>Клиент</dt><dd>' + esc(o.form.name) + (o.form.bin ? ', БИН/ИИН ' + esc(o.form.bin) : '') + '</dd>' +
        '<dt>Телефон</dt><dd>' + esc(o.form.phone) + '</dd>' +
        '<dt>№ заказа</dt><dd>' + o.number + '</dd>' +
        '<dt>Дата размещения</dt><dd>' + o.date + '</dd>' +
        '<dt>Способ доставки</dt><dd>' + DELIVERY[o.form.delivery] + '</dd>' +
        (o.form.delivery === 'courier' ? '<dt>Место доставки</dt><dd>' + esc(o.form.address) + '</dd>' : '') +
        '<dt>Способ оплаты</dt><dd>' + PAYMENT[o.form.payment] + '</dd>' +
        (o.form.comment.trim() ? '<dt>Комментарий</dt><dd>' + esc(o.form.comment) + '</dd>' : '') +
      '</dl>' +
      '<ol class="form-items">' + o.cart.map(function (l, i) {
        var p = findProduct(l.id);
        return '<li class="form-item"><span class="form-item-no">' + (i + 1) + '</span>' + photo(p) +
          '<div><p class="code">' + esc(p.id) + '</p><p class="form-item-name">' + esc(p.name) + '</p>' +
          '<p class="form-item-calc"><span>' + l.qty + ' ' + esc(p.unit || 'шт') + ' × ' + money(p.price) + '</span><strong>' + money(p.price * l.qty) + '</strong></p></div></li>';
      }).join('') + '</ol>' +
      '<p class="form-total"><span>ИТОГО: ' + qty + ' ' + 'шт' + '</span><span>' + money(total) + '</span></p>' +
      '<p class="form-words">Всего: ' + groups(total) + ' (' + amountInWords(total) + ') тенге</p>' +
      '</section>';
  }

  function renderDone() {
    var o = state.lastOrder;
    if (!o) return renderEmpty('Заказов пока нет', 'Перейти в каталог');
    // STUB: number and "Создан в 1С" are static mock values, not a real 1C response.
    // The PDF card is a placeholder; no file exists behind it. The form preview
    // below is rendered locally from the cart that was just confirmed.
    return '<div class="success"><span class="success-icon">' + icon(I.check, 34) + '</span>' +
        '<h1 class="screen-title">Заказ оформлен</h1>' +
        '<p class="order-number">№ ' + o.number + '</p>' +
        '<span class="status">Создан в 1С</span>' +
      '</div>' +
      '<div class="panel doc-card"><span class="doc-icon">PDF</span>' +
        '<div><p class="doc-name">Бланк заказа ' + o.number + '.pdf</p><p class="doc-hint">Документ с фотографиями товаров придёт в чат после подключения к 1С</p></div></div>' +
      renderOrderForm(o) +
      '<div class="done-actions"><a class="btn" href="#/catalog">Вернуться в каталог</a></div>';
  }

  // ---------- routing ----------

  var current = { name: 'catalog', id: null };

  function parseRoute() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var name = parts[0] || 'catalog';
    var id = parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null;
    if (['catalog', 'product', 'cart', 'checkout', 'done'].indexOf(name) === -1) name = 'catalog';
    return { name: name, id: id };
  }

  function render() {
    current = parseRoute();
    var html = {
      catalog: renderCatalog,
      product: function () { return renderProduct(current.id); },
      cart: renderCart,
      checkout: renderCheckout,
      done: renderDone
    }[current.name]();
    view.innerHTML = html;
    updateGridCount();
    updateBadge(false);
    syncBackButton();
  }

  // Re-render while keeping the scroll position (quantity changes etc.).
  function rerender() {
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function updateGridCount() {
    var el = document.getElementById('grid-count');
    if (el) {
      var n = filtered().length;
      el.textContent = n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'товар' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'товара' : 'товаров');
    }
  }

  function onRoute() {
    render();
    window.scrollTo(0, 0);
    if (current.name !== 'catalog') view.focus({ preventScroll: true });
  }

  function syncBackButton() {
    if (!inTelegram || !tg.BackButton) return;
    if (current.name === 'catalog') tg.BackButton.hide(); else tg.BackButton.show();
  }

  function goBack() {
    var parent = { product: '#/catalog', cart: '#/catalog', checkout: '#/cart', done: '#/catalog' }[current.name];
    go(parent || '#/catalog');
  }

  // ---------- events ----------

  function validate() {
    var f = state.form;
    state.errors = {};
    if (!f.name.trim()) state.errors.name = 'Укажите имя или название компании';
    if (!f.phone.trim()) state.errors.phone = 'Укажите телефон';
    if (f.delivery === 'courier' && !f.address.trim()) state.errors.address = 'Укажите адрес доставки';
    return Object.keys(state.errors).length === 0;
  }

  function refreshCardControl(id) {
    var slot = view.querySelector('[data-control="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (slot) slot.innerHTML = cardControl(findProduct(id));
    return !!slot;
  }

  view.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    var id = el.getAttribute('data-id');

    if (action === 'category') {
      state.category = el.getAttribute('data-value');
      rerender();
    } else if (action === 'add') {
      setQty(id, qtyOf(id) + 1);
      haptic();
      if (!refreshCardControl(id)) rerender();
    } else if (action === 'add-current') {
      setQty(current.id, qtyOf(current.id) + 1);
      haptic();
      rerender();
    } else if (action === 'to-cart') {
      go('#/cart');
    } else if (action === 'inc' || action === 'dec') {
      setQty(id, qtyOf(id) + (action === 'inc' ? 1 : -1));
      haptic();
      if (current.name === 'catalog' && refreshCardControl(id)) return;
      rerender();
    } else if (action === 'checkout') {
      state.errors = {};
      go('#/checkout');
    } else if (action === 'confirm') {
      // Guard against double taps creating two orders (TZ 3.4).
      if (state.submitting) return;
      if (validate()) {
        state.submitting = true;
        // Order is not sent anywhere. Stock is not decremented.
        state.lastOrder = {
          number: MOCK_ORDER_NUMBER,
          date: formatDate(new Date()),
          cart: state.cart.map(function (l) { return { id: l.id, qty: l.qty }; }),
          form: JSON.parse(JSON.stringify(state.form))
        };
        state.cart = [];
        state.form = emptyForm();
        state.errors = {};
        state.submitting = false;
        haptic('success');
        go('#/done');
      } else {
        rerender();
        var first = view.querySelector('[aria-invalid="true"]');
        if (first) first.focus();
        haptic('error');
      }
    }
  });

  view.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'search') {
      state.query = t.value;
      // Re-render only the grid so the search field keeps focus.
      document.getElementById('grid').innerHTML = renderGrid(filtered());
      updateGridCount();
    } else if (t.form && t.form.id === 'checkout-form' && t.name in state.form && t.type !== 'radio') {
      state.form[t.name] = t.value;
      if (state.errors[t.name] && t.value.trim()) {
        delete state.errors[t.name];
        t.removeAttribute('aria-invalid');
        var msg = document.getElementById(t.id + '-error');
        if (msg) msg.remove();
      }
    }
  });

  view.addEventListener('change', function (e) {
    var t = e.target;
    if (t.type === 'radio' && t.name in state.form) {
      state.form[t.name] = t.value;
      // The address field appears only for courier delivery.
      if (t.name === 'delivery') {
        delete state.errors.address;
        rerender();
        var addr = document.getElementById('f-address');
        if (addr) addr.focus();
      }
    }
  });

  view.addEventListener('submit', function (e) { e.preventDefault(); });

  // ---------- Telegram theme ----------

  function applyTelegramTheme() {
    if (!inTelegram) return;
    tg.ready();
    tg.expand();
    var t = tg.themeParams || {};
    // Surfaces and text follow Telegram; brand colors (logo black/cyan,
    // site green) stay fixed so the HAUSTER identity is kept.
    var map = {
      '--color-bg': t.secondary_bg_color,
      '--color-card': t.bg_color,
      '--color-text': t.text_color,
      '--color-muted': t.hint_color,
      '--color-line': t.section_separator_color
    };
    var root = document.documentElement.style;
    Object.keys(map).forEach(function (k) { if (map[k]) root.setProperty(k, map[k]); });
    if (tg.colorScheme === 'dark') {
      // Logo black would vanish on a dark background; use logo cyan instead.
      root.setProperty('--color-primary', 'var(--brand-cyan)');
      root.setProperty('--color-on-primary', 'var(--brand-ink)');
      root.setProperty('--color-tint', 'rgba(0, 180, 248, 0.16)');
      root.setProperty('--color-green-tint', 'rgba(112, 193, 172, 0.2)');
    }
    if (tg.setHeaderColor) tg.setHeaderColor('#ffffff');
    if (tg.BackButton) tg.BackButton.onClick(goBack);
  }

  // ---------- start ----------

  applyTelegramTheme();
  window.addEventListener('hashchange', onRoute);

  fetch('src/data/products.json')
    .then(function (r) { return r.json(); })
    .then(function (data) { state.products = data; render(); })
    .catch(function () {
      view.innerHTML = '<div class="empty"><p>Не удалось загрузить каталог. Откройте приложение через локальный сервер.</p></div>';
    });
})();
