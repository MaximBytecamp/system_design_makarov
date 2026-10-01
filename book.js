/* System design — мелкая механика страницы.
   1. Кадр или схема открывается во весь экран по клику.
   2. Кнопка «копировать» у блоков кода. */
(() => {
  /* ---- Увеличение кадра ---------------------------------------- */
  const shots = [...document.querySelectorAll('.shot img')];
  if (shots.length) {
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<figure><img alt=""><figcaption></figcaption></figure>'
      + '<p class="lightbox__hint">клик или Esc — закрыть</p>';
    document.body.appendChild(box);

    const image = box.querySelector('img');
    const caption = box.querySelector('figcaption');

    const open = source => {
      image.src = source.currentSrc || source.src;
      image.alt = source.alt || '';
      const own = source.closest('figure')?.querySelector('figcaption');
      caption.textContent = own ? own.textContent.trim() : image.alt;
      caption.hidden = !caption.textContent;
      box.classList.add('is-open');
      box.setAttribute('aria-hidden', 'false');
    };

    const close = () => {
      box.classList.remove('is-open');
      box.setAttribute('aria-hidden', 'true');
      image.removeAttribute('src');
    };

    shots.forEach(source => {
      source.tabIndex = 0;
      source.addEventListener('click', () => open(source));
      source.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open(source);
      });
    });

    box.addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && box.classList.contains('is-open')) close();
    });
  }

  /* ---- Копирование команд -------------------------------------- */
  /* Кнопка в подписи блока кода. Обычный блок отдаёт в буфер то, что видно;
     блок с data-copy на <pre> — строку из атрибута. Это нужно там, где команда
     показана в несколько строк для чтения, а вставлять её в терминал надо одной:
     при вставке многострочного текста оболочка выполняет каждую строку отдельно
     и команда рвётся на первом же переносе. */
  document.querySelectorAll('figure.code > figcaption').forEach(caption => {
    const block = caption.parentElement.querySelector('pre');
    if (!block) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = block.dataset.copy ? 'копировать в одну строку' : 'копировать';
    button.title = block.dataset.copy
      ? 'Команда попадёт в буфер одной строкой — вставляйте прямо в терминал'
      : 'Скопировать содержимое блока';

    let timer = 0;
    const report = (text, state) => {
      button.textContent = text;
      button.dataset.state = state;
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = block.dataset.copy ? 'копировать в одну строку' : 'копировать';
        delete button.dataset.state;
      }, 2000);
    };

    button.addEventListener('click', async () => {
      const text = block.dataset.copy || block.textContent;
      try {
        await navigator.clipboard.writeText(text);
        report('скопировано', 'done');
      } catch (_) {
        // Буфер недоступен (страница открыта файлом, старый браузер) — выделяем текст.
        const range = document.createRange();
        range.selectNodeContents(block);
        const selection = getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        report('выделено — Ctrl+C', 'fail');
      }
    });

    caption.appendChild(button);
  });
})();
