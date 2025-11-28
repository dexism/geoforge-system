// rulebook.js

document.addEventListener('DOMContentLoaded', () => {
    // 設定: 読み込むファイルリスト (sectionsフォルダ内のパスを指定)
    const files = [
        'sections/01_introduction.html',
        'sections/02_player.html',
        'sections/03_teller.html',
        'sections/04_scenario.html',
        'sections/05_data.html'
    ];

    const contentArea = document.getElementById('content-area');
    const tocList = document.getElementById('toc-list');
    const drawer = document.getElementById('drawer-nav');
    const overlay = document.getElementById('drawer-overlay');
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = themeToggle.querySelector('span');

    // --- 最終更新日時の設定 ---
    const lastUpdateEl = document.getElementById('last-update');
    if (lastUpdateEl) {
        // document.lastModified でHTMLファイルの最終更新日時を取得
        // 必要に応じて手動の日付文字列に置き換えてください
        lastUpdateEl.textContent = document.lastModified;
    }

    // --- テーマ設定の初期化 ---
    const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const currentTheme = localStorage.getItem("theme");

    if (currentTheme === "dark" || (!currentTheme && prefersDarkScheme.matches)) {
        document.body.classList.add("dark-mode");
        themeIcon.textContent = "light_mode";
    } else {
        document.body.classList.remove("dark-mode");
        themeIcon.textContent = "dark_mode";
    }

    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
        localStorage.setItem("theme", isDark ? "dark" : "light");
    });

    // --- コンテンツ読み込み ---
    let articles = [];

    Promise.all(files.map(file => fetch(file).then(res => {
        if (!res.ok) throw new Error(`Failed to load ${file}`);
        return res.text();
    })))
    .then(htmlContents => {
        const fullHtml = htmlContents.join('');
        parseAndIndexContent(fullHtml);
        router();
    })
    .catch(err => {
        console.error(err);
        contentArea.innerHTML = `<div class="error-msg" style="padding: 2rem; text-align: center;">
            <h3>読み込みエラー</h3>
            <p>コンテンツを読み込めませんでした。</p>
        </div>`;
    });

    function parseAndIndexContent(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const targetSelector = 'section[id], article[id]';
        const allElements = Array.from(doc.querySelectorAll(targetSelector));
        
        articles = allElements.map((el, index) => {
            const titleEl = el.querySelector('h1, h2, h3');
            const title = titleEl ? titleEl.textContent.trim() : '無題';
            const id = el.id;
            const level = titleEl ? parseInt(titleEl.tagName.substring(1)) : 2;

            const clone = el.cloneNode(true);
            const nestedTargets = clone.querySelectorAll(targetSelector);
            nestedTargets.forEach(child => child.remove());
            
            const content = clone.innerHTML;
            
            return { index, id, title, level, content };
        });

        generateTOC();
    }

    function generateTOC() {
        let html = '<ul>';
        articles.forEach(article => {
            const indentClass = `level-${article.level}`;
            html += `<li class="${indentClass}">
                <a href="#${article.id}" onclick="closeDrawer()">
                    ${article.title}
                </a>
            </li>`;
        });
        html += '</ul>';
        tocList.innerHTML = html;
    }

    window.addEventListener('hashchange', router);

    function router() {
        const hash = window.location.hash.substring(1);
        
        if (!hash) {
            if(articles.length > 0) renderArticle(articles[0]);
        } else {
            const targetArticle = articles.find(a => a.id === hash);
            if (targetArticle) renderArticle(targetArticle);
            else contentArea.innerHTML = '<p style="padding:2rem;">指定された記事が見つかりません。</p>';
        }
        window.scrollTo(0, 0);
    }

    function renderArticle(article) {
        const prev = articles[article.index - 1];
        const next = articles[article.index + 1];

        let html = `
            <article class="blog-post fade-in">
                <div class="post-content">
                    ${article.content}
                </div>
            </article>
            
            <nav class="post-nav">
                ${prev ? `<a href="#${prev.id}" class="nav-card prev">
                    <span class="label">前の記事</span>
                    <span class="title">${prev.title}</span>
                </a>` : '<span></span>'}
                
                ${next ? `<a href="#${next.id}" class="nav-card next">
                    <span class="label">次の記事</span>
                    <span class="title">${next.title}</span>
                </a>` : '<span></span>'}
            </nav>
        `;
        contentArea.innerHTML = html;
    }

    // --- メニュー操作 ---
    const menuBtn = document.getElementById('menu-btn');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    // const drawer = document.getElementById('drawer-nav');
    // const overlay = document.getElementById('drawer-overlay');

    function openDrawer() {
        drawer.classList.add('open');
        overlay.classList.add('open');
    }
    // グローバルスコープに登録してHTML側から呼べるようにする
    window.closeDrawer = function() { 
        drawer.classList.remove('open');
        overlay.classList.remove('open');
    };

    menuBtn.addEventListener('click', openDrawer);
    closeMenuBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
});