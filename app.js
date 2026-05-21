/* ===== 退屈しのぎの飼育論 - app.js ===== */
'use strict';

/* --------------------------------------------------
   ゲーム状態
-------------------------------------------------- */
const GS = {
  playerName: '',
  score: 0,
  currentNode: 's1_n1',
  outfitChoice: 'B',    /* choice 1-2 の結果を保存 */
  choiceHistory: [],
  textLog: [],
  isTyping: false,
  autoMode: false,
  skipMode: false,
  autoTimer: null,
  scenario: null,
  currentBg: 'bg-bedroom',
  pendingNext: null,    /* タップ待ちの次ノードID */
};

/* --------------------------------------------------
   テキスト速度設定
-------------------------------------------------- */
let typingSpeed = 35;   /* ms/文字 */

/* --------------------------------------------------
   DOM取得ヘルパー
-------------------------------------------------- */
const $ = id => document.getElementById(id);

/* --------------------------------------------------
   初期化
-------------------------------------------------- */
async function init() {
  /* サービスワーカー登録 */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  /* シナリオ読み込み */
  try {
    const res = await fetch('./scenario.json');
    GS.scenario = await res.json();
  } catch (e) {
    alert('シナリオの読み込みに失敗しました。');
    return;
  }

  /* プレイヤー名を確認 */
  const savedName = localStorage.getItem('taikutsu_playerName');
  if (savedName) {
    GS.playerName = savedName;
    showScreen('title');
  } else {
    showScreen('name-input');
  }

  /* イベント登録 */
  bindEvents();
}

/* --------------------------------------------------
   画面切り替え
-------------------------------------------------- */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = $(`screen-${name}`);
  if (target) {
    target.classList.add('active');
    onScreenShown(name);
  }
}

function onScreenShown(name) {
  if (name === 'save')   renderSaveSlots('save');
  if (name === 'load')   renderSaveSlots('load');
  if (name === 'log')    renderLog();
  if (name === 'settings') updateSettingsUI();
}

/* --------------------------------------------------
   イベント登録
-------------------------------------------------- */
function bindEvents() {
  /* タイトル */
  $('btn-new-game').addEventListener('click', startNewGame);
  $('btn-title-load').addEventListener('click', () => showScreen('load'));
  $('btn-title-settings').addEventListener('click', () => showScreen('settings'));

  /* 名前入力 */
  $('name-input-field').addEventListener('input', onNameInput);
  $('btn-name-confirm').addEventListener('click', confirmName);

  /* メッセージウィンドウ（タップ送り） */
  $('msg-box').addEventListener('click', onMsgTap);

  /* コントロールボタン */
  $('btn-auto').addEventListener('click', toggleAuto);
  $('btn-skip').addEventListener('click', toggleSkip);
  $('btn-log').addEventListener('click', () => showScreen('log'));
  $('btn-save').addEventListener('click', () => { pauseAuto(); showScreen('save'); });
  $('btn-menu').addEventListener('click', () => { pauseAuto(); showScreen('settings'); });

  /* サブ画面の戻るボタン */
  ['save','load','log','settings'].forEach(name => {
    const btn = $(`btn-back-${name}`);
    if (btn) btn.addEventListener('click', () => showScreen('game'));
  });

  /* エンディング */
  $('btn-ending-title').addEventListener('click', () => showScreen('title'));
  $('btn-ending-retry').addEventListener('click', startNewGame);

  /* スライダー */
  const speedSlider = $('speed-slider');
  if (speedSlider) {
    speedSlider.addEventListener('input', () => {
      typingSpeed = 100 - parseInt(speedSlider.value);
      $('speed-val').textContent = speedSlider.value;
    });
  }

  /* 設定：名前変更 */
  $('btn-change-name').addEventListener('click', () => {
    showScreen('name-input');
    $('name-input-field').value = GS.playerName;
    onNameInput();
  });
}

/* --------------------------------------------------
   名前入力
-------------------------------------------------- */
function onNameInput() {
  const val = $('name-input-field').value.trim();
  const preview = $('name-preview');
  if (val) {
    preview.innerHTML = `えいとが呼ぶ名前：<span class="name-highlight">${escHtml(val)}ちゃん</span>`;
  } else {
    preview.textContent = '名前を入力してください';
  }
}

function confirmName() {
  const val = $('name-input-field').value.trim();
  if (!val) return;
  GS.playerName = val;
  localStorage.setItem('taikutsu_playerName', val);
  showScreen('title');
}

/* --------------------------------------------------
   新規ゲーム
-------------------------------------------------- */
function startNewGame() {
  GS.score = 0;
  GS.currentNode = GS.scenario.startNode;
  GS.outfitChoice = 'B';
  GS.choiceHistory = [];
  GS.textLog = [];
  GS.autoMode = false;
  GS.skipMode = false;
  GS.pendingNext = null;
  clearTimeout(GS.autoTimer);

  updateScoreBar();
  $('btn-auto').classList.remove('active');
  $('btn-skip').classList.remove('active');
  $('choice-overlay').classList.remove('visible');

  showScreen('game');

  /* 少し待ってからノード処理開始 */
  setTimeout(() => processNode(GS.currentNode), 300);
}

/* --------------------------------------------------
   ノード処理（コアループ）
-------------------------------------------------- */
function processNode(nodeId) {
  if (!nodeId || !GS.scenario) return;

  const node = GS.scenario.nodes[nodeId];
  if (!node) { console.warn('Node not found:', nodeId); return; }

  GS.currentNode = nodeId;
  clearTimeout(GS.autoTimer);

  switch (node.type) {
    case 'bg':
      changeBg(node.bg);
      processNode(node.next);
      break;

    case 'narrate':
      showMessage(null, node.text, 'narrator', node.next);
      break;

    case 'thought':
      showMessage('私', node.text, 'thought', node.next);
      break;

    case 'dialogue':
      showMessage(node.speaker, node.text, node.speakerStyle || 'dialogue', node.next);
      updateCharExpression(node.speaker, node.text);
      break;

    case 'choice':
      showChoices(node);
      break;

    case 'conditional': {
      const val = GS[node.variable] || 'B';
      const nextId = node.cases[val] || node.cases['B'];
      processNode(nextId);
      break;
    }

    case 'ending_calc':
      calculateEnding();
      break;

    default:
      console.warn('Unknown node type:', node.type);
  }
}

/* --------------------------------------------------
   メッセージ表示
-------------------------------------------------- */
function showMessage(speaker, text, style, nextNodeId) {
  /* choice オーバーレイを隠す */
  $('choice-overlay').classList.remove('visible');

  const processed = processText(text);
  const speakerEl = $('speaker-name');
  const textEl    = $('msg-text');
  const nextArrow = $('next-indicator');

  /* 話者名 */
  if (speaker === null) {
    speakerEl.className = 'speaker-name speaker-narrator';
    speakerEl.textContent = '';
    textEl.className = 'msg-text narrator-style';
  } else if (speaker === '私') {
    speakerEl.className = 'speaker-name speaker-player';
    speakerEl.textContent = GS.playerName || '私';
    textEl.className = style === 'thought' ? 'msg-text thought-style' : 'msg-text';
  } else {
    speakerEl.className = 'speaker-name' + (style === 'phone' ? ' speaker-phone' : '');
    speakerEl.textContent = speaker;
    textEl.className = 'msg-text';
  }

  nextArrow.classList.remove('visible');
  GS.pendingNext = nextNodeId;

  /* テキストログに追加 */
  GS.textLog.push({ speaker: speaker || 'ナレーター', text: processed });

  /* タイピング表示 or スキップ */
  if (GS.skipMode) {
    textEl.textContent = processed;
    textEl.innerHTML = processed.replace(/\n/g, '<br>') + '<span class="msg-cursor"></span>';
    GS.isTyping = false;
    nextArrow.classList.add('visible');
    scheduleAuto();
  } else {
    typeText(textEl, processed, () => {
      nextArrow.classList.add('visible');
      scheduleAuto();
    });
  }
}

/* タイピングエフェクト */
function typeText(el, text, onDone) {
  GS.isTyping = true;
  el.textContent = '';
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'msg-cursor';

  function tick() {
    if (i >= text.length) {
      /* 完了 */
      el.innerHTML = text.replace(/\n/g, '<br>');
      el.appendChild(cursor);
      GS.isTyping = false;
      if (onDone) onDone();
      return;
    }

    const ch = text[i++];
    el.innerHTML = text.slice(0, i).replace(/\n/g, '<br>');
    el.appendChild(cursor);

    /* 「…」「。」「、」は少し長めに */
    let delay = typingSpeed;
    if (ch === '…' || ch === '。') delay = typingSpeed * 3;
    else if (ch === '、') delay = typingSpeed * 1.5;
    else if (ch === '\n') delay = typingSpeed * 2;

    if (GS.skipMode) {
      el.innerHTML = text.replace(/\n/g, '<br>');
      el.appendChild(cursor);
      GS.isTyping = false;
      if (onDone) onDone();
      return;
    }

    GS.autoTimer = setTimeout(tick, delay);
  }

  tick();
}

/* --------------------------------------------------
   タップ送り
-------------------------------------------------- */
function onMsgTap() {
  /* タイピング中 → スキップして全文表示 */
  if (GS.isTyping) {
    GS.skipMode = false;  /* 一時的にスキップ終了 */
    const textEl = $('msg-text');
    clearTimeout(GS.autoTimer);

    /* pendingNext の前テキストを強制完了 */
    const currentText = textEl.textContent;
    const cursor = document.createElement('span');
    cursor.className = 'msg-cursor';

    /* 現在のメッセージを最後まで一気に表示 */
    GS.isTyping = false;
    /* タイピング中に全文を求める：直前のtypeText呼び出しのtextを再利用する代わりに
       テキストフィールドのデータ属性から取得 */
    const fullText = textEl.dataset.full || textEl.textContent;
    textEl.innerHTML = fullText.replace(/\n/g, '<br>');
    textEl.appendChild(cursor);
    $('next-indicator').classList.add('visible');
    scheduleAuto();
    return;
  }

  /* 選択肢表示中は無視 */
  if ($('choice-overlay').classList.contains('visible')) return;

  /* 次のノードへ */
  clearTimeout(GS.autoTimer);
  if (GS.pendingNext) {
    processNode(GS.pendingNext);
    GS.pendingNext = null;
  }
}

/* 全文テキストをdata属性に保存するためtypeText改修 */
const origTypeText = typeText;

/* --------------------------------------------------
   オート / スキップ
-------------------------------------------------- */
function toggleAuto() {
  GS.autoMode = !GS.autoMode;
  $('btn-auto').classList.toggle('active', GS.autoMode);
  if (GS.autoMode && !GS.isTyping) scheduleAuto();
}

function toggleSkip() {
  GS.skipMode = !GS.skipMode;
  $('btn-skip').classList.toggle('active', GS.skipMode);
  if (GS.skipMode && GS.isTyping) {
    /* 強制スキップ：現在のタイピングが次のtickでスキップされる */
  }
}

function pauseAuto() {
  GS.autoMode = false;
  $('btn-auto').classList.remove('active');
  clearTimeout(GS.autoTimer);
}

function scheduleAuto() {
  if (!GS.autoMode && !GS.skipMode) return;
  clearTimeout(GS.autoTimer);
  const delay = GS.skipMode ? 50 : 2200;
  GS.autoTimer = setTimeout(() => {
    if ($('choice-overlay').classList.contains('visible')) return;
    if (GS.pendingNext) {
      processNode(GS.pendingNext);
      GS.pendingNext = null;
    }
  }, delay);
}

/* --------------------------------------------------
   選択肢表示
-------------------------------------------------- */
function showChoices(node) {
  GS.isTyping = false;
  GS.pendingNext = null;
  clearTimeout(GS.autoTimer);

  const overlay  = $('choice-overlay');
  const titleEl  = $('choice-title');
  const container = $('choice-buttons');

  titleEl.textContent = node.label || '選択してください';
  container.innerHTML = '';

  /* メッセージウィンドウの内容をクリア */
  $('msg-text').innerHTML = '';
  $('speaker-name').textContent = '';
  $('next-indicator').classList.remove('visible');

  node.choices.forEach((choice, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-label">${choice.label}</span>${escHtml(processText(choice.text))}`;
    btn.addEventListener('click', () => makeChoice(choice));
    container.appendChild(btn);

    /* 少し遅れてフェードイン */
    btn.style.opacity = '0';
    btn.style.transform = 'translateY(8px)';
    btn.style.transition = 'all 0.3s';
    setTimeout(() => {
      btn.style.opacity = '1';
      btn.style.transform = 'translateY(0)';
    }, idx * 80 + 50);
  });

  overlay.classList.add('visible');
}

/* --------------------------------------------------
   選択肢決定
-------------------------------------------------- */
function makeChoice(choice) {
  /* 選択肢UIを隠す */
  $('choice-overlay').classList.remove('visible');

  /* スコア加算 */
  GS.score += choice.score;
  GS.choiceHistory.push({ text: choice.text, score: choice.score });
  updateScoreBar();

  /* storeAs：状態変数へ保存（服装選択など） */
  if (choice.storeAs) {
    GS[choice.storeAs] = choice.label;
  }

  /* レスポンステキストがある場合は表示してから次へ */
  if (choice.responseText) {
    const style = choice.speakerType || 'dialogue';
    const speaker = choice.responseSpeaker || null;
    showMessage(speaker, choice.responseText, style, choice.next);
    if (speaker !== null && speaker !== '私') {
      updateCharExpression(speaker, choice.responseText);
    }
  } else {
    processNode(choice.next);
  }
}

/* --------------------------------------------------
   テキスト加工（プレイヤー名置換）
-------------------------------------------------- */
function processText(text) {
  if (!text) return '';
  const name = GS.playerName || 'お姉さん';
  if (!GS.playerName) return text;
  return text.replace(/お姉さん/g, `${name}ちゃん`);
}

/* --------------------------------------------------
   背景変更
-------------------------------------------------- */
function changeBg(bgClass) {
  const bgEl = $('game-bg');
  bgEl.className = `game-bg ${bgClass}`;
  GS.currentBg = bgClass;

  /* 雨演出 */
  const rainEl = $('rain-overlay');
  if (bgClass === 'bg-rain-night') {
    rainEl.classList.add('active');
  } else {
    rainEl.classList.remove('active');
  }
}

/* --------------------------------------------------
   キャラクター表情更新（PNG対応）
   ファイル命名規則:
     chara_normal.png    通常
     chara_happy.png     笑顔・嬉しい
     chara_surprised.png 驚き
     chara_tired.png     消耗・落ち込み
     chara_intense.png   鋭い目・緊迫
-------------------------------------------------- */

/* 事前にロード済みか確認したPNGセット */
const _pngCache = {};

function _resolveExpr(text) {
  if (/笑|あはは|ウケる|最高|頼もし|嬉し|グッとくる|ツボ/.test(text)) return 'happy';
  if (/うわ|マジか|え、お|え、あ|ちょ、/.test(text))                 return 'surprised';
  if (/辛|疲|ダル|涙|消えればいい|ボロボロ|限界|泣きそう/.test(text)) return 'tired';
  if (/ゾクゾク|逃げ場|縛|特級|降参|一生/.test(text))               return 'intense';
  return 'normal';
}

function updateCharExpression(speaker, text, forceExpr) {
  const img = $('char-sprite');
  if (!img) return;

  /* えいと以外のときはキャラを非表示 */
  if (speaker !== 'えいと') {
    img.classList.add('hidden');
    return;
  }
  img.classList.remove('hidden');

  const expr  = forceExpr || _resolveExpr(text);
  const src   = `./chara_${expr}.png`;

  /* 同じ画像なら何もしない */
  if (img.dataset.currentExpr === expr) return;

  /* PNG が存在するか確認してから切り替え */
  if (_pngCache[src] === false) {
    /* このexprのPNGがない場合 → normalにフォールバック */
    _switchSprite(img, './chara_normal.png', 'normal');
    return;
  }

  const probe = new Image();
  probe.onload = () => {
    _pngCache[src] = true;
    _switchSprite(img, src, expr);
  };
  probe.onerror = () => {
    _pngCache[src] = false;
    /* expr固有のPNGがなければnormalを試みる */
    if (expr !== 'normal') {
      updateCharExpression(speaker, text, 'normal');
    } else {
      /* chara_normal.png すら無ければ非表示 */
      img.classList.add('hidden');
    }
  };
  probe.src = src;
}

function _switchSprite(img, src, expr) {
  /* フェードアウト → src切り替え → フェードイン */
  img.classList.add('fading');
  setTimeout(() => {
    img.src = src;
    img.dataset.currentExpr = expr;
    /* 表情クラスを付け替え */
    img.classList.remove('expr-happy', 'expr-surprised', 'expr-tired', 'expr-intense');
    if (expr !== 'normal') img.classList.add(`expr-${expr}`);
    img.classList.remove('fading');
  }, 180);
}

/* --------------------------------------------------
   スコアバー更新
-------------------------------------------------- */
function updateScoreBar() {
  const fill   = $('score-fill');
  const numEl  = $('score-num');
  const endEl  = $('score-end-label');
  const s = GS.score;
  const pct = Math.min(s / 60 * 100, 100);

  fill.style.width = pct + '%';
  numEl.textContent = s + ' / 60';

  /* スコアレンジで色変化 */
  fill.classList.remove('range-0','range-1','range-2','range-3','range-4');
  if (s <= 20) {
    fill.classList.add('range-0');
    endEl.style.color = '#4488cc';
    endEl.textContent = '❌ Bad END';
  } else if (s <= 37) {
    fill.classList.add('range-1');
    endEl.style.color = '#778899';
    endEl.textContent = '❌ Bad END';
  } else if (s <= 47) {
    fill.classList.add('range-2');
    endEl.style.color = '#9b4fbd';
    endEl.textContent = '🔄 Normal END';
  } else if (s <= 56) {
    fill.classList.add('range-3');
    endEl.style.color = '#c02060';
    endEl.textContent = '🤝 Good END';
  } else {
    fill.classList.add('range-4');
    endEl.style.color = '#ff69b4';
    endEl.textContent = '👑 Happy END';
  }
}

/* --------------------------------------------------
   エンディング計算・表示
-------------------------------------------------- */
function calculateEnding() {
  const endings = GS.scenario.endings;
  let key = 'bad';

  if (GS.score >= 57)      key = 'happy';
  else if (GS.score >= 48) key = 'good';
  else if (GS.score >= 38) key = 'normal';

  const ending = endings[key];

  /* エンディング画面の内容をセット */
  changeBg(ending.bg);
  $('ending-label').textContent   = ending.label;
  $('ending-title').textContent   = ending.title;
  $('ending-score-num').textContent = GS.score + ' pt';

  const textEl = $('ending-text');
  textEl.textContent = '';

  showScreen('ending');

  /* テキストをゆっくり表示 */
  setTimeout(() => typeEndingText(textEl, ending.text), 500);
}

function typeEndingText(el, text) {
  const words = text.split('');
  let i = 0;
  function tick() {
    if (i >= words.length) return;
    i++;
    el.textContent = text.slice(0, i);
    setTimeout(tick, 18);
  }
  tick();
}

/* --------------------------------------------------
   セーブ / ロード
-------------------------------------------------- */
const SAVE_KEY = 'taikutsu_saves';

function getSaves() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY)) || [null, null, null];
  } catch { return [null, null, null]; }
}

function saveGame(slot) {
  const saves = getSaves();
  saves[slot] = {
    date: new Date().toLocaleString('ja-JP'),
    node: GS.currentNode,
    score: GS.score,
    outfitChoice: GS.outfitChoice,
    choiceHistory: [...GS.choiceHistory],
    textLog: GS.textLog.slice(-30),
    playerName: GS.playerName,
    bg: GS.currentBg,
    sceneLabel: getCurrentSceneLabel(),
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(saves));
  renderSaveSlots('save');
  showToast('セーブしました');
}

function loadGame(slot) {
  const saves = getSaves();
  const data = saves[slot];
  if (!data) return;

  GS.playerName    = data.playerName || GS.playerName;
  GS.currentNode   = data.node;
  GS.score         = data.score;
  GS.outfitChoice  = data.outfitChoice || 'B';
  GS.choiceHistory = data.choiceHistory || [];
  GS.textLog       = data.textLog || [];
  GS.autoMode      = false;
  GS.skipMode      = false;
  GS.pendingNext   = null;
  clearTimeout(GS.autoTimer);

  changeBg(data.bg || 'bg-bedroom');
  updateScoreBar();

  showScreen('game');
  setTimeout(() => processNode(GS.currentNode), 300);
}

function getCurrentSceneLabel() {
  const id = GS.currentNode || '';
  if (id.startsWith('s1')) return 'Scene 1：画面越しの違和感';
  if (id.startsWith('s2')) return 'Scene 2：目が笑っていない男';
  if (id.startsWith('s3')) return 'Scene 3：退屈させない挑戦';
  if (id.startsWith('s4')) return 'Scene 4：二度目の約束';
  if (id.startsWith('s5')) return 'Scene 5：崩れる仮面';
  if (id.startsWith('s6')) return 'Scene 6：夜の電話';
  if (id.startsWith('s7')) return 'Scene 7：踏み越えられた境界線';
  if (id.startsWith('s8')) return 'Scene 8：悪意なき拒絶';
  if (id.startsWith('s9')) return 'Scene 9：本音のぶつかり合い';
  if (id.startsWith('s10')) return 'Scene 10：お前が飽きさせない限り';
  return '─';
}

function renderSaveSlots(mode) {
  const saves = getSaves();
  const container = $(mode === 'save' ? 'save-slot-container' : 'load-slot-container');
  if (!container) return;
  container.innerHTML = '';

  saves.forEach((save, i) => {
    const slot = document.createElement('div');
    slot.className = 'save-slot' + (save ? '' : ' empty');
    slot.innerHTML = `
      <div class="save-slot-num">${i + 1}</div>
      <div class="save-slot-info">
        <div class="save-slot-date">${save ? save.date : '─'}</div>
        <div class="save-slot-scene">${save ? save.sceneLabel : '空きスロット'}</div>
        ${save ? `<div class="save-slot-score">Score: ${save.score} / 60</div>` : ''}
      </div>`;

    if (mode === 'save') {
      slot.addEventListener('click', () => saveGame(i));
    } else {
      if (save) slot.addEventListener('click', () => { loadGame(i); });
    }
    container.appendChild(slot);
  });
}

/* --------------------------------------------------
   テキストログ表示
-------------------------------------------------- */
function renderLog() {
  const container = $('log-entries');
  if (!container) return;
  container.innerHTML = '';

  const logs = GS.textLog.slice().reverse();
  logs.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `
      <div class="log-entry-speaker">${escHtml(entry.speaker)}</div>
      <div class="log-entry-text">${escHtml(entry.text).replace(/\n/g, '<br>')}</div>`;
    container.appendChild(div);
  });
}

/* --------------------------------------------------
   設定UI
-------------------------------------------------- */
function updateSettingsUI() {
  const nameEl = $('settings-current-name');
  if (nameEl) nameEl.textContent = GS.playerName + 'ちゃん';
  const speedSlider = $('speed-slider');
  if (speedSlider) {
    speedSlider.value = 100 - typingSpeed;
    $('speed-val').textContent = speedSlider.value;
  }
}

/* --------------------------------------------------
   トースト通知
-------------------------------------------------- */
function showToast(msg) {
  let toast = $('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '80px', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(255,105,180,0.15)',
      border: '1px solid rgba(255,105,180,0.4)',
      color: '#ff69b4', fontFamily: 'sans-serif', fontSize: '12px',
      padding: '8px 20px', borderRadius: '20px',
      backdropFilter: 'blur(8px)', zIndex: '200',
      opacity: '0', transition: 'opacity 0.3s', pointerEvents: 'none',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

/* --------------------------------------------------
   HTMLエスケープ
-------------------------------------------------- */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* --------------------------------------------------
   キャラ画像の初期チェック
   chara_normal.png が存在しない場合は img を隠す
-------------------------------------------------- */
function initCharSprite() {
  const img = $('char-sprite');
  if (!img) return;
  img.classList.add('hidden'); /* ロードされるまで非表示 */
  img.onload  = () => { img.classList.remove('hidden'); img.dataset.currentExpr = 'normal'; };
  img.onerror = () => { img.classList.add('hidden'); _pngCache['./chara_normal.png'] = false; };
  img.src = './chara_normal.png';
}

/* --------------------------------------------------
   起動
-------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => { initCharSprite(); init(); });
