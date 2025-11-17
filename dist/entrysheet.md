<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>キャラクター履歴書 | 運命を刻む元帳 VoT TRPG</title>
  
  <?!= include('stylesheet'); ?>

</head>
<body>
<script src="//accaii.com/entrysheet/script.js" async></script><noscript><img src="//accaii.com/entrysheet/script?guid=on"></noscript>

<div class="container">
  <header>
    <h1>履歴書<br><small>ENTRY SHEET</small></h1>
    <p style="text-align: center;"><small>運命を刻む元帳</small><br><strong>ベンチャー<small>・オブ・</small>テイルズ TRPG</stong></p>
  </header>

    <section id="character-loader-section">
      <!-- h2に.accordion-triggerクラスを追加し、内部に矢印用のspanを追加 -->
      <h3 id="char-list-trigger" class="accordion-trigger">
        <span class="arrow"></span>キャラクターリスト
      </h3>
      <!-- divに.accordion-contentクラスを追加 -->
      <div id="char-list-content" class="accordion-content">
        <div class="form-group">
          <ul id="char-list"></ul>
          <div id="loader" style="display: none;">読み込み中...</div>
        </div>
        <div class="accordion-close-trigger">▲ 閉じる</div>
      </div>
    </section>
</div>

<div class="container">
  <main>
    <h1><small>職能ギルド新規登録用</small></h1>

    <form id="character-sheet">
      <input type="hidden" id="character-id-hidden">

      <h2>① 基本情報</h2>
      <div class="form-group">
        <div>
          <label for="player-name">後見人 <small>※未成年者は保護者名</small></label>
          <input type="text" id="player-name" placeholder="プレイヤーの名前">
        </div>
        <div style="margin-top: 1rem;">
          <label for="char-name">登録名</label>
          <input type="text" id="char-name" placeholder="キャラクターの名前">
        </div>
        <div style="margin-top: 1rem;">
          <label for="nickname">二つ名 <small>※任意</small></label>
          <div style="display:flex; align-items:center; gap:1rem;">
            <input type="text" id="nickname" placeholder="（例：深紅の牙）" style="flex-grow:1;">
            <label style="margin-bottom:0; flex-shrink:0;">
              <input type="checkbox" id="use-nickname"> 使用する
            </label>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>風評</label>
        <div class="grid-3-col">
          <input type="text" id="fuhyo-credit" value="信用: 0" readonly>
          <input type="text" id="fuhyo-fame" value="名声: 0" readonly>
          <input type="text" id="fuhyo-notoriety" value="悪名: 0" readonly>
        </div>
      </div>

      <h2>② 経歴 (ライフパス)</h2>
      <div class="form-group">
        <div class="lifepath-group">
          <label for="lifepath-birth">生まれ</label>
          <select id="lifepath-birth"></select>
          <div id="lifepath-birth-desc" class="lifepath-description"></div>
        </div>
        <div class="lifepath-group">
          <label for="lifepath-upbringing">育ち</label>
          <select id="lifepath-upbringing"></select>
          <div id="lifepath-upbringing-desc" class="lifepath-description"></div>
        </div>
        <div class="lifepath-group">
          <label for="lifepath-trigger">契機</label>
          <select id="lifepath-trigger"></select>
          <div id="lifepath-trigger-desc" class="lifepath-description"></div>
        </div>
      </div>
      
      <h2>③ 特徴</h2>
      <!-- accordionクラスを持つdivで全体を囲む -->
      <div class="form-group" id="features-selection-accordions">
        <!-- JSによってアコーディオンがここに生成されます -->
        <!-- 生成されるHTMLが <div class="accordion"> <summary class="accordion-trigger">...</summary> <div class="accordion-content">...</div> </div> の形になるようにJSを修正します -->
      </div>

      <h3>あなたの特徴</h3>
      <div id="selected-features-list">
        <p style="font-weight: 100;">※特徴を選択すると、ここに表示されます。</p>
      </div>

      <h2>④ 専門技能 (初期スキル)</h2>
      <div id="skill-points-tracker">残りスキルポイント: 5 / 5</div>
      <!-- .skill-list のクラス名はそのまま -->
      <div class="skill-list">
      <!-- JSによってアコーディオンがここに生成されます -->
      <!-- 生成されるHTMLが <div class="accordion"> <summary class="accordion-trigger">...</summary> <div class="accordion-content">...</div> </div> の形になるようにJSを修正します -->
      </div>

      <h3>あなたのスキル</h3>
      <div id="selected-skills-list">
          <p style="font-weight: 100;">※スキルを選択すると、ここに表示されます。</p>
      </div>

      <h2>⑤ 能力評価</h2>
      <div class="form-group">
        <div style="margin-bottom: 1rem;">
          <h3>スキルベクトルとポジション</h3>
          <div class="vector-chart-container">
              <h4>RAベクトルグラフ</h4>
              <div class="vector-chart">
                  <!-- 各象限のポジション名 -->
                  <div class="quadrant-label q1">脳筋<br>ストライカー</div>
                  <div class="quadrant-label q2">千手の<br>トリックスター</div>
                  <div class="quadrant-label q3">策士<br>オラクル</div>
                  <div class="quadrant-label q4">挑発<br>ヴァンガード</div>
                  <div class="axis-position-label pos-center">器用貧乏<br>フレックス</div>
                  <div class="axis-position-label pos-r-plus">剛腕の<br>フィクサー</div>
                  <div class="axis-position-label pos-r-minus">知恵の<br>コンサルタント</div>
                  <div class="axis-position-label pos-a-plus">行動のエージェント</div>
                  <div class="axis-position-label pos-a-minus">礎のアンカー</div>
                  <!-- 軸 -->
                  <div class="vector-axis x-axis"></div>
                  <div class="vector-axis y-axis"></div>
                  <!-- ラベル -->
                  <div class="axis-label top">A+: アプローチ (動)</div>
                  <div class="axis-label bottom">A-: アプローチ (静)</div>
                  <div class="axis-label left">R-: ロール (知略)</div>
                  <div class="axis-label right">R+: ロール (武闘)</div>
                  <!-- 現在位置のポイント -->
                  <div id="vector-point" class="vector-point" style="left: 50%; top: 50%;">
                      <div id="position-text" class="position-text">器用貧乏フレックス</div>
                  </div>
              </div>
          </div>
          <table>
            <tr><th>R: ロール (武闘/知略) + 体力 - 知力</th><td id="stat-vector-r">0</td></tr>
          </table>
          <table>
            <tr><th>A: アプローチ (動/静) + 統御 - 魅力</th><td id="stat-vector-a">0</td></tr>
          </table>
          <table>
            <tr><th>ポジション</th><td id="stat-position">器用貧乏フレックス</td></tr>
          </table>
        </div>
      </div>
      <div id="stats-sticky-footer">
        <div class="stats-sticky-footer-content">
          <div class="stats-group">
            <h3>基礎能力値</h3>
            <div class="grid-3-col">
              <input type="text" id="stat-体力" readonly><input type="text" id="stat-知力" readonly><input type="text" id="stat-魅力" readonly>
              <input type="text" id="stat-運動" readonly><input type="text" id="stat-芸術" readonly><input type="text" id="stat-統御" readonly>
            </div>
          </div>
          <div class="stats-group">
            <h3>商才（派生能力値）</h3>
            <div class="grid-3-col">
              <input type="text" id="stat-市場感覚" readonly><input type="text" id="stat-創造力" readonly><input type="text" id="stat-交渉力" readonly>
            </div>
          </div>
        </div>
      </div>

      <div class="form-group">
        <button type="button" class="button-success" id="save-new-btn">新規保存</button>
        <button type="button" class="button-success" id="update-btn" style="display:none;">上書き保存</button>
        <button type="button" class="button-secondary" id="clear-btn">クリア</button>
        <button type="button" class="button-danger" id="delete-btn" style="display:none;">削除</button>
      </div>
      <div id="status-message"></div>
    </form>
  </main>
</div>

<!-- サーバーから渡されたゲームデータをグローバル変数として定義する -->
<script>
  const { LIFEPATH_DATA, SKILLS, FEATURES_DATA } = <?!= JSON.stringify(gameData) ?>;
</script>

<?!= include('javascript'); ?>

<div id="loader-modal" class="modal-overlay">
  <div class="modal-backdrop"></div>
  <div class="modal-message">
    <p id="loader-text">処理中...</p>
  </div>
</div>

</body>
</html>