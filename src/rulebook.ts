
export { };

interface Article {
    index: number;
    id: string;
    title: string;
    level: number;
    content: string;
    tags: string[];
    matchCount?: number;
}

interface TooltipTerm {
    word: string;
    desc: string;
}

// グローバルスコープを拡張
declare global {
    interface Window {
        closeDrawer: () => void;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 読み込むファイルリスト
    const files = [
        './sections/01_introduction.html',
        './sections/02_player.html',
        './sections/03_teller.html',
        './sections/04_scenario.html',
        './sections/05_data.html'
    ];

    const contentArea = document.getElementById('content-area') as HTMLElement;
    const tocList = document.getElementById('toc-list') as HTMLElement;

    // ナビゲーション関連
    const drawer = document.getElementById('drawer-nav') as HTMLElement;
    const overlay = document.getElementById('drawer-overlay') as HTMLElement;
    const menuBtn = document.getElementById('menu-btn') as HTMLElement;
    const closeMenuBtn = document.getElementById('close-menu-btn') as HTMLElement;
    const homeBtn = document.getElementById('home-btn') as HTMLElement;

    // ツール・検索関連
    const tlToolBtn = document.getElementById('tl-tool-btn') as HTMLElement;
    const tlModal = document.getElementById('tl-modal') as HTMLElement;
    const searchBtn = document.getElementById('search-btn') as HTMLElement;
    const searchModal = document.getElementById('search-modal') as HTMLElement;
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const searchResults = document.getElementById('search-results') as HTMLElement;
    const closeModalBtns = document.querySelectorAll('.close-modal');

    // テーマ関連
    const themeToggle = document.getElementById('theme-toggle') as HTMLElement;
    const themeIcon = themeToggle.querySelector('span') as HTMLElement;

    let articles: Article[] = [];
    let tooltipTerms: TooltipTerm[] = [];

    // --- [追加] 戻るボタンの生成と制御 ---
    const backBtn = document.createElement('button');
    backBtn.id = 'back-to-top';
    backBtn.innerHTML = '<span class="material-icons-round">arrow_upward</span>';
    backBtn.title = "ページトップへ戻る";
    document.body.appendChild(backBtn);

    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            backBtn.classList.add('visible');
        } else {
            backBtn.classList.remove('visible');
        }
    });

    backBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // --- ドロワー閉じる関数 ---
    function closeDrawer() {
        if (drawer) drawer.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
    }
    window.closeDrawer = closeDrawer;

    // --- モーダル閉じる関数 ---
    function closeAllModals() {
        if (searchModal) searchModal.classList.remove('active');
        if (tlModal) tlModal.classList.remove('active');
    }

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
        if (themeIcon) themeIcon.textContent = "light_mode";
    } else {
        document.body.classList.remove("dark-mode");
        if (themeIcon) themeIcon.textContent = "dark_mode";
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            if (themeIcon) themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
            localStorage.setItem("theme", isDark ? "dark" : "light");
        });
    }

    // --- [置換] データ読み込み〜解析ロジック ---

    // 初期化関数（JSONとHTMLを非同期で読み込む）
    const init = async () => {
        try {
            // rulebook.json の読み込み
            try {
                const jsonRes = await fetch('./rulebook.json');
                if (jsonRes.ok) {
                    const jsonData = await jsonRes.json();
                    tooltipTerms = jsonData.tooltips || [];
                }
            } catch (e) {
                console.warn('rulebook.json load failed:', e);
            }

            // HTMLコンテンツの読み込み
            const htmlResponses = await Promise.all(files.map(file => fetch(file)));
            const htmlContents = await Promise.all(htmlResponses.map(res => {
                if (!res.ok) throw new Error('File load failed');
                return res.text();
            }));

            const fullHtml = htmlContents.join('');
            parseAndIndexContent(fullHtml);
            router();

        } catch (err) {
            console.error(err);
            if (contentArea) contentArea.innerHTML = '<div class="error-msg"><p>コンテンツを読み込めませんでした。</p></div>';
        }
    };
    init(); // 実行

    // HTML解析とインデックス化
    function parseAndIndexContent(html: string) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const targetSelector = 'section[id], article[id]';
        const allElements = Array.from(doc.querySelectorAll(targetSelector));

        articles = allElements.map((el, index) => {
            const titleEl = el.querySelector('h1, h2, h3');
            const title = titleEl ? titleEl.textContent?.trim() || '無題' : '無題';
            const id = el.id;
            const level = titleEl ? parseInt(titleEl.tagName.substring(1)) : 2;

            const tagsAttr = el.getAttribute('data-tags');
            const tags = tagsAttr ? tagsAttr.split(',').map(t => t.trim()) : [];

            const clone = el.cloneNode(true) as HTMLElement;
            clone.querySelectorAll(targetSelector).forEach(child => child.remove());

            let content = clone.innerHTML;

            // ツールチップ置換処理
            if (tooltipTerms.length > 0) {
                tooltipTerms.forEach(term => {
                    // 正規表現: アルファベットに囲まれていない単語のみヒットさせる
                    // (?<![a-zA-Z]) : 直前がアルファベットでない
                    // (?![a-zA-Z])  : 直後がアルファベットでない
                    // (?![^<]*>)    : HTMLタグ内を除外
                    const escapedWord = term.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    // Lookbehind support varies, but this is client-side code running on modern browsers (per user environment)
                    // If target is older, warnings might occur. TypeScript doesn't polyfill regex.
                    // Keep as is.
                    try {
                        const regex = new RegExp(`(?<![a-zA-Z])(${escapedWord})(?![a-zA-Z])(?![^<]*>)`, 'g');
                        content = content.replace(regex, `<span class="tooltip" data-tip="${term.desc}">$1</span>`);
                    } catch (e) {
                        // Safari might assume no lookbehind support in older versions, fallback basic replace if needed
                        // But Chrome/Edge/Firefox supports it.
                        // Simple replace fallback logic is risky for HTML tags, skipping complex regex if fails.
                        content = content.replace(new RegExp(escapedWord, 'g'), `<span class="tooltip" data-tip="${term.desc}">${term.word}</span>`);
                    }
                });
            }

            return { index, id, title, level, content, tags };
        });

        generateTOC();
    }

    // --- 5. ルーティング処理 ---
    function router() {
        const hash = window.location.hash.substring(1);
        closeAllModals();
        closeDrawer();

        if (!hash) {
            renderHome();
        } else {
            const targetArticle = articles.find(a => a.id === hash);
            if (targetArticle) {
                renderArticle(targetArticle);
            } else {
                if (contentArea) contentArea.innerHTML = '<p style="padding:2rem;">指定されたページが見つかりません。</p>';
            }
        }
        window.scrollTo(0, 0);
    }

    // --- 6. ホーム画面の描画 ---
    function renderHome() {
        if (!contentArea) return;
        const html = `
            <div class="home-view fade-in">
                <div class="home-hero">
                    <p class="sub-title">運命を刻む元帳</p>
                    <h2>ベンチャー of テイルズ TRPG</h2>
                    <p>経営と冒険が交差する物語を始めましょう。</p>
                </div>

                <!-- 追加: ゲーム紹介とサイトの使い方 -->
                <div class="home-introduction">
                    <div class="intro-card main-desc">
                        <h3><span class="material-icons-round">auto_awesome</span> 経営 × 冒険のハイブリッドTRPG</h3>
                        <p>『ベンチャー of テイルズ』は、セッションのない日にスマホで進める<strong>「経営SLGパート」</strong>と、仲間と集まって挑む<strong>「TRPG冒険パート」</strong>を往復して遊ぶ、新しいスタイルのゲームです。<br>あなたがスキマ時間で育てた会社の資産や人脈が、冒険の最大の武器となります。</p>
                    </div>
                    
                    <div class="intro-card site-guide">
                        <h4><span class="material-icons-round">help_outline</span> このサイト（ルールブック）の使い方</h4>
                        <ul>
                            <li><strong>読み進める：</strong>下のカードメニューから、目的に合わせてページを開いてください。</li>
                            <li><strong>探す：</strong>左上の <strong><span class="material-icons-round inline-icon">menu</span> メニュー</strong> から目次を、右上の <strong><span class="material-icons-round inline-icon">search</span> 検索</strong> からキーワードを探せます。</li>
                            <li><strong>遊ぶ：</strong>右上の <strong><span class="material-icons-round inline-icon">build</span> ツール</strong> は、セッション中に役立つ判定表などを素早く表示します。</li>
                        </ul>
                    </div>
                </div>

                <div class="home-section-title">はじめる</div>
                <div class="home-grid">
                    <div class="home-card accent" onclick="location.hash='#intro-top'">
                        <div class="icon"><span class="material-icons-round">emoji_people</span></div>
                        <div class="text">
                            <h3>はじめての方へ</h3>
                            <p>ゲームの概要、世界観、遊び方の流れ</p>
                        </div>
                    </div>
                    <div class="home-card" onclick="location.hash='#player-create'">
                        <div class="icon"><span class="material-icons-round">person_add</span></div>
                        <div class="text">
                            <h3>キャラクター作成</h3>
                            <p>履歴書（CS）の書き方、能力値の決定</p>
                        </div>
                    </div>
                </div>

                <div class="home-section-title">主要ルール（ショートカット）</div>
                <div class="home-grid">
                    <div class="home-card" onclick="location.hash='#data-fate'">
                        <div class="icon"><span class="material-icons-round">auto_awesome</span></div>
                        <div class="text">
                            <h3>運命介入</h3>
                            <p>MPを使って奇跡を起こす</p>
                        </div>
                    </div>
                    <div class="home-card" onclick="location.hash='#data-self-control'">
                        <div class="icon"><span class="material-icons-round">psychology</span></div>
                        <div class="text">
                            <h3>自制心ロール</h3>
                            <p>特徴（欠点）の暴走判定</p>
                        </div>
                    </div>
                </div>

                <div class="home-section-title">ルール・データ</div>
                <div class="home-grid three-col">
                    <div class="home-card" onclick="location.hash='#keiei'">
                        <div class="icon"><span class="material-icons-round">store</span></div>
                        <h3>経営ルール</h3>
                    </div>
                    <div class="home-card" onclick="location.hash='#player-trpg'">
                        <div class="icon"><span class="material-icons-round">explore</span></div>
                        <h3>冒険ルール</h3>
                    </div>
                    <div class="home-card" onclick="location.hash='#data-top'">
                        <div class="icon"><span class="material-icons-round">library_books</span></div>
                        <h3>データ一覧</h3>
                    </div>
                </div>

                <div class="home-section-title">テラー (TL) 向け</div>
                <div class="home-grid">
                    <div class="home-card dark" onclick="location.hash='#teller-top'">
                        <div class="icon"><span class="material-icons-round">auto_stories</span></div>
                        <div class="text">
                            <h3>TLガイド</h3>
                            <p>マスタリングの手引き、NPC作成</p>
                        </div>
                    </div>
                    <div class="home-card dark" onclick="location.hash='#scenario-top'">
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
    function renderArticle(article: Article) {
        if (!contentArea) return;
        let relatedArticles: Article[] = [];
        if (article.tags.length > 0) {
            relatedArticles = articles
                .filter(a => a.id !== article.id)
                .map(a => {
                    const matchCount = a.tags.filter(tag => article.tags.includes(tag)).length;
                    return { ...a, matchCount };
                })
                .filter(a => (a.matchCount || 0) > 0)
                .sort((a, b) => (b.matchCount || 0) - (a.matchCount || 0))
                .slice(0, 3);
        }

        const prev = articles[article.index - 1];
        const next = articles[article.index + 1];

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
        if (!tocList) return;
        let html = '<ul>';
        articles.forEach(article => {
            const indentClass = `level-${article.level}`;
            html += `<li class="${indentClass}"><a href="#${article.id}" onclick="closeDrawer()">${article.title}</a></li>`;
        });
        html += '</ul>';
        tocList.innerHTML = html;
    }

    // --- 9. 検索機能 ---
    const performSearch = (query: string) => {
        if (!searchResults) return;
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

    // --- イベントリスナー登録 ---
    if (homeBtn) homeBtn.addEventListener('click', () => { location.hash = ''; });
    if (menuBtn) menuBtn.addEventListener('click', () => { drawer.classList.add('open'); overlay.classList.add('open'); });
    if (closeMenuBtn) closeMenuBtn.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    if (tlToolBtn) tlToolBtn.addEventListener('click', () => { tlModal.classList.add('active'); });
    if (searchBtn) searchBtn.addEventListener('click', () => {
        searchModal.classList.add('active');
        setTimeout(() => searchInput.focus(), 100);
    });
    closeModalBtns.forEach(btn => btn.addEventListener('click', closeAllModals));

    window.onclick = function (event) {
        if (event.target == searchModal || event.target == tlModal) {
            closeAllModals();
        }
    }

    if (searchInput) searchInput.addEventListener('input', (e) => performSearch((e.target as HTMLInputElement).value));

    window.addEventListener('hashchange', router);
});
