<script>
// =========================================================================
// グローバル変数 & データ定義
// =========================================================================
const ALL_STATS = ["体力", "知力", "魅力", "運動", "芸術", "統御", "創造力", "交渉力", "市場感覚"];
const MAX_SKILL_POINTS = 5;

/**
 * 選択されているスキルの名前を管理するSetオブジェクト。
 * これがアプリケーションにおけるスキル選択の唯一の状態（Single Source of Truth）となります。
 */
const selectedSkills = new Set();

// サーバーから渡されたデータは entrysheet.html 側で定義済み

// =========================================================================
// アプリケーションのエントリーポイント
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
    // --- 1. UIの初期セットアップ ---
    initializeUI();

    // --- 2. イベントリスナーの一括設定 ---
    bindEventListeners();

    // --- 3. アプリケーションの初期状態を計算・表示 ---
    updateAllCalculations();
    
    // --- 4. サーバーからキャラクターリストを読み込む ---
    loadCharacterList();
});

// =========================================================================
// 初期化関数
// =========================================================================

/**
 * ページのUI要素（セレクトボックスやリストなど）を動的に生成する。
 */
function initializeUI() {
    populateLifepathSelects();
    populateSkillList();
    populateFeaturesList();
}

/**
 * ページ上の全てのインタラクティブ要素にイベントリスナーを一度だけ設定する。
 */
function bindEventListeners() {
    // --- ライフパスのイベントリスナー（ランダム選択機能付き） ---
    document.querySelectorAll('.lifepath-select').forEach(select => {
        select.addEventListener('change', (event) => {
            const currentSelect = event.target;

            // 「ランダム」が選択された場合の処理
            if (currentSelect.value === 'random') {
                const options = Array.from(currentSelect.options);
                const validOptions = options.filter(opt => opt.value && opt.value !== 'random' && !opt.disabled);

                if (validOptions.length > 0) {
                    const randomIndex = Math.floor(Math.random() * validOptions.length);
                    const randomChoice = validOptions[randomIndex];
                    currentSelect.value = randomChoice.value;
                }
            }
            // 最終的に必ず能力値の再計算を実行する
            updateAllCalculations();
        });
    });
    
    // --- 特徴のイベントリスナー（これはpopulateFeaturesList内で設定済み） ---
    // ここでは何もしない

    // --- 各種ボタンのイベントリスナー ---
    document.getElementById('save-new-btn').addEventListener('click', saveCharacter);
    document.getElementById('update-btn').addEventListener('click', updateCharacter);
    document.getElementById('clear-btn').addEventListener('click', clearForm);
    document.getElementById('delete-btn').addEventListener('click', deleteCharacter);
    
    // --- すべてのアコーディオンを対象とするイベントリスナー ---
    document.body.addEventListener('click', (event) => {
        // メインのトリガー（ヘッダー）がクリックされた場合
        const trigger = event.target.closest('.accordion-trigger');
        if (trigger) {
            const content = trigger.nextElementSibling;
            if (content && content.classList.contains('accordion-content')) {
                trigger.classList.toggle('active');
                content.classList.toggle('active');
                content.style.maxHeight = trigger.classList.contains('active') ? content.scrollHeight + 'px' : null;
            }
            return; 
        }

        // 「閉じる」ボタンがクリックされた場合
        const closeTrigger = event.target.closest('.accordion-close-trigger');
        if (closeTrigger) {
            const mainTrigger = closeTrigger.closest('.accordion-content')?.previousElementSibling;
            if (mainTrigger && mainTrigger.classList.contains('active')) {
                mainTrigger.click();
            }
        }
    });

    // --- スキル選択のイベントリスナー ---
    const skillListContainer = document.querySelector('.skill-list');
    skillListContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.skill-card');
        if (card) {
            const checkbox = card.querySelector('input[type="checkbox"]');
            if (checkbox && e.target.tagName !== 'INPUT') {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });
    skillListContainer.addEventListener('change', (e) => {
        if (e.target.matches('input[name="skills"]')) {
            handleSkillChange(e);
        }
    });
}

// =========================================================================
// UI生成ヘルパー関数 (populate系)
// =========================================================================

function populateLifepathSelects() {
    for (const key in LIFEPATH_DATA) {
        const selectEl = document.getElementById(`lifepath-${key}`);
        selectEl.classList.add('lifepath-select');
        selectEl.innerHTML = '';
        
        const placeholder = document.createElement('option');
        placeholder.value = "";
        placeholder.textContent = "選択してください";
        selectEl.appendChild(placeholder);

        LIFEPATH_DATA[key].forEach(data => {
            const option = document.createElement('option');
            option.value = data.value;
            option.textContent = data.text;

            const bonus = {};
            if (data.bonus_stat1 && data.bonus_value1) bonus[data.bonus_stat1] = parseInt(data.bonus_value1, 10);
            if (data.bonus_stat2 && data.bonus_value2) bonus[data.bonus_stat2] = parseInt(data.bonus_value2, 10);
            option.dataset.bonus = JSON.stringify(bonus);

            option.dataset.description = data.description;
            selectEl.appendChild(option);
        });

        // 視覚的な区切り線を追加
        const separator = document.createElement('option');
        separator.disabled = true; // 選択できないようにする
        separator.textContent = '──────────';
        selectEl.appendChild(separator);

        // 「ランダム」オプションを追加
        const randomOption = document.createElement('option');
        randomOption.value = 'random'; // JavaScriptで識別するための値
        randomOption.textContent = 'ランダム';
        selectEl.appendChild(randomOption);
    }
}

/**
 * この関数はHTMLの描画のみに責任を持つ。イベントリスナーの登録は行わない。
 */
function populateSkillList() {
    const skillListContainer = document.querySelector('.skill-list');
    skillListContainer.innerHTML = ''; 

    Object.keys(SKILLS).forEach(category => {
        // --- 構造を <div class="accordion">...</div> に変更 ---
        const accordion = document.createElement('div');
        accordion.className = 'accordion';
        
        // --- トリガー部分を作成 ---
        const summary = document.createElement('summary');
        summary.className = 'accordion-trigger';
        summary.innerHTML = `<span class="arrow"></span> ${category}`;
        accordion.appendChild(summary);

        // --- コンテンツ部分を作成 ---
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'accordion-content';
        
        const contentDiv = document.createElement('div'); // 元のcontentDivを内包
        contentDiv.style.padding = "1rem"; // 内側にパディングを設定

        SKILLS[category].forEach(skill => {
            const card = document.createElement('div');
            card.className = 'skill-card';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'skills';
            checkbox.value = skill.name;
            checkbox.setAttribute('data-level', skill.level);
            checkbox.setAttribute('data-r', skill.r);
            checkbox.setAttribute('data-a', skill.a);

            const header = document.createElement('div');
            header.className = 'skill-card-header';

            const h5 = document.createElement('h5');
            h5.textContent = skill.name;

            const span = document.createElement('span');
            const r_val = skill.r >= 0 ? `+${skill.r}` : skill.r;
            const a_val = skill.a >= 0 ? `+${skill.a}` : skill.a;
            span.textContent = `《L ${skill.level} / R ${r_val} / A ${a_val}》`;
            
            const description = document.createElement('p');
            description.className = 'skill-description';
            description.textContent = skill.description;
            header.appendChild(h5);
            header.appendChild(span);
            card.appendChild(checkbox);
            card.appendChild(header);
            card.appendChild(description);
            contentDiv.appendChild(card);
        });
        
        contentWrapper.appendChild(contentDiv);
        
        const closeTrigger = document.createElement('div');
        closeTrigger.className = 'accordion-close-trigger';
        closeTrigger.innerHTML = '▲ 閉じる';
        contentWrapper.appendChild(closeTrigger);

        accordion.appendChild(contentWrapper);
        skillListContainer.appendChild(accordion);
    });
}

function populateFeaturesList() {
    const container = document.getElementById('features-selection-accordions');
    container.innerHTML = ''; 

    Object.keys(FEATURES_DATA).forEach(category => {
        // --- 構造を <div class="accordion">...</div> に変更 ---
        const accordion = document.createElement('div');
        accordion.className = 'accordion';
        
        // --- トリガー部分を作成 ---
        const summary = document.createElement('summary');
        summary.className = 'accordion-trigger';
        summary.innerHTML = `<span class="arrow"></span> ${category}`;
        accordion.appendChild(summary);

        // --- コンテンツ部分を作成 ---
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'accordion-content';
        
        const contentDiv = document.createElement('div'); // 元のcontentDivを内包
        contentDiv.style.padding = "1rem"; // 内側にパディングを設定

        FEATURES_DATA[category].forEach((pair, index) => {
            const pairCard = document.createElement('div');
            pairCard.className = 'feature-pair-card';
            const radioGroupName = `feature_pair_${category}_${index}`;

            // Prime オプション (テンプレートリテラル `...` を使用)
            const primeDiv = document.createElement('div');
            primeDiv.className = 'feature-option prime';
            primeDiv.innerHTML = `
                <input type="radio" name="${radioGroupName}" value="${pair.prime_name}" data-type="prime" data-name="${pair.prime_name}" data-desc="${pair.prime_desc}" data-pro="${pair.prime_pro}" data-con="${pair.prime_con}">
                    <h5>${pair.prime_name}</h5>
                    <p>${pair.prime_desc}</p>
                    <p class="pro"><b>利点:</b> ${pair.prime_pro}</p>
                    <p class="con"><b>欠点:</b> ${pair.prime_con}</p>
            `;
            
            // Fallen オプション (テンプレートリテラル `...` を使用)
            const fallenDiv = document.createElement('div');
            fallenDiv.className = 'feature-option fallen';
            fallenDiv.innerHTML = `
                <input type="radio" name="${radioGroupName}" value="${pair.fallen_name}" data-type="fallen" data-name="${pair.fallen_name}" data-desc="${pair.fallen_desc}" data-pro="${pair.fallen_pro}" data-con="${pair.fallen_con}">
                    <h5>${pair.fallen_name}</h5>
                    <p>${pair.fallen_desc}</p>
                    <p class="pro"><b>利点:</b> ${pair.fallen_pro}</p>
                    <p class="con"><b>欠点:</b> ${pair.fallen_con}</p>
            `;

            pairCard.appendChild(primeDiv);
            pairCard.appendChild(fallenDiv);
            contentDiv.appendChild(pairCard);

            // クリックイベントで選択状態を制御
            [primeDiv, fallenDiv].forEach(div => {
                div.addEventListener('click', () => {
                    const radio = div.querySelector('input');
                    // クリック前の選択状態を保持
                    const wasChecked = radio.checked;

                    // 1. まず、このペアの選択状態をすべてリセットする
                    primeDiv.classList.remove('selected');
                    fallenDiv.classList.remove('selected');
                    primeDiv.querySelector('input').checked = false;
                    fallenDiv.querySelector('input').checked = false;

                    // 2. もしクリック前に選択されていなかった場合、新たに選択状態にする
                    // (既に選択されていた場合は、リセットされたままとなり「選択解除」となる)
                    if (!wasChecked) {
                        div.classList.add('selected');
                        radio.checked = true;
                    }

                    // 3. 変更をUI全体に反映させるため、changeイベントを発火させる
                    // どちらかのラジオボタンから発火させればOK
                    primeDiv.querySelector('input').dispatchEvent(new Event('change'));
                });
            });
        });
        contentWrapper.appendChild(contentDiv);

        const closeTrigger = document.createElement('div');
        closeTrigger.className = 'accordion-close-trigger';
        closeTrigger.innerHTML = '▲ 閉じる';
        contentWrapper.appendChild(closeTrigger);

        accordion.appendChild(contentWrapper);
        container.appendChild(accordion);
    });

    document.querySelectorAll('input[name^="feature_pair_"]').forEach(radio => {
        radio.addEventListener('change', updateSelectedFeatures);
    });
}

// =========================================================================
// 計算とUI更新のコア関数
// =========================================================================

/**
 * ライフパスの変更時に呼び出され、全ての計算をゼロから実行する。
 */
function updateAllCalculations() {
    calculateAndUpdateLifepathStats();
    // スキル関連のUIと計算もすべて更新する
    updateAllSkillRelatedCalculations();
}

/**
 * スキルのチェックボックスが変更されたときに呼び出されるイベントハンドラ。
 * この関数の役割は、ユーザーの操作を検知して状態データ（selectedSkills）を更新し、
 * その後のUI更新処理を呼び出すことだけに限定される。
 */
function handleSkillChange(event) {
    const checkbox = event.target;
    const skillName = checkbox.value;
    const isChecked = checkbox.checked;

    // ▼▼▼ デバッグ出力 ▼▼▼
    // console.group(`[ユーザー操作] スキル変更イベント発生`);
    // console.log(`操作対象: ${skillName}`);
    // console.log(`操作内容: ${isChecked ? '選択' : '選択解除'}`);
    // console.log(`操作前の選択済みスキル:`, new Set(selectedSkills));
    // ▲▲▲ デバッグ出力 ▲▲▲

    // 1. 状態データ（selectedSkills）を更新する
    if (isChecked) {
        selectedSkills.add(skillName);
    } else {
        selectedSkills.delete(skillName);
    }

    // ▼▼▼ デバッグ出力 ▼▼▼
    // console.log(`操作後の選択済みスキル:`, new Set(selectedSkills));
    // console.groupEnd();
    // ▲▲▲ デバッグ出力 ▲▲▲

    // 2. 状態データに基づいて、スキル関連のUIと計算をすべて更新する
    updateAllSkillRelatedCalculations();
}

/**
 * スキルに関連するすべてのUI更新と計算をまとめて実行する関数。
 * 複数の場所から呼び出される共通の処理をここにまとめる。
 */
function updateAllSkillRelatedCalculations() {
    updateSkillsUI();
    calculateAndUpdateRAVector();
    updateSelectedSkills();
}

/**
 * ライフパスに基づいて基礎能力値と商才を計算し、表示を更新する。
 * 商才の二重計上を防ぐため、計算ロジックをより正確なものに変更。
 */
function calculateAndUpdateLifepathStats() {
    // --- ステップ1: ライフパスから得られる全ボーナスを一時的に集計 ---
    const bonuses = {};
    ALL_STATS.forEach(s => bonuses[s] = 0); // 全能力を0で初期化

    document.querySelectorAll('.lifepath-select').forEach(select => {
        if (select.selectedIndex > 0) { // プレースホルダーでないことを確認
            const bonusData = JSON.parse(select.options[select.selectedIndex].dataset.bonus);
            for (const stat in bonusData) {
                bonuses[stat] += bonusData[stat];
            }
        }
    });

    // --- ステップ2: 最終的な能力値を格納するオブジェクトを用意 ---
    const finalStats = {};

    // --- ステップ3: まず「基本ステータス」と「センス」を確定させる ---
    const baseStats = ["体力", "知力", "魅力", "運動", "芸術", "統御"];
    baseStats.forEach(stat => {
        finalStats[stat] = bonuses[stat];
    });

    // --- ステップ4: 確定した基本ステータスを元に、「商才」をゼロから計算する ---
    finalStats["創造力"] = finalStats["知力"] + finalStats["芸術"];
    finalStats["交渉力"] = finalStats["魅力"] + finalStats["統御"];
    finalStats["市場感覚"] = finalStats["体力"] + finalStats["運動"];

    // --- ステップ5: 最後に、商才への直接ボーナスを加算する ---
    // これにより、値が二重計上されるのを防ぐ
    finalStats["創造力"] += bonuses["創造力"];
    finalStats["交渉力"] += bonuses["交渉力"];
    finalStats["市場感覚"] += bonuses["市場感覚"];

    // --- ステップ6: 計算結果をUIに反映させる ---
    ALL_STATS.forEach(stat => {
        document.getElementById(`stat-${stat}`).value = `${stat}: ${finalStats[stat]}`;
    });

    // --- ステップ7: ライフパスの説明文を更新 ---
    updateLifepathDescription('lifepath-birth');
    updateLifepathDescription('lifepath-upbringing');
    updateLifepathDescription('lifepath-trigger');
}

/**
 * 【最終修正】スキルポイントを計算し、表示とカードの状態を更新する。
 * 計算ループ内で重複加算を防ぐロジックを追加。
 */
function updateSkillsUI() {
    console.group(`[計算処理] updateSkillsUI 実行`);
    console.log(`計算開始前の選択済みスキル (これが計算の元データ):`, new Set(selectedSkills));

    let usedPoints = 0;
    const allSkillCheckboxes = document.querySelectorAll('input[name="skills"]');
    
    // 一度処理したスキル名を記録するためのSetを、計算の都度、新規作成する。
    const processedSkills = new Set();
    
    // 1. `selectedSkills`セットを元に使用ポイントを計算する
    selectedSkills.forEach(skillName => {
        // まだこのスキルを加算処理していなければ、処理を行う
        if (!processedSkills.has(skillName)) {
            const checkbox = document.querySelector(`input[name="skills"][value="${skillName}"]`);
            if (checkbox) {
                const skillLevel = Number(checkbox.dataset.level);
                console.log(`  -> ${skillName} (コスト:${skillLevel}) を加算`);
                usedPoints += skillLevel;
                // 処理済みのマークを付ける
                processedSkills.add(skillName);
            }
        }
    });

    console.log(`計算結果: 消費ポイント合計 = ${usedPoints}`);
    
    // 2. 残りスキルポイントの表示を更新する
    const remainingPoints = MAX_SKILL_POINTS - usedPoints;
    document.getElementById('skill-points-tracker').textContent = `残りスキルポイント: ${remainingPoints} / ${MAX_SKILL_POINTS}`;
    
    console.log(`表示更新: 残りポイントを ${remainingPoints} に設定`);
    console.groupEnd();

    // 3. 全てのスキルカードのUI状態（選択、無効化）を、データに基づいて正しく設定する
    allSkillCheckboxes.forEach(checkbox => {
        const isSelected = selectedSkills.has(checkbox.value);
        const card = checkbox.closest('.skill-card');

        checkbox.checked = isSelected;
        card.classList.toggle('selected', isSelected);
        
        const isDisabled = !isSelected && (usedPoints + Number(checkbox.dataset.level) > MAX_SKILL_POINTS);
        checkbox.disabled = isDisabled;
        card.classList.toggle('disabled', isDisabled);
    });
}

/**
 * RAベクトルを計算し、表示とグラフを更新する。
 * ライフパスから算出される基礎能力値を元に、RAベクトルの基礎値を計算するロジックを追加。
 */
function calculateAndUpdateRAVector() {
    // --- ステップ1: 基礎能力値の入力欄から値を取得 ---
    // "能力値: X" という文字列から数値部分を安全に抜き出すためのヘルパー関数
    const getStatValue = (statName) => {
        const inputElement = document.getElementById(`stat-${statName}`);
        if (inputElement && inputElement.value) {
            // "体力: 1" のような文字列を ":" で分割し、後半の数値を返す
            const valuePart = inputElement.value.split(':')[1];
            return parseInt(valuePart, 10) || 0; // 数値に変換できない場合は0を返す
        }
        return 0;
    };

    // --- ステップ2: 仕様書通りにRAベクトルの「基礎値」を計算 ---
    const baseVectorR = getStatValue('体力') - getStatValue('知力');
    const baseVectorA = getStatValue('統御') - getStatValue('魅力');

    // --- ステップ3: 選択済みスキルから「補正値」を計算（既存のロジック） ---
    let skillModifierR = 0;
    let skillModifierA = 0;
    
    selectedSkills.forEach(skillName => {
        const checkbox = document.querySelector(`input[name="skills"][value="${skillName}"]`);
        if (checkbox) {
            skillModifierR += Number(checkbox.dataset.r);
            skillModifierA += Number(checkbox.dataset.a);
        }
    });
    
    // --- ステップ4: 「基礎値」と「補正値」を合算して最終的なRAベクトルを決定 ---
    const finalVectorR = baseVectorR + skillModifierR;
    const finalVectorA = baseVectorA + skillModifierA;

    // --- ステップ5: 計算結果をUIに反映（既存のロジック） ---
    document.getElementById('stat-vector-r').textContent = finalVectorR;
    document.getElementById('stat-vector-a').textContent = finalVectorA;
    const position = getPosition(finalVectorR, finalVectorA);
    document.getElementById('stat-position').textContent = position;
    updateVectorChart(finalVectorR, finalVectorA, position);
}

// =========================================================================
// UI更新ヘルパー関数 (update系)
// =========================================================================

/**
 * 選択されたライフパスの説明文を表示する。
 * 説明文の先頭に、その項目名と得られる能力値ボーナスを追記する。
 */
function updateLifepathDescription(selectId) {
    const selectEl = document.getElementById(selectId);
    const descEl = document.getElementById(`${selectId}-desc`);
    
    // 何も選択されていない場合（selectedIndexが0または-1）は説明欄を空にする
    if (selectEl.selectedIndex <= 0) {
        descEl.textContent = '';
        return; // ここで処理を終了
    }

    const selectedOption = selectEl.options[selectEl.selectedIndex];
    
    // --- 1. 必要な情報をデータ属性から取得 ---
    const description = selectedOption.dataset.description || '';
    const itemName = selectedOption.textContent; // 例: "農村の子"
    const bonusData = JSON.parse(selectedOption.dataset.bonus); // 例: { "体力": 1, "運動": 1 }

    // --- 2. ボーナスデータのキー（能力値名）を配列に変換 ---
    //    Object.keys(bonusData) で ["体力", "運動"] という配列を取得
    const bonusStats = Object.keys(bonusData);

    // --- 3. 新しい形式のテキストを組み立てる ---
    //    ボーナスが存在する場合のみ《》を付けて表示する
    const bonusText = bonusStats.length > 0 ? `《${bonusStats.join(', ')}》` : '';
    const headerText = `<h5>【${itemName}】<small>${bonusText}</small></h5>`;
    
    // --- 4. 組み立てたテキストを要素に設定 ---
    // textContentは改行コード(\n)をスペースとして扱ってしまうため、
    // 改行を正しく解釈するinnerTextプロパティを使用します。
    // descEl.innerText = `${headerText}\n${description}`;
    descEl.innerHTML = `${headerText}<p>${description}</p>`;
}

function updateSelectedFeatures() {
  const listContainer = document.getElementById('selected-features-list');
  listContainer.innerHTML = ''; // 表示をクリア

  const selectedRadios = document.querySelectorAll('input[name^="feature_pair_"]:checked');

  if (selectedRadios.length === 0) {
    listContainer.innerHTML = '<p>特徴を選択すると、ここに表示されます。</p>';
    return;
  }

  selectedRadios.forEach(radio => {
    const data = radio.dataset;
    const card = document.createElement('div');
    card.className = `selected-feature-card ${data.type}-card`;
    
    card.innerHTML = `
      <h5>${data.name}</h5>
      <p>${data.desc}</p>
      <p class="pro"><b>利点:</b> ${data.pro}</p>
      <p class="con"><b>欠点:</b> ${data.con}</p>
    `;
    listContainer.appendChild(card);
  });
}

/**
 * 【変更】選択済みスキルをリスト表示する。
 * DOMのチェック状態（:checked）ではなく、状態データ（selectedSkills）に基づいて表示を生成する。
 */
function updateSelectedSkills() {
    const listContainer = document.getElementById('selected-skills-list');
    listContainer.innerHTML = '';

    // データセットが空かどうかで判断
    if (selectedSkills.size === 0) {
        listContainer.innerHTML = '<p>スキルを選択すると、ここに表示されます。</p>';
        return;
    }

    // データセットをループして表示を生成
    selectedSkills.forEach(skillName => {
        const checkbox = document.querySelector(`input[name="skills"][value="${skillName}"]`);
        if (checkbox) {
            const card = checkbox.closest('.skill-card').cloneNode(true);
            card.classList.remove('selected'); // 枠線を解除
            card.style.cursor = 'default';
            card.style.transform = 'none';
            card.onclick = null; // クリックイベントを解除
            listContainer.appendChild(card);
        }
    });
}

function updateVectorChart(r, a, position) { // positionを引数で受け取るように変更
    const point = document.getElementById('vector-point');
    const positionText = document.getElementById('position-text');
    const maxVectorValue = 10;
    const x = Math.max(-maxVectorValue, Math.min(maxVectorValue, r));
    const y = Math.max(-maxVectorValue, Math.min(maxVectorValue, a));
    point.style.left = `${50 + (x / maxVectorValue) * 50}%`;
    point.style.top = `${50 - (y / maxVectorValue) * 50}%`;
    positionText.textContent = position;
}

// =========================================================================
// データ計算・フォーム操作
// =========================================================================

function getPosition(r, a) {
    // 1. 【最優先】器用貧乏フレックスの条件を判定
    // RとAが両方とも原点から±1の範囲内かチェック
    if (r >= -1 && r <= 1 && a >= -1 && a <= 1) {
        return "器用貧乏フレックス";
    }

    // 2. 次に、「特化ポジション」の条件を判定
    // 武闘特化 (R軸プラス)
    if (r > 3 && a >= -1 && a <= 1) {
        return "剛腕のフィクサー";
    }
    // 知略特化 (R軸マイナス)
    if (r < -3 && a >= -1 && a <= 1) {
        return "知恵のコンサルタント";
    }
    // アクティブ特化 (A軸プラス)
    if (a > 3 && r >= -1 && r <= 1) {
        return "行動のエージェント";
    }
    // パッシブ特化 (A軸マイナス)
    if (a < -3 && r >= -1 && r <= 1) {
        return "礎のアンカー";
    }

    // 3. 上記のいずれでもなければ、「象限ポジション」を判定
    if (r > 0 && a > 0) return "脳筋ストライカー";
    if (r < 0 && a > 0) return "千手のトリックスター";
    if (r < 0 && a < 0) return "策士オラクル";
    if (r > 0 && a < 0) return "挑発ヴァンガード";
    
    // 4. (念のため) どの条件にも当てはまらない場合のデフォルト値を設定
    // 基本的に、象限判定でカバーされるため、ここには到達しないはず
    return "器用貧乏フレックス";
}

/**
 * 【変更】フォームから現在のキャラクターデータを収集する。
 * スキル情報はDOMではなく、状態データ（selectedSkills）から取得する。
 */
function getFormData() {
    console.log("--- getFormData() 開始 ---");

    try {
        console.log("Reading skills...");
        const skills = Array.from(selectedSkills);

        console.log("Reading stats...");
        const stats = {};
        ALL_STATS.forEach(stat => {
            const statElement = document.getElementById(`stat-${stat}`);
            if (!statElement) {
                console.error(`Error: Element with ID 'stat-${stat}' not found!`);
                stats[stat] = '0'; // エラーでも処理を続けるためにデフォルト値を入れる
            } else {
                const statValue = statElement.value.split(': ')[1];
                stats[stat] = statValue !== undefined ? statValue : '0';
            }
        });

        console.log("Reading features...");
        const selectedFeatures = Array.from(document.querySelectorAll('input[name^="feature_pair_"]:checked')).map(r => r.value);
        
        // ▼▼▼ CONSOLE ▼▼▼
        console.log("Reading character-id-hidden...");
        const idElement = document.getElementById('character-id-hidden');
        if (!idElement) {
            console.error("CRITICAL ERROR: Element with ID 'character-id-hidden' NOT FOUND!");
            // この要素がないと後続の処理ができないため、ここで例外を投げて止める
            throw new Error("'character-id-hidden' element is missing.");
        }
        const characterId = idElement.value;
        console.log(`Success: characterId = ${characterId}`);
        // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

        console.log("Reading other fields...");
        const formData = {
            id: characterId,
            playerName: document.getElementById('player-name').value,
            charName: document.getElementById('char-name').value,
            birth: document.getElementById('lifepath-birth').value,
            upbringing: document.getElementById('lifepath-upbringing').value,
            trigger: document.getElementById('lifepath-trigger').value,
            skills: skills,
            stats: stats,
            vectorR: document.getElementById('stat-vector-r').textContent,
            vectorA: document.getElementById('stat-vector-a').textContent,
            position: document.getElementById('stat-position').textContent,
            nickname: document.getElementById('nickname').value,
            useNickname: document.getElementById('use-nickname').checked,
            credit: document.getElementById('fuhyo-credit').value.split(': ')[1] || '0',
            fame: document.getElementById('fuhyo-fame').value.split(': ')[1] || '0',
            notoriety: document.getElementById('fuhyo-notoriety').value.split(': ')[1] || '0',
            features: selectedFeatures,
        };
        
        console.log("--- getFormData() 正常終了 ---");
        return formData;

    } catch (e) {
        console.error("FATAL ERROR in getFormData:", e);
        // エラーが発生した場合、GASに送るデータが不完全になるのを防ぐ
        throw e; 
    }
}

/**
 * サーバーから読み込んだデータに基づいてフォームの値を設定する。
 */
function setFormData(data) {
    // --- 1. IDを含むテキスト・セレクトボックスの値を設定 ---
    document.getElementById('character-id-hidden').value = data.id || '';
    document.getElementById('player-name').value = data.playerName || '';
    document.getElementById('char-name').value = data.charName || '';
    document.getElementById('nickname').value = data.nickname || '';
    document.getElementById('use-nickname').checked = data.useNickname || false;
    document.getElementById('fuhyo-credit').value = `信用: ${data.credit || 0}`;
    document.getElementById('fuhyo-fame').value = `名声: ${data.fame || 0}`;
    document.getElementById('fuhyo-notoriety').value = `悪名: ${data.notoriety || 0}`;
    document.getElementById('lifepath-birth').value = data.birth || '';
    document.getElementById('lifepath-upbringing').value = data.upbringing || '';
    document.getElementById('lifepath-trigger').value = data.trigger || '';
    
    // --- 2. 特徴のラジオボタンを設定 ---
    document.querySelectorAll('.feature-option').forEach(div => div.classList.remove('selected'));
    document.querySelectorAll('input[name^="feature_pair_"]').forEach(radio => {
        radio.checked = (data.features || []).includes(radio.value);
        if (radio.checked) {
            radio.parentElement.classList.add('selected');
        }
    });
    updateSelectedFeatures();

    // --- 3. スキル選択状態をデータから復元 ---
    selectedSkills.clear();
    (data.skills || []).forEach(skillName => {
        selectedSkills.add(skillName);
    });

    // --- 4. 最後に "すべて" の計算をトリガーする ---
    // これにより、設定されたライフパスの値に基づいて基礎能力値が計算され、
    // スキル関連の表示も正しく更新される。
    updateAllCalculations();

    // --- 5. ボタンの表示状態を更新 ---
    document.getElementById('update-btn').style.display = 'inline-block';
    document.getElementById('delete-btn').style.display = 'inline-block';
    document.getElementById('save-new-btn').style.display = 'none';
}


/**
 * フォーム全体を初期状態にリセットする。
 */
function clearForm() {
    // 1. まず<form>要素のreset()を呼び出して、入力欄や選択をデフォルトに戻す
    document.getElementById('character-sheet').reset();

    // 2. 状態管理データをクリアする
    selectedSkills.clear();

    // 3. reset()ではクリアできないカスタム要素や表示を手動でリセットする
    document.getElementById('character-id-hidden').value = ''; 
    document.querySelectorAll('.feature-option').forEach(div => div.classList.remove('selected'));
    updateSelectedFeatures();
    document.getElementById('fuhyo-credit').value = "信用: 0";
    document.getElementById('fuhyo-fame').value = "名声: 0";
    document.getElementById('fuhyo-notoriety').value = "悪名: 0";

    // 4. 全ての計算を初期状態に戻す
    updateAllCalculations();
    
    // 5. ボタンの表示状態を初期化
    document.getElementById('update-btn').style.display = 'none';
    document.getElementById('delete-btn').style.display = 'none';
    document.getElementById('save-new-btn').style.display = 'inline-block';
    
    window.scrollTo(0, 0);
}

// =========================================================================
// Google Apps Script連携
// =========================================================================
/**
 * サーバー(コード.gs)に問い合わせ、保存されているキャラクターのリストを取得して画面に表示します。
 * この関数は、ページの初回読み込み時、キャラクターの新規保存後、削除後に呼び出されます。
 */
function loadCharacterList() {
    const listElement = document.getElementById('char-list');
    const loaderElement = document.getElementById('loader');
    const contentElement = document.getElementById('char-list-content');
    const triggerElement = document.getElementById('char-list-trigger');

    listElement.innerHTML = '';
    loaderElement.style.display = 'block';

    google.script.run
        .withSuccessHandler(characterDataList => { // 受け取るデータがオブジェクトの配列になる
            loaderElement.style.display = 'none';

            if (characterDataList.length === 0) {
                listElement.innerHTML = '<li>保存されたキャラクターはいません。</li>';
            } else {
                characterDataList.forEach(char => { // char = {id, charName, playerName}
                    const li = document.createElement('li');
                    
                    // テキスト部分を作成
                    const textSpan = document.createElement('span');
                    textSpan.innerHTML = `
                        <small>ID:${char.id}</small> <strong>${char.charName}</strong><br>
                        <small>${char.playerName}</small>
                    `;
                    li.appendChild(textSpan);
                    
                    // 表示ボタンを作成
                    const viewButton = document.createElement('button');
                    viewButton.textContent = '表示';
                    viewButton.className = 'button-secondary';
                    viewButton.onclick = () => loadCharacterData(char.id); // IDで読み込む
                    
                    li.appendChild(viewButton);
                    listElement.appendChild(li);
                });
            }

            if (triggerElement.classList.contains('active')) {
                contentElement.style.maxHeight = contentElement.scrollHeight + "px";
            }
        })
        .withFailureHandler(error => {
            loaderElement.style.display = 'none';
            showLoaderMessage(`リストの読み込みに失敗しました: ${error.message}`, { isSuccess: false });
        })
        .getCharacterList();
}

function saveCharacter() {
    const data = getFormData();
    if (!data.charName || !data.playerName) {
        showLoaderMessage("プレイヤー名とキャラクター名は必須です。", { isSuccess: false });
        return;
    }
    showLoaderMessage("キャラクターを保存中です...", { loader: true }); 
    google.script.run
        .withSuccessHandler(response => {
            hideLoaderMessage(); // 成功時にローダーを消す
            showLoaderMessage(response, { isSuccess: true });
            loadCharacterList();
            clearForm();
        })
        .withFailureHandler(error => {
            hideLoaderMessage(); // 失敗時にもローダーを消す
            showLoaderMessage(`保存失敗: ${error.message}`, { isSuccess: false });
        })
        .saveNewCharacterSheet(data);
}

function updateCharacter() {
    const data = getFormData();
    if (!data.charName || !data.playerName) {
        showLoaderMessage("プレイヤー名とキャラクター名は必須です。", { isSuccess: false });
        return;
    }
    showLoaderMessage("キャラクターを更新中です...", { loader: true });
    google.script.run
        .withSuccessHandler(response => {
            hideLoaderMessage(); // 成功時にローダーを消す
            showLoaderMessage(response, { isSuccess: true });
            loadCharacterList();
        })
        .withFailureHandler(error => {
            hideLoaderMessage(); // 失敗時にもローダーを消す
            showLoaderMessage(`更新失敗: ${error.message}`, { isSuccess: false });
        })
        .updateCharacterSheet(data);
}

/**
 * キャラクターデータをIDで読み込むように変更
 */
function loadCharacterData(characterId) {
    showLoaderMessage("キャラクターを読み込み中です...", { loader: true });
    google.script.run
        .withSuccessHandler(data => {
            if (data) {
                hideLoaderMessage();
                // clearForm(); 
                setFormData(data);
                showLoaderMessage(`ID: ${characterId} のデータを読み込みました。`, { isSuccess: true });
                window.scrollTo(0, 0); // フォームの先頭にスクロール
            } else {
                hideLoaderMessage();
                showLoaderMessage(`ID: ${characterId} のデータが見つかりませんでした。`, { isSuccess: false });
            }
        })
        .withFailureHandler(error => {
            hideLoaderMessage();
            showLoaderMessage(`データ読み込み失敗: ${error.message}`, { isSuccess: false });
        })
        .getCharacterData(characterId);
}

/**
 * 【改修】キャラクターをIDで削除するように変更
 */
function deleteCharacter() {
    const characterId = document.getElementById('character-id-hidden').value;
    if (!characterId) {
        showLoaderMessage("削除対象のキャラクターが選択されていません。", { isSuccess: false });
        return;
    }
    
    // キャラクター名を取得して確認メッセージに表示
    const charName = document.getElementById('char-name').value;
    if (!confirm(`本当に「${charName}」(ID: ${characterId})を削除しますか？この操作は取り消せません。`)) {
        return;
    }
    
    showLoaderMessage("キャラクターを削除中です...", { loader: true });
    google.script.run
        .withSuccessHandler(response => {
            hideLoaderMessage();
            showLoaderMessage(response, { isSuccess: true });
            loadCharacterList();
            clearForm(); // フォームをクリアして初期状態に戻す
        })
        .withFailureHandler(error => {
            hideLoaderMessage();
            showLoaderMessage(`削除失敗: ${error.message}`, { isSuccess: false });
        })
        .deleteCharacterSheet(characterId);
}

// =========================================================================
// フローティングメッセージ制御（改修版）
// =========================================================================

// 自動消去用のタイマーIDを保持する変数
let messageClearTimer;

/**
 * フローティングメッセージを表示する。
 * @param {string} message - 表示するテキスト
 * @param {object} options - オプション
 * @param {boolean} [options.loader=false] - trueの場合、自動で消えず操作をブロックする
 * @param {boolean} [options.isSuccess=true] - メッセージの見た目を制御する
 */
function showLoaderMessage(message, options = {}) {
    const { loader = false, isSuccess = true } = options;

    const modal = document.getElementById('loader-modal');
    const messageBox = modal.querySelector('.modal-message');
    const textElement = document.getElementById('loader-text');

    // 以前のタイマーが残っていればクリア
    clearTimeout(messageClearTimer);

    // メッセージとスタイルの設定
    textElement.textContent = message;
    messageBox.classList.toggle('is-error', !isSuccess);

    // 表示モードの切り替え
    if (loader) {
        // ローダーモード：バックドロップあり、自動で消えない
        modal.classList.remove('is-toast');
    } else {
        // トーストモード：バックドロップなし、自動で消える
        modal.classList.add('is-toast');
        messageClearTimer = setTimeout(() => {
            hideLoaderMessage();
        }, 2000); // 2000ms後に自動消去
    }
    
    // メッセージを表示
    modal.classList.add('is-active');
}

/**
 * フローティングメッセージとバックドロップを非表示にする
 */
function hideLoaderMessage() {
    document.getElementById('loader-modal').classList.remove('is-active');
}

</script>