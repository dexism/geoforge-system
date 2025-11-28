// rulebook.js

document.addEventListener('DOMContentLoaded', () => {
    // 読み込むファイルリスト (sectionsフォルダ内のパス)
    const files = [
        'sections/01_introduction.html',
        'sections/02_player.html',
        'sections/03_teller.html',
        'sections/04_scenario.html',
        'sections/05_data.html'
    ];

    const contentArea = document.getElementById('content-area');
    const tocList = document.getElementById('toc-list');
    
    // ナビゲーション関連
    const drawer = document.getElementById('drawer-nav');
    const overlay = document.getElementById('drawer-overlay');
    const menuBtn = document.getElementById('menu-btn');
    const closeMenuBtn = document.getElementById('close-menu-btn');
    const homeBtn = document.getElementById('home-btn');

    // ツール・検索関連
    const tlToolBtn = document.getElementById('tl-tool-btn');
    const tlModal = document.getElementById('tl-modal');
    const searchBtn = document.getElementById('search-btn');
    const searchModal = document.getElementById('search-modal');
    const searchInput = document.getElementById('search-input');
    const searchResults = document.getElementById('search-results');
    const closeModalBtns = document.querySelectorAll('.close-modal');

    // テーマ関連
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = themeToggle.querySelector('span');

    let articles = [];

    // --- 1. 最終更新日時の設定 ---
    const lastUpdateEl = document.getElementById('last-update');
    if (lastUpdateEl) {
        lastUpdateEl.textContent = document.lastModified;
    }

    // --- 2. テーマ設定の初期化 ---
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

    // --- 3. データ読み込みと初期化 ---
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
        contentArea.innerHTML = '<div class="error-msg"><p>コンテンツを読み込めませんでした。</p></div>';
    });

    // --- 4. HTML解析とインデックス化 ---
    function parseAndIndexContent(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        // IDを持つ section, article を記事単位として抽出
        const targetSelector = 'section[id], article[id]';
        const allElements = Array.from(doc.querySelectorAll(targetSelector));
        
        articles = allElements.map((el, index) => {
            const titleEl = el.querySelector('h1, h2, h3');
            const title = titleEl ? titleEl.textContent.trim() : '無題';
            const id = el.id;
            const level = titleEl ? parseInt(titleEl.tagName.substring(1)) : 2;
            
            // data-tags 属性を取得
            const tagsAttr = el.getAttribute('data-tags');
            const tags = tagsAttr ? tagsAttr.split(',').map(t => t.trim()) : [];

            // ネストされた子要素を除去して、この記事自体のコンテンツだけにする
            const clone = el.cloneNode(true);
            clone.querySelectorAll(targetSelector).forEach(child => child.remove());
            const content = clone.innerHTML;
            
            return { index, id, title, level, content, tags };
        });

        generateTOC();
    }

    // --- 5. ルーティング処理 ---
    function router() {
        const hash = window.location.hash.substring(1);
        closeAllModals(); // 画面遷移時にモーダルを閉じる
        
        if (!hash) {
            renderHome(); // ホーム画面
        } else {
            const targetArticle = articles.find(a => a.id === hash);
            if (targetArticle) {
                renderArticle(targetArticle);
            } else {
                contentArea.innerHTML = '<p style="padding:2rem;">指定されたページが見つかりません。</p>';
            }
        }
        window.scrollTo(0, 0);
    }

    // --- 6. ホーム画面の描画 ---
    function renderHome() {
        const html = `
            <div class="home-view fade-in">
                <div class="home-hero">
                    <h2>Venture of Tales TRPG</h2>
                    <p>運命を刻む元帳へようこそ。<br>経営と冒険が交差する物語を始めましょう。</p>
                </div>

                <div class="home-section-title">目的から探す</div>
                <div class="home-grid">
                    <div class="home-card accent" onclick="location.hash='#hajimeni'">
                        <div class="icon"><span class="material-icons-round">emoji_people</span></div>
                        <div class="text">
                            <h3>はじめての方へ</h3>
                            <p>ゲームの概要、世界観、遊び方の流れ</p>
                        </div>
                    </div>
                    <div class="home-card" onclick="location.hash='#create-char'">
                        <div class="icon"><span class="material-icons-round">person_add</span></div>
                        <div class="text">
                            <h3>キャラクター作成</h3>
                            <p>履歴書（CS）の書き方、能力値の決定</p>
                        </div>
                    </div>
                </div>

                <div class="home-section-title">ルール・データ</div>
                <div class="home-grid three-col">
                    <div class="home-card" onclick="location.hash='#keiei'">
                        <div class="icon"><span class="material-icons-round">store</span></div>
                        <h3>経営ルール</h3>
                    </div>
                    <div class="home-card" onclick="location.hash='#trpg-part'">
                        <div class="icon"><span class="material-icons-round">sports_sword</span></div>
                        <h3>冒険ルール</h3>
                    </div>
                    <div class="home-card" onclick="location.hash='#data-section'">
                        <div class="icon"><span class="material-icons-round">library_books</span></div>
                        <h3>データ一覧</h3>
                    </div>
                </div>

                <div class="home-section-title">テラー (TL) 向け</div>
                <div class="home-grid">
                    <div class="home-card dark" onclick="location.hash='#teller-section'">
                        <div class="icon"><span class="material-icons-round">auto_stories</span></div>
                        <div class="text">
                            <h3>TLガイド</h3>
                            <p>マスタリングの手引き、NPC作成</p>
                        </div>
                    </div>
                    <div class="home-card dark" onclick="location.hash='#scenario-section'">
                        <div class="icon"><span class="material-icons-round">map</span></div>
                        <div class="text">
                            <h3>シナリオ集</h3>
                            <p>サンプルシナリオ、キャンペーン構成</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        contentArea.innerHTML = html;
    }

    // --- 7. 記事詳細の描画 ---
    function renderArticle(article) {
        // 関連記事の特定（タグの一致数が多いものを3件）
        let relatedArticles = [];
        if (article.tags.length > 0) {
            relatedArticles = articles
                .filter(a => a.id !== article.id)
                .map(a => {
                    const matchCount = a.tags.filter(tag => article.tags.includes(tag)).length;
                    return { ...a, matchCount };
                })
                .filter(a => a.matchCount > 0)
                .sort((a, b) => b.matchCount - a.matchCount)
                .slice(0, 3);
        }

        const prev = articles[article.index - 1];
        const next = articles[article.index + 1];

        // 関連記事HTML
        let relatedHtml = '';
        if (relatedArticles.length > 0) {
            relatedHtml = `
                <div class="related-area">
                    <h4><span class="material-icons-round">link</span> 関連する項目</h4>
                    <div class="related-list">
                        ${relatedArticles.map(a => `
                            <a href="#${a.id}" class="related-link">
                                <span class="title">${a.title}</span>
                                <span class="tags">${a.tags.map(t => `#${t}`).join(' ')}</span>
                            </a>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        let html = `
            <article class="blog-post fade-in">
                <div class="post-header">
                    <h1 class="post-title">${article.title}</h1>
                    ${article.tags.length > 0 ? 
                        `<div class="post-tags">
                            ${article.tags.map(tag => `<span class="tag-chip">#${tag}</span>`).join('')}
                        </div>` : ''}
                </div>
                <div class="post-content">
                    ${article.content}
                </div>
                ${relatedHtml}
            </article>
            
            <nav class="post-nav">
                ${prev ? `<a href="#${prev.id}" class="nav-card prev">
                    <span class="label">前の項目</span><span class="title">${prev.title}</span>
                </a>` : '<span></span>'}
                ${next ? `<a href="#${next.id}" class="nav-card next">
                    <span class="label">次の項目</span><span class="title">${next.title}</span>
                </a>` : '<span></span>'}
            </nav>
        `;
        contentArea.innerHTML = html;
    }

    // --- 8. 目次生成 ---
    function generateTOC() {
        let html = '<ul>';
        articles.forEach(article => {
            const indentClass = `level-${article.level}`;
            html += `<li class="${indentClass}"><a href="#${article.id}" onclick="closeDrawer()">${article.title}</a></li>`;
        });
        html += '</ul>';
        tocList.innerHTML = html;
    }

    // --- 9. モーダル制御・検索 ---
    function closeAllModals() {
        searchModal.classList.remove('active');
        tlModal.classList.remove('active');
    }

    const performSearch = (query) => {
        if (!query) { searchResults.innerHTML = ''; return; }
        const results = articles.filter(a => 
            a.title.includes(query) || 
            a.content.includes(query) ||
            a.tags.some(t => t.includes(query))
        );
        
        if (results.length === 0) {
            searchResults.innerHTML = '<p>見つかりません</p>';
        } else {
            searchResults.innerHTML = results.map(a => {
                // 本文の抜粋を作る
                const text = a.content.replace(/<[^>]+>/g, "");
                const idx = text.indexOf(query);
                const snippet = idx > -1 ? text.substring(idx - 10, idx + 40) + "..." : text.substring(0, 50) + "...";
                
                return `
                    <a href="#${a.id}" class="search-result-item" onclick="closeAllModals()">
                        <small>${a.title}</small>
                        <p>${snippet}</p>
                    </a>
                `;
            }).join('');
        }
    };

    // イベント登録
    homeBtn.addEventListener('click', () => { location.hash = ''; });
    menuBtn.addEventListener('click', () => { drawer.classList.add('open'); overlay.classList.add('open'); });
    closeMenuBtn.addEventListener('click', window.closeDrawer);
    overlay.addEventListener('click', window.closeDrawer);

    tlToolBtn.addEventListener('click', () => { tlModal.classList.add('active'); });
    searchBtn.addEventListener('click', () => { 
        searchModal.classList.add('active');
        setTimeout(() => searchInput.focus(), 100);
    });
    closeModalBtns.forEach(btn => btn.addEventListener('click', closeAllModals));
    
    // モーダル背景クリック
    window.onclick = function(event) {
        if (event.target == searchModal || event.target == tlModal) {
            closeAllModals();
        }
    }

    searchInput.addEventListener('input', (e) => performSearch(e.target.value));
    
    // ハッシュ変更監視
    window.addEventListener('hashchange', router);

    // グローバル関数定義 (onclick属性用)
    window.closeDrawer = function() {
        drawer.classList.remove('open');
        overlay.classList.remove('open');
    };
    window.closeAllModals = closeAllModals;
});