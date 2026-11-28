window._coopDb = db;
window._coopAuth = auth;
window._coopDoc = doc;
window._coopSetDoc = setDoc;
window._coopUpdateDoc = updateDoc;
window._coopOnSnapshot = onSnapshot;
window.onerror = function(msg, url, line) {
  alert("エラー: " + msg + " (" + line + "行目)");
};

const base = "https://www.gstatic.com/firebasejs/13.4.0/";
const { initializeApp } = await import(base + "firebase-app.js");
const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = await import(base + "firebase-auth.js");
const { getFirestore, doc, setDoc, getDoc, updateDoc, increment, collection, query, where, getDocs, arrayUnion, arrayRemove, onSnapshot, serverTimestamp } = await import(base + "firebase-firestore.js");

const firebaseConfig = {
  apiKey: "AIzaSyCWWM4zIKbwNFZlicTAT8p_BvM_oC_9jyg",
  authDomain: "dark-brawl.firebaseapp.com",
  projectId: "dark-brawl",
  storageBucket: "dark-brawl.firebasestorage.app",
  messagingSenderId: "995605284599",
  appId: "1:995605284599:web:568d3340a58d01295435f2",
  measurementId: "G-LQWKMQC0ZV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let playerStats = {
  username: "",
  trophies: 0,
  wins: 0,
  matches: 0
};

const toEmail = (name) => `${name.trim()}@darkbrawl.local`;

document.getElementById("registerBtn").addEventListener("click", async () => {
  const name = document.getElementById("usernameInput").value;
  const pass = document.getElementById("passwordInput").value;
  const msg = document.getElementById("authMessage");

  if (!name || pass.length < 6) {
    msg.textContent = "英数字の名前と6文字以上のパスワードを入力してください";
    return;
  }

  try {
    msg.textContent = "登録中...";
    const userCredential = await createUserWithEmailAndPassword(auth, toEmail(name), pass);
    currentUser = userCredential.user;

    playerStats = { username: name, trophies: 0, wins: 0, matches: 0 };
    await setDoc(doc(db, "users", currentUser.uid), playerStats);

    startGameAfterLogin();
  } catch (error) {
    msg.textContent = "エラー: " + error.message;
  }
});

document.getElementById("loginBtn").addEventListener("click", async () => {
  const name = document.getElementById("usernameInput").value;
  const pass = document.getElementById("passwordInput").value;
  const msg = document.getElementById("authMessage");

  try {
    msg.textContent = "ログイン中...";
    const userCredential = await signInWithEmailAndPassword(auth, toEmail(name), pass);
    currentUser = userCredential.user;

    const docSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (docSnap.exists()) {
      playerStats = docSnap.data();
    }

    startGameAfterLogin();
  } catch (error) {
    msg.textContent = "エラー: " + error.message;
  }
});

function startGameAfterLogin() {
  document.getElementById("authScreen").style.display = "none";
  initFriendRealtimeListener();
  alert(`ようこそ ${playerStats.username} さん！\nトロフィー: ${playerStats.trophies} / 勝利数: ${playerStats.wins}`);
}

async function saveMatchResult(isWin, trophyChange) {
  if (!currentUser) return;

  playerStats.trophies = Math.max(0, playerStats.trophies + trophyChange);
  playerStats.matches += 1;
  if (isWin) playerStats.wins += 1;

  const userRef = doc(db, "users", currentUser.uid);
  await updateDoc(userRef, {
    trophies: increment(trophyChange),
    matches: increment(1),
    wins: isWin ? increment(1) : increment(0)
  });
}

// ▼ フレンド機能（フェーズ2：オンライン状態表示対応版） ▼
let unsubscribeUserDoc = null;
let presenceTimer = null;
let currentPresenceState = "online";

async function updateMyPresence(status) {
  if (!currentUser) return;
  if (status) currentPresenceState = status;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      presence: currentPresenceState,
      lastSeen: Date.now()
    });
  } catch (e) {}
}

function getFriendStatusBadge(userData) {
  const lastSeen = userData.lastSeen || 0;
  const isFresh = (Date.now() - lastSeen) < 40000;
  if (!isFresh) {
    return { text: "⚫ オフライン", cls: "text-slate-500", online: false };
  }
  if (userData.presence === "in_match") {
    return { text: "⚔️ バトル中", cls: "text-amber-400 font-bold", online: true };
  }
  return { text: "🟢 オンライン", cls: "text-emerald-400 font-bold", online: true };
}

function initFriendRealtimeListener() {
  if (!currentUser) return;
  if (unsubscribeUserDoc) unsubscribeUserDoc();
  if (presenceTimer) clearInterval(presenceTimer);

  updateMyPresence("online");
  presenceTimer = setInterval(() => updateMyPresence(), 20000);

  const label = document.getElementById("myFriendIdLabel");
  if (label) label.textContent = `あなたの名前: ${playerStats.username}`;

  unsubscribeUserDoc = onSnapshot(doc(db, "users", currentUser.uid), (snap) => {
    if (!snap.exists()) return;
    playerStats = snap.data();
    if (typeof handleIncomingCoopInvite === "function") handleIncomingCoopInvite(playerStats);
    const friends = playerStats.friends || [];
    const requests = playerStats.friendRequests || [];

    const countBadge = document.getElementById("homeFriendCountBadge");
    if (countBadge) countBadge.textContent = `${friends.length}人`;

    const badge = document.getElementById("friendBadge");
    if (badge) {
      if (requests.length > 0) {
        badge.textContent = requests.length;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }

    const modal = document.getElementById("friendsModal");
    if (modal && !modal.classList.contains("hidden")) {
      renderFriendsModal();
    }
  });
}

async function sendFriendRequestByName(targetName) {
  const msgEl = document.getElementById("friendSearchMsg");
  const trimmed = targetName.trim();
  if (!currentUser) {
    msgEl.textContent = "ログインが必要です";
    return;
  }
  if (!trimmed) {
    msgEl.textContent = "ユーザー名を入力してください";
    return;
  }
  if (trimmed === playerStats.username) {
    msgEl.textContent = "自分自身には申請できません";
    return;
  }

  try {
    msgEl.textContent = "検索中...";
    const q = query(collection(db, "users"), where("username", "==", trimmed));
    const snap = await getDocs(q);

    if (snap.empty) {
      msgEl.textContent = `「${trimmed}」というプレイヤーは見つかりませんでした`;
      return;
    }

    const targetDoc = snap.docs[0];
    const targetUid = targetDoc.id;
    const myFriends = playerStats.friends || [];

    if (myFriends.includes(targetUid)) {
      msgEl.textContent = `「${trimmed}」さんはすでにフレンドです！`;
      return;
    }

    await updateDoc(doc(db, "users", targetUid), {
      friendRequests: arrayUnion(currentUser.uid)
    });

    msgEl.textContent = `✅ 「${trimmed}」さんにフレンド申請を送りました！`;
    document.getElementById("friendSearchInput").value = "";
  } catch (err) {
    msgEl.textContent = "送信エラー: " + err.message;
  }
}

window.acceptFriendRequest = async function(fromUid) {
  if (!currentUser) return;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      friends: arrayUnion(fromUid),
      friendRequests: arrayRemove(fromUid)
    });
    await updateDoc(doc(db, "users", fromUid), {
      friends: arrayUnion(currentUser.uid)
    });
    renderFriendsModal();
  } catch (err) {
    alert("承認エラー: " + err.message);
  }
};

window.declineFriendRequest = async function(fromUid) {
  if (!currentUser) return;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      friendRequests: arrayRemove(fromUid)
    });
    renderFriendsModal();
  } catch (err) {
    alert("拒否エラー: " + err.message);
  }
};

async function renderFriendsModal() {
  if (!currentUser) return;
  const reqSec = document.getElementById("friendRequestsSection");
  const reqList = document.getElementById("friendRequestsList");
  const reqCount = document.getElementById("friendReqCount");
  const friendsListEl = document.getElementById("friendsList");

  const requests = playerStats.friendRequests || [];
  const friends = playerStats.friends || [];

  if (requests.length > 0) {
    reqSec.classList.remove("hidden");
    reqCount.textContent = requests.length;
    reqList.innerHTML = "";
    for (const uid of requests) {
      const uSnap = await getDoc(doc(db, "users", uid));
      const uData = uSnap.exists() ? uSnap.data() : { username: "不明なプレイヤー", trophies: 0 };
      const row = document.createElement("div");
      row.className = "flex items-center justify-between bg-slate-950/90 border border-rose-500/40 rounded-2xl px-3.5 py-2.5";
      row.innerHTML = `
        <div>
          <div class="text-sm font-black text-white">${uData.username}</div>
          <div class="text-[11px] text-amber-300 font-bold">🏆 ${uData.trophies || 0}</div>
        </div>
        <div class="flex gap-1.5">
          <button onclick="acceptFriendRequest('${uid}')" class="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black cursor-pointer">承認</button>
          <button onclick="declineFriendRequest('${uid}')" class="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer">拒否</button>
        </div>
      `;
      reqList.appendChild(row);
    }
  } else {
    reqSec.classList.add("hidden");
  }

  const memberProfiles = [{
    uid: currentUser.uid,
    isMe: true,
    username: playerStats.username,
    trophies: playerStats.trophies || 0,
    wins: playerStats.wins || 0,
    matches: playerStats.matches || 0,
    statusInfo: getFriendStatusBadge({ presence: currentPresenceState, lastSeen: Date.now() })
  }];

  for (const fUid of friends) {
    const fSnap = await getDoc(doc(db, "users", fUid));
    if (fSnap.exists()) {
      const d = fSnap.data();
      memberProfiles.push({
        uid: fUid,
        isMe: false,
        username: d.username,
        trophies: d.trophies || 0,
        wins: d.wins || 0,
        matches: d.matches || 0,
        statusInfo: getFriendStatusBadge(d)
      });
    }
  }

  memberProfiles.sort((a, b) => b.trophies - a.trophies);

  if (friends.length === 0) {
    friendsListEl.innerHTML = `<div class="text-center text-xs text-slate-400 py-6 bg-slate-950/50 rounded-2xl border border-slate-800">まだフレンドがいません。<br>上の検索欄から友達の名前を入力して申請しよう！</div>`;
    return;
  }

friendsListEl.innerHTML = "";
  memberProfiles.forEach((m, idx) => {
    const rankIcon = idx === 0 ? "👑" : `#${idx + 1}`;
    const card = document.createElement("div");
    card.className = `flex items-center justify-between rounded-2xl px-4 py-3 border ${
      m.isMe ? "bg-cyan-950/40 border-cyan-400/60" : "bg-slate-950/90 border-slate-800"
    }`;

    const inviteBtnHtml = (!m.isMe && m.statusInfo.online && currentPresenceState === "online")
      ? `<button onclick="inviteFriendToCoop('${m.uid}', '${m.username}')" class="px-3 py-1.5 rounded-xl bg-gradient-to-b from-emerald-400 to-teal-600 text-slate-950 font-black text-xs shadow hover:brightness-110 cursor-pointer">📩 招待</button>`
      : "";

    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center font-black text-xs text-amber-300">
          ${rankIcon}
        </div>
        <div>
          <div class="text-sm font-black text-white flex items-center gap-1.5">
            <span>${m.username}</span>
            ${m.isMe ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">あなた</span>' : ''}
          </div>
          <div class="flex items-center gap-2 text-[11px] mt-0.5">
            <span class="${m.statusInfo.cls}">${m.statusInfo.text}</span>
            <span class="text-slate-500">|</span>
            <span class="text-slate-400">勝利: <span class="text-emerald-400 font-bold">${m.wins}</span></span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <div class="text-right">
          <div class="text-sm font-black text-amber-300">🏆 ${m.trophies}</div>
        </div>
        ${inviteBtnHtml}
      </div>
    `;
friendsListEl.appendChild(card);
  });
}
document.getElementById("openFriendsBtn")?.addEventListener("click", () => {
  document.getElementById("friendsModal").classList.remove("hidden");
  document.getElementById("friendSearchMsg").textContent = "";
  renderFriendsModal();
});
document.getElementById("closeFriendsBtn")?.addEventListener("click", () => {
  document.getElementById("friendsModal").classList.add("hidden");
});
document.getElementById("friendSearchBtn")?.addEventListener("click", () => {
  const val = document.getElementById("friendSearchInput").value;
  sendFriendRequestByName(val);
});
document.getElementById("refreshFriendsBtn")?.addEventListener("click", () => {

        // ----------------------------------------------------------------------------
        // 0. 8カテゴリー定義 ＆ キャラクターロスターデータ
        // ----------------------------------------------------------------------------
        const CATEGORIES = [
            { id: "all", name: "すべて", badgeClass: "bg-slate-700/40 text-slate-200 border-slate-500/50" },
            { id: "supporter", name: "サポーター", badgeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
            { id: "speeder", name: "スピーダー", badgeClass: "bg-cyan-500/20 text-cyan-300 border-cyan-500/40" },
            { id: "attack_dealer", name: "アタックディーラー", badgeClass: "bg-orange-500/20 text-orange-300 border-orange-500/40" },
            { id: "sniper", name: "スナイパー", badgeClass: "bg-lime-500/20 text-lime-300 border-lime-500/40" },
            { id: "thrower", name: "スロワー", badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
            { id: "heavy", name: "ヘビー", badgeClass: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
            { id: "controller", name: "コントローラー", badgeClass: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
            { id: "killer", name: "キラー", badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40" }
        ];

        const BRAWLER_ROSTER = [
            {
                id: "blaze",
                name: "ブレイズ",
                enName: "BLAZE",
                category: "attack_dealer",
                playable: true,
                themeColor: "amber",
                tagline: "赤いマントと黄色い王冠の骸骨王",
                attackName: "トリプルソウル弾",
                attackDesc: "横に並んだ3つの火球(320×3)を同時発射！広い横幅で中距離を制圧する。",
                ultName: "ブレイズダッシュ",
                ultDesc: "少し前へ高速ダッシュし、炎の軌跡で軌道上の敵に大ダメージ(1280)＆ノックバック。",
                stats: {
                    hp: 7600,
                    speed: "普通 (120)",
                    reload: "1.15秒 (やや速い)",
                    bulletSpeed: "640 (普通)",
                    range: "430 (中距離)",
                    ultCharge: "1発 9% (12発命中でMAX)",
                    power: "320 × 3発 (計960)",
                    ultPower: "1280 ダメージ + 前方ダッシュ"
                },
                svgLarge: `
                    <svg viewBox="0 0 80 80" class="w-16 h-16 sm:w-20 sm:h-20">
                        <ellipse cx="40" cy="70" rx="22" ry="6" fill="rgba(0,0,0,0.6)"/>
                        <path d="M16 66 Q18 38 26 32 L54 32 Q62 38 64 66 Q50 61 40 66 Q30 61 16 66 Z" fill="#dc2626" stroke="#991b1b" stroke-width="2"/>
                        <path d="M24 34 L56 34 L50 62 L30 62 Z" fill="#b91c1c"/>
                        <rect x="33" y="36" width="14" height="16" rx="4" fill="#e2e8f0"/>
                        <circle cx="40" cy="27" r="13" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
                        <rect x="33" y="34" width="14" height="7" rx="2.5" fill="#f1f5f9"/>
                        <circle cx="35" cy="26" r="3.2" fill="#1e293b"/>
                        <circle cx="45" cy="26" r="3.2" fill="#1e293b"/>
                        <circle cx="35" cy="26" r="1.8" fill="#ef4444"/>
                        <circle cx="45" cy="26" r="1.8" fill="#ef4444"/>
                        <polygon points="27,16 30,6 35,12 40,4 45,12 50,6 53,16" fill="#facc15" stroke="#b45309" stroke-width="1.5" stroke-linejoin="round"/>
                    </svg>
                `,
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <path d="M8 34 L12 18 L28 18 L32 34 Z" fill="#dc2626"/>
                        <polygon points="13,12 15,6 20,10 25,6 27,12" fill="#facc15" stroke="#ca8a04" stroke-width="1"/>
                        <circle cx="20" cy="18" r="7" fill="#f1f5f9"/>
                        <circle cx="17.5" cy="17.5" r="1.8" fill="#ef4444"/>
                        <circle cx="22.5" cy="17.5" r="1.8" fill="#ef4444"/>
                    </svg>
                `
            },
            {
                id: "viper",
                name: "ヴァイパー",
                enName: "VIPER",
                category: "sniper",
                playable: true,
                themeColor: "pink",
                tagline: "ピンク髪の可愛い美少女スナイパー",
                attackName: "ラブリー・スナイプ",
                attackDesc: "超長射程＆高火力(1320)の単発一発を発射！正確な狙撃で敵の体力を一気に削る。",
                ultName: "ハートブレイク・キャノン",
                ultDesc: "超高火力(2320)の特大エネルギー弾を放つ必殺の一撃！(※壁は貫通しません)",
                stats: {
                    hp: 8200,
                    speed: "普通 (115)",
                    reload: "1.85秒 (やや遅い)",
                    bulletSpeed: "940 (超高速)",
                    range: "660 (超長距離)",
                    ultCharge: "1発 25% (4発命中でMAX)",
                    power: "1320 × 1発",
                    ultPower: "2320 ダメージ (壁貫通なし)"
                },
                svgLarge: `
                    <svg viewBox="0 0 80 80" class="w-16 h-16 sm:w-20 sm:h-20">
                        <ellipse cx="40" cy="70" rx="20" ry="5" fill="rgba(0,0,0,0.6)"/>
                        <!-- ピンクのツインテール -->
                        <path d="M22 26 Q10 38 14 58 Q20 55 24 42 Z" fill="#f472b6" stroke="#db2777" stroke-width="1.5"/>
                        <path d="M58 26 Q70 38 66 58 Q60 55 56 42 Z" fill="#f472b6" stroke="#db2777" stroke-width="1.5"/>
                        <!-- リボン -->
                        <polygon points="21,23 15,19 17,27" fill="#fb7185"/>
                        <polygon points="59,23 65,19 63,27" fill="#fb7185"/>
                        <!-- ワンピース衣装 -->
                        <path d="M26 65 L31 38 L49 38 L54 65 Z" fill="#831843" stroke="#f472b6" stroke-width="1.5"/>
                        <!-- 顔 -->
                        <circle cx="40" cy="27" r="13" fill="#ffe4e6"/>
                        <!-- ピンクの後ろ髪・前髪 -->
                        <path d="M26 27 Q26 12 40 12 Q54 12 54 27 Q48 21 40 24 Q32 21 26 27 Z" fill="#f472b6"/>
                        <!-- 可愛い大きな瞳 -->
                        <ellipse cx="35" cy="28" rx="2.4" ry="3" fill="#be185d"/>
                        <ellipse cx="45" cy="28" rx="2.4" ry="3" fill="#be185d"/>
                        <circle cx="34.3" cy="27" r="1" fill="#ffffff"/>
                        <circle cx="44.3" cy="27" r="1" fill="#ffffff"/>
                        <!-- ほっぺ -->
                        <ellipse cx="31.5" cy="31" rx="2" ry="1.1" fill="#fda4af"/>
                        <ellipse cx="48.5" cy="31" rx="2" ry="1.1" fill="#fda4af"/>
                        <!-- スナイパーライフル -->
                        <rect x="14" y="46" width="52" height="4.5" rx="2" fill="#334155" stroke="#f472b6" stroke-width="1"/>
                        <circle cx="66" cy="48" r="3" fill="#f472b6"/>
                    </svg>
                `,
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <path d="M10 15 Q4 22 7 33 Q11 31 13 23 Z" fill="#f472b6"/>
                        <path d="M30 15 Q36 22 33 33 Q29 31 27 23 Z" fill="#f472b6"/>
                        <path d="M13 34 L16 21 L24 21 L27 34 Z" fill="#9d174d"/>
                        <circle cx="20" cy="16" r="7.5" fill="#ffe4e6"/>
                        <path d="M12 16 Q12 7 20 7 Q28 7 28 16 Q24 12 20 14 Q16 12 12 16 Z" fill="#f472b6"/>
                        <circle cx="17.5" cy="16.5" r="1.5" fill="#be185d"/>
                        <circle cx="22.5" cy="16.5" r="1.5" fill="#be185d"/>
                    </svg>
                `
            },
            {
                id: "titan",
                name: "タイタン",
                enName: "TITAN",
                category: "heavy",
                playable: true,
                themeColor: "purple",
                tagline: "重厚な多面体装甲を纏う黒曜の巨兵",
                attackName: "ペンタ・ショック弾",
                attackDesc: "横に並んだ5つのエネルギー弾(220×5)を同時発射！広い横幅で近〜中距離を圧倒。",
                ultName: "タイタン・ノヴァ",
                ultDesc: "周囲の敵を衝撃波で大きく吹き飛ばし(650ダメージ)、自身のHPを2800回復する！",
                stats: {
                    hp: 13200,
                    speed: "若干遅め (104)",
                    reload: "1.45秒 (普通)",
                    bulletSpeed: "560 (やや遅め)",
                    range: "350 (近〜中距離)",
                    ultCharge: "1発 4% (25発命中でMAX)",
                    power: "220 × 5発 (計1100)",
                    ultPower: "HP 2800 回復 + 周囲吹き飛ばし"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <!-- 頭頂部スパイク -->
                        <polygon points="20,2 17,8 23,8" fill="#d8cce8"/>
                        <!-- 多面体ヘルメット -->
                        <polygon points="14,8 26,8 29,14 25,18 15,18 11,14" fill="#2d2640" stroke="#130f1d" stroke-width="1"/>
                        <!-- 横一文字バイザー -->
                        <rect x="14.5" y="12" width="11" height="2.6" fill="#e2d6f3"/>
                        <!-- 両肩アーマー＆スパイク -->
                        <polygon points="7,14 4,17 9,19" fill="#d8cce8"/>
                        <polygon points="33,14 36,17 31,19" fill="#d8cce8"/>
                        <polygon points="5,18 12,17 12,26 4,24" fill="#64587c"/>
                        <polygon points="35,18 28,17 28,26 36,24" fill="#64587c"/>
                        <!-- 逆台形胴体＆菱形コア -->
                        <polygon points="11,18 29,18 26,29 14,29" fill="#1e192b"/>
                        <polygon points="20,21 24,23.5 20,26 16,23.5" fill="#d8cce8"/>
                        <!-- 脚部 -->
                        <rect x="13" y="29" width="5.5" height="8" fill="#1e192b"/>
                        <rect x="21.5" y="29" width="5.5" height="8" fill="#1e192b"/>
                    </svg>
                `
            },
            {
                id: "saital",
                name: "サイタル",
                enName: "SAITAL",
                category: "supporter",
                playable: true,
                themeColor: "emerald",
                tagline: "ミント帽と単眼鏡の癒やし系エルフ魔導士",
                attackName: "ミント・トリプルレイ",
                attackDesc: "時間差で3発の貫通弾を発射！外側(170ダメ/味方100回復)と高速な真ん中弾(520ダメ/味方300回復)。",
                ultName: "サンクチュアリ・ヒール",
                ultDesc: "周囲の広い範囲内にいる味方全員(自身含む)のHPを2800回復する！",
                stats: {
                    hp: 8200,
                    speed: "普通 (118)",
                    reload: "1.45秒 (普通)",
                    bulletSpeed: "外側 520 / 中央 860",
                    range: "470 (中〜長距離)",
                    ultCharge: "外側 12% / 中央 26%",
                    power: "外側170・中央520 (貫通)",
                    ultPower: "範囲内の味方を 2800 回復"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <!-- ミントグリーンのとんがり帽子 -->
                        <polygon points="20,2 12,13 28,13" fill="#6ee7b7" stroke="#065f46" stroke-width="1"/>
                        <ellipse cx="20" cy="13" rx="11" ry="2.5" fill="#34d399" stroke="#065f46" stroke-width="1"/>
                        <!-- エルフ耳 -->
                        <polygon points="11,17 7,15 11,20" fill="#f8fafc"/>
                        <polygon points="29,17 33,15 29,20" fill="#f8fafc"/>
                        <!-- 頭部 -->
                        <circle cx="20" cy="18" r="7.5" fill="#f1f5f9"/>
                        <!-- 垂れ白髪 -->
                        <rect x="11.5" y="15" width="2.5" height="10" rx="1" fill="#ffffff"/>
                        <rect x="26" y="15" width="2.5" height="10" rx="1" fill="#ffffff"/>
                        <!-- モノクル＆ウィンク -->
                        <line x1="15.5" y1="18" x2="18.5" y2="18" stroke="#1e293b" stroke-width="1.3"/>
                        <circle cx="23" cy="18" r="2.6" fill="#6ee7b7" stroke="#fef08a" stroke-width="1.2"/>
                        <!-- クリームケープ＆菱形 -->
                        <polygon points="13,25 27,25 29,31 11,31" fill="#fef3c7"/>
                        <polygon points="20,26 22.5,28 20,30 17.5,28" fill="#34d399"/>
                        <!-- ミントローブ -->
                        <polygon points="12,31 28,31 30,38 10,38" fill="#6ee7b7"/>
                    </svg>
                `
            },
            {
                id: "eric",
                name: "エリック",
                enName: "ERIC",
                category: "killer",
                playable: true,
                themeColor: "rose",
                tagline: "紅蓮の忍びマフラーを巻いた黒影の忍者",
                attackName: "影走りの居合斬り",
                attackDesc: "自身が前方へ素早く移動して斬り抜け、軌道に巻き込んだ敵全員に840ダメージを与える！",
                ultName: "紅蓮・影縫いの疾風斬",
                ultDesc: "前方に長く高速ダッシュし、そこにいた敵1体ごとに自身のHPを1000回復＆1340ダメージ！",
                stats: {
                    hp: 7400,
                    speed: "早め (142)",
                    reload: "0.95秒 (早め)",
                    bulletSpeed: "自身突進",
                    range: "120 (ショートダッシュ)",
                    ultCharge: "1発 15% (7発命中でMAX)",
                    power: "840 ダメージ",
                    ultPower: "1340 ダメージ + 1体につき1000回復"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <!-- 黒忍者装束 -->
                        <path d="M10 40 L12 25 L28 25 L30 40 Z" fill="#1e293b"/>
                        <!-- 頭部 -->
                        <circle cx="20" cy="17" r="8" fill="#fcd34d"/>
                        <!-- 黒頭巾 -->
                        <path d="M12 17 A8 8 0 0 1 28 17 L28 25 L12 25 Z" fill="#0f172a"/>
                        <!-- 金属額当て -->
                        <rect x="14" y="9" width="12" height="4" fill="#cbd5e1" stroke="#94a3b8" stroke-width="1"/>
                        <!-- 紅蓮マフラー -->
                        <path d="M12 24 L28 24 L32 30 L8 30 Z" fill="#be123c"/>
                        <!-- 目 -->
                        <circle cx="17" cy="19" r="1.5" fill="#1e293b"/>
                        <circle cx="23" cy="19" r="1.5" fill="#1e293b"/>
                    </svg>
                `
            },
            {
                id: "frost",
                name: "フロスト",
                enName: "FROST",
                category: "controller",
                playable: true,
                themeColor: "cyan",
                tagline: "絶対零度で戦場を支配する氷の帝王",
                attackName: "ブリザード・ブレス",
                attackDesc: "自身に追従する扇形の冷気を放ち2秒間滞留させる(壁貫通なし)。範囲内の敵に毎秒430ダメージ＆1.5秒のスローダウンを付与。",
                ultName: "アブソリュート・ゼロ",
                ultDesc: "指定位置に7秒間残る氷結エリアを展開。毎秒250ダメージを与え、敵をツルツル滑らせてボールも落とさせる！",
                stats: {
                    hp: 7100,
                    speed: "普通 (115)",
                    reload: "1.45秒 (普通)",
                    bulletSpeed: "エリア滞留",
                    range: "360 (中距離・扇形)",
                    ultCharge: "1ヒット 3%",
                    power: "毎秒 430 ダメージ",
                    ultPower: "毎秒 250 ダメージ + スリップ"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <path d="M10 40 L12 25 L28 25 L30 40 Z" fill="#0891b2"/>
                        <path d="M8 26 Q20 30 32 26" fill="none" stroke="#f1f5f9" stroke-width="4"/>
                        <circle cx="20" cy="17" r="8" fill="#e0f2fe"/>
                        <polygon points="12,14 10,4 16,10 20,2 24,10 30,4 28,14" fill="#67e8f9" stroke="#06b6d4" stroke-width="1"/>
                        <circle cx="17" cy="19" r="1.8" fill="#06b6d4"/>
                        <circle cx="23" cy="19" r="1.8" fill="#06b6d4"/>
                    </svg>
                `
            },
            {
                id: "pom",
                name: "ポム＆リル",
                enName: "POM & LIL",
                category: "thrower",
                playable: true,
                themeColor: "purple",
                tagline: "使い魔リルを使役する魔法のフラスコ魔女",
                attackName: "マジック・フラスコ",
                attackDesc: "壁を越えて飛ぶ魔法の瓶を投擲し、着弾時に爆発して範囲ダメージ(850)を与える。",
                ultName: "カモン！リル",
                ultDesc: "体力4200のリルを召喚！リルは毎秒周囲に620ダメージを与え、倒されるとウルトが100%還元される。最大300%ストック可能（最大5匹）。",
                stats: {
                    hp: 6000,
                    speed: "普通 (115)",
                    reload: "1.65秒 (少し遅い)",
                    bulletSpeed: "投擲 (壁越え)",
                    range: "500 (長距離)",
                    ultCharge: "1発 約8.4% (12発命中で100%)",
                    power: "850 範囲ダメージ",
                    ultPower: "リル召喚 (ウルト300%ストック)"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <polygon points="12,18 28,18 20,4" fill="#a855f7"/>
                        <circle cx="20" cy="24" r="8" fill="#fcd34d"/>
                        <circle cx="17" cy="24" r="1.5" fill="#1e293b"/>
                        <circle cx="23" cy="24" r="1.5" fill="#1e293b"/>
                    </svg>
                `
            },
            {
                id: "centaur",
                name: "ケンタウロス",
                enName: "CENTAUR",
                category: "speeder",
                playable: true,
                isTest: true,
                themeColor: "cyan",
                tagline: "【テスト実装・今後正規実装予定】疾走加速と重斧の半人半馬戦士",
                attackName: "チャージアックス",
                attackDesc: "長押し／ドラッグで最大5秒チャージ！最初は250だった火力がフルチャージで700まで上昇し、横幅（攻撃角度）も大きく広がる。弾数2・リロード極遅。",
                ultName: "15m疾風突撃",
                ultDesc: "15m/秒の速度で壁や草むらを破壊しながら前方へ15m突撃！範囲内の敵に700ダメージ＆範囲外へノックバックし、ボールを強制ドロップ。",
                stats: {
                    hp: 7800,
                    speed: "加速型 (3.5 → 最大12.5 / 12超え体当たりでノックバック＆ボール落下)",
                    reload: "3.2秒 (極遅・2発のみ)",
                    bulletSpeed: "近接チャージ斬撃(角度拡大) + 体当たり(350〜1200)",
                    range: "145 (近接扇形) / ウルト15m(壁・草破壊)",
                    ultCharge: "通常10%〜16% / 体当たり8% / 走行で自動チャージ",
                    power: "250〜700 (5秒チャージ・横幅拡大)",
                    ultPower: "700ダメージ + 壁・草破壊 + ノックバック＆ボールドロップ"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <!-- 馬の胴体 -->
                        <ellipse cx="18" cy="28" rx="11" ry="6" fill="#78350f" stroke="#451a03" stroke-width="1.2"/>
                        <!-- 上半身 -->
                        <rect x="18" y="13" width="9" height="12" rx="3" fill="#d97706"/>
                        <!-- 頭部＆兜 -->
                        <circle cx="22.5" cy="10" r="5" fill="#fed7aa"/>
                        <path d="M17 9 Q22.5 3 28 9 Z" fill="#06b6d4"/>
                        <!-- 戦斧 -->
                        <line x1="27" y1="22" x2="34" y2="7" stroke="#cbd5e1" stroke-width="2"/>
                        <path d="M31 6 Q38 8 34 14 Z" fill="#38bdf8" stroke="#e0f2fe" stroke-width="0.8"/>
                    </svg>
                `
            },
            {
                id: "rearn",
                name: "レアーン",
                enName: "REARN",
                category: "attack_dealer",
                playable: true,
                themeColor: "purple",
                tagline: "両手を横に広げた紫衣の呪い操り人形",
                attackName: "マリオネット・カーブ弾",
                attackDesc: "右側と左側に弧を描くように2発(420×2)を発射！壁を貫通して敵をホーミング追尾する。",
                ultName: "ブラッドムーン・パペット",
                ultDesc: "周囲の真円内に敵がいるとウルト蓄積！発動で円内を漆黒のブラッドムーンにし3秒間回転、円内の敵を5秒間人形化！解除時に敵の体力を半分レアーンへ献上させる。",
                stats: {
                    hp: 6200,
                    speed: "早め (138)",
                    reload: "1.65秒 (少し遅め)",
                    bulletSpeed: "500 (壁貫通・ホーミング)",
                    range: "460 (中〜長距離)",
                    ultCharge: "周囲の円内に敵がいると自動蓄積 + 命中6%",
                    power: "420 × 2発 (計840・壁貫通)",
                    ultPower: "敵を5秒間人形化 → 解除時に敵HPの半分をレアーンへ吸収"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <!-- 操作十字バー＆紫の操り糸 -->
                        <line x1="10" y1="5" x2="30" y2="5" stroke="#7e22ce" stroke-width="2.2"/>
                        <line x1="20" y1="5" x2="20" y2="11" stroke="#d8b4fe" stroke-width="0.9"/>
                        <line x1="11" y1="5" x2="7" y2="20" stroke="#d8b4fe" stroke-width="0.9"/>
                        <line x1="29" y1="5" x2="33" y2="20" stroke="#d8b4fe" stroke-width="0.9"/>
                        <!-- 横に広げた両腕 -->
                        <line x1="6" y1="21" x2="34" y2="21" stroke="#e9d5ff" stroke-width="3.5" stroke-linecap="round"/>
                        <circle cx="7" cy="21" r="1.8" fill="#a855f7"/>
                        <circle cx="33" cy="21" r="1.8" fill="#a855f7"/>
                        <!-- 紫のゴシック胴体 -->
                        <polygon points="15,19 25,19 28,31 12,31" fill="#581c87" stroke="#c084fc" stroke-width="1.2"/>
                        <!-- 脚 -->
                        <line x1="17" y1="31" x2="16" y2="38" stroke="#e9d5ff" stroke-width="2.8" stroke-linecap="round"/>
                        <line x1="23" y1="31" x2="24" y2="38" stroke="#e9d5ff" stroke-width="2.8" stroke-linecap="round"/>
                        <!-- 紫がかった操り人形の頭部 -->
                        <circle cx="20" cy="14" r="6" fill="#f3e8ff" stroke="#7e22ce" stroke-width="1.2"/>
                        <circle cx="17.8" cy="13.5" r="1.4" fill="#a855f7"/>
                        <circle cx="22.2" cy="13.5" r="1.4" fill="#a855f7"/>
                        <line x1="17.5" y1="16.8" x2="22.5" y2="16.8" stroke="#4c1d95" stroke-width="1"/>
                    </svg>
                `
            },
            {
                id: "forever",
                name: "フォーエバー",
                enName: "FOREVER",
                category: "sniper",
                playable: true,
                themeColor: "yellow",
                tagline: "弱者を逃さない黄金の蜂スナイパー",
                attackName: "スティンガー・コンボ",
                attackDesc: "通常は400ダメージ(ウルト6%)だが、1発当てると次弾が1500ダメージ(ウルト16%)に強化！リロード1・極遅。目の前の細い範囲にHP半分以下の敵がいる時のみ移動速度2倍＆壁貫通！",
                ultName: "ホーネット・ラッシュ",
                ultDesc: "前方へ毎秒15の速度でダッシュし、5秒間リロードが4つに増加！ケンタウロス最大チャージと同等の超広角範囲攻撃(600ダメージ)を連打できる。",
                stats: {
                    hp: 7400,
                    speed: "普通 (115) / HP半分以下の敵探知で2倍",
                    reload: "2.35秒 (とても遅い・1発のみ / ウルト中4発)",
                    bulletSpeed: "920 (超高速・探知時は壁貫通)",
                    range: "640 (超長距離)",
                    ultCharge: "400弾 6% / 1500弾 16%",
                    power: "400 → 命中後次弾 1500",
                    ultPower: "15m/sダッシュ + 5秒間リロード4＆広角600ダメージ連撃"
                },
                svgMini: `
                    <svg viewBox="0 0 40 40" class="w-8 h-8">
                        <!-- 蜂の羽 -->
                        <ellipse cx="11" cy="18" rx="6" ry="3.5" transform="rotate(-25 11 18)" fill="rgba(224,242,254,0.85)" stroke="#38bdf8" stroke-width="1"/>
                        <ellipse cx="29" cy="18" rx="6" ry="3.5" transform="rotate(25 29 18)" fill="rgba(224,242,254,0.85)" stroke="#38bdf8" stroke-width="1"/>
                        <!-- 縞模様の蜂ボディ -->
                        <ellipse cx="20" cy="25" rx="7.5" ry="9" fill="#facc15" stroke="#1e293b" stroke-width="1.3"/>
                        <rect x="13" y="21" width="14" height="3" fill="#0f172a"/>
                        <rect x="14" y="27" width="12" height="3" fill="#0f172a"/>
                        <!-- 頭部＆触角＆ゴーグル -->
                        <circle cx="20" cy="14" r="6.5" fill="#fde047" stroke="#1e293b" stroke-width="1.2"/>
                        <path d="M17 8 Q14 3 12 5" fill="none" stroke="#0f172a" stroke-width="1.6" stroke-linecap="round"/>
                        <path d="M23 8 Q26 3 28 5" fill="none" stroke="#0f172a" stroke-width="1.6" stroke-linecap="round"/>
                        <rect x="14.5" y="11.5" width="11" height="4" rx="2" fill="#0f172a"/>
                        <circle cx="17.5" cy="13.5" r="1.4" fill="#38bdf8"/>
                        <circle cx="22.5" cy="13.5" r="1.4" fill="#38bdf8"/>
                    </svg>
                `
            }
        ];

        let activeCategoryFilter = "all";
        let selectedBrawlerId = "blaze";
        let selectedGameMode = "gem_grab";

        const GAME_MODES = [
            {
                id: "gem_grab",
                title: "ダイヤモンドハント (3 vs 3)",
                desc: "中央のダイヤモンドを10個集めて15秒守り抜け！",
                accentBorder: "border-cyan-400",
                badgeBg: "bg-cyan-500/20 text-cyan-300 border-cyan-400/50",
                iconBoxClass: "bg-gradient-to-br from-cyan-600 to-blue-900 border-cyan-300/70",
                iconHtml: `<svg viewBox="0 0 24 24" class="w-7 h-7 text-cyan-200"><polygon points="12,2 22,9 12,22 2,9" fill="currentColor" stroke="#ffffff" stroke-width="1.5"/></svg>`
            },
            {
                id: "gem_rush",
                title: "ハイスピード・ダイヤ (3 vs 3)",
                desc: "ダイヤ湧き速度アップ！激しい乱戦の短期決戦モード！",
                accentBorder: "border-amber-400",
                badgeBg: "bg-amber-500/20 text-amber-300 border-amber-400/50",
                iconBoxClass: "bg-gradient-to-br from-amber-500 to-orange-900 border-amber-300/70",
                iconHtml: `<svg viewBox="0 0 24 24" class="w-7 h-7 text-amber-100"><polygon points="12,2 22,9 12,22 2,9" fill="currentColor" stroke="#ffffff" stroke-width="1.5"/></svg>`
            },
            {
                id: "kickoff_soccer",
                title: "キックオフサッカー (3 vs 3)",
                desc: "2点先取！失点側にボール出現／3分1-1でサドンデス壁消滅！",
                accentBorder: "border-emerald-400",
                badgeBg: "bg-emerald-500/20 text-emerald-300 border-emerald-400/50",
                iconBoxClass: "bg-gradient-to-br from-emerald-600 to-teal-950 border-emerald-300/70 text-2xl",
                iconHtml: `⚽`
            },
            {
                id: "danger_zone",
                title: "危険地帯 (3 vs 3)",
                desc: "中央の大きな円を先に100%まで踏め！壁多め＆草むら超多め！",
                accentBorder: "border-rose-400",
                badgeBg: "bg-rose-500/20 text-rose-300 border-rose-400/50",
                iconBoxClass: "bg-gradient-to-br from-rose-600 to-amber-950 border-rose-300/70 text-2xl",
                iconHtml: `⚠️`
            },
            {
                id: "knockout",
                title: "ノックアウト (3 vs 3)",
                desc: "死んだらアウト（復活なし）！全員倒して＋1点、5本勝負で先に3本取ったら勝利！",
                accentBorder: "border-red-500",
                badgeBg: "bg-red-500/20 text-red-300 border-red-400/50",
                iconBoxClass: "bg-gradient-to-br from-red-600 to-rose-950 border-red-300/70 text-2xl",
                iconHtml: `💀`
            }
        ];

        // 味方・敵ボット用の個別名前プール（日本語名を含む）
        const ALLY_BOT_NAMES = ["ハヤテ", "ダークナイト", "シノビ丸", "ミコト", "アレス"];
        const ENEMY_BOT_NAMES = ["クリムゾン", "クロガネ", "カゲロウ", "ベノム", "リュウセイ", "アカツキ"];

        function getCategoryMeta(catId) {
            return CATEGORIES.find((c) => c.id === catId) || CATEGORIES[0];
        }

        function getSelectedBrawlerData() {
            return BRAWLER_ROSTER.find((b) => b.id === selectedBrawlerId) || BRAWLER_ROSTER[0];
        }

        function getSelectedModeData() {
            return GAME_MODES.find((m) => m.id === selectedGameMode) || GAME_MODES[0];
        }

        function renderModeSelectModal() {
            const grid = document.getElementById("modeListGrid");
            if (!grid) return;
            grid.innerHTML = GAME_MODES.map((m) => {
                const isSelected = m.id === selectedGameMode;
                return `
                    <button type="button" onclick="selectGameMode('${m.id}', true)"
                        class="brawl-btn rounded-2xl border-2 p-3.5 sm:p-4 text-left flex items-center gap-3.5 transition cursor-pointer ${
                            isSelected
                                ? `${m.accentBorder} bg-slate-800/95 shadow-[0_0_20px_rgba(251,191,36,0.28)]`
                                : "border-slate-700/80 bg-slate-900/85 hover:border-slate-500"
                        }">
                        <div class="w-14 h-14 rounded-2xl border-2 ${m.iconBoxClass} flex items-center justify-center shrink-0 shadow-inner">
                            ${m.iconHtml}
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-2 mb-0.5">
                                <span class="text-sm sm:text-base font-black text-white truncate">${m.title}</span>
                                ${isSelected ? `<span class="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-400 text-slate-950 shrink-0">選択中</span>` : ""}
                            </div>
                            <p class="text-[11px] sm:text-xs text-slate-300 leading-snug">${m.desc}</p>
                        </div>
                    </button>
                `;
            }).join("");
        }

        window.selectGameMode = function (modeId, closeAfterSelect = false) {
            selectedGameMode = modeId;
            const mode = getSelectedModeData();
            const titleEl = document.getElementById("selectedModeTitle");
            const descEl = document.getElementById("selectedModeDesc");
            const iconBox = document.getElementById("selectedModeIconBox");

            if (titleEl) titleEl.textContent = mode.title;
            if (descEl) descEl.textContent = mode.desc;
            if (iconBox) {
                iconBox.className = `w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border-2 ${mode.iconBoxClass} flex items-center justify-center shrink-0 shadow-inner group-hover:scale-105 transition`;
                iconBox.innerHTML = mode.iconHtml;
            }

            renderModeSelectModal();
            if (closeAfterSelect) {
                const modal = document.getElementById("modeSelectModal");
                if (modal) modal.classList.add("hidden");
            }
        };

        // ホームロビーの表示内容を現在の選択キャラに合わせて更新
        function updateHomeLobbyUI() {
            const sel = getSelectedBrawlerData();
            const catMeta = getCategoryMeta(sel.category);
            const miniEl = document.getElementById("homeSelectedMiniIcon");
            const catEl = document.getElementById("homeSelectedCatBadge");
            const nameEl = document.getElementById("homeHeroNameDisplay");
            const tagEl = document.getElementById("homeHeroSubTag");

            if (miniEl) miniEl.innerHTML = sel.svgMini;
            if (catEl) {
                catEl.textContent = catMeta.name;
                catEl.className = `px-2 py-0.5 rounded-full text-[9px] font-bold border ${catMeta.badgeClass}`;
            }
            if (nameEl) nameEl.textContent = `${sel.enName} - ${sel.name}`;
            if (tagEl) tagEl.textContent = sel.tagline;
        }

        // キャラ選択UIの描画
        function renderCharacterSelectUI() {
            const tabsContainer = document.getElementById("categoryTabs");
            const gridContainer = document.getElementById("brawlerGrid");
            const detailContainer = document.getElementById("selectedCharDetail");

            // 1. カテゴリータブ描画
            tabsContainer.innerHTML = CATEGORIES.map((cat) => {
                const isActive = activeCategoryFilter === cat.id;
                return `
                    <button onclick="setCategoryFilter('${cat.id}')"
                        class="px-2.5 py-1 rounded-full text-[11px] font-bold border transition cursor-pointer ${
                            isActive
                                ? "bg-amber-400 text-slate-950 border-amber-200 shadow-md scale-105"
                                : "bg-slate-900/90 text-slate-300 border-slate-700 hover:border-slate-500"
                        }">
                        ${cat.name}
                    </button>
                `;
            }).join("");

            // 2. フィルタリングされたキャラカード一覧描画
            const filtered = activeCategoryFilter === "all"
                ? BRAWLER_ROSTER
                : BRAWLER_ROSTER.filter((b) => b.category === activeCategoryFilter);

            gridContainer.innerHTML = filtered.map((b) => {
                const catMeta = getCategoryMeta(b.category);
                const isSelected = b.id === selectedBrawlerId;

                if (!b.playable) {
                    return `
                        <div class="rounded-2xl bg-slate-950/60 border border-slate-800/90 p-2.5 flex flex-col items-center justify-between opacity-65">
                            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold border ${catMeta.badgeClass} mb-1">
                                ${catMeta.name}
                            </span>
                            <div class="w-11 h-11 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600 font-black text-lg my-1">
                                ?
                            </div>
                            <div class="text-xs font-bold text-slate-400 truncate w-full">${b.name}</div>
                            <div class="text-[9px] text-slate-500 truncate w-full">${b.tagline}</div>
                        </div>
                    `;
                }

                const borderStyle = isSelected
                    ? (b.id === "viper"
                        ? "border-pink-400 bg-gradient-to-b from-pink-950/90 to-slate-900 shadow-[0_0_18px_rgba(244,114,182,0.4)] scale-[1.02]"
                        : b.id === "titan"
                        ? "border-purple-400 bg-gradient-to-b from-purple-950/90 to-slate-900 shadow-[0_0_18px_rgba(192,132,252,0.4)] scale-[1.02]"
                        : b.id === "saital"
                        ? "border-emerald-400 bg-gradient-to-b from-emerald-950/90 to-slate-900 shadow-[0_0_18px_rgba(52,211,153,0.4)] scale-[1.02]"
                        : b.id === "centaur"
                        ? "border-cyan-400 bg-gradient-to-b from-cyan-950/90 to-slate-900 shadow-[0_0_18px_rgba(34,211,238,0.4)] scale-[1.02]"
                        : b.id === "rearn"
                        ? "border-purple-400 bg-gradient-to-b from-purple-950/95 to-slate-950 shadow-[0_0_18px_rgba(168,85,247,0.5)] scale-[1.02]"
                        : b.id === "forever"
                        ? "border-yellow-400 bg-gradient-to-b from-yellow-950/90 to-slate-900 shadow-[0_0_18px_rgba(250,204,21,0.45)] scale-[1.02]"
                        : "border-amber-400 bg-gradient-to-b from-red-950/90 to-slate-900 shadow-[0_0_18px_rgba(250,204,21,0.35)] scale-[1.02]")
                    : "border-slate-700/80 bg-slate-900/80 hover:border-slate-500";

                const selectedTextClass = b.id === "viper"
                    ? "text-pink-300"
                    : b.id === "titan"
                    ? "text-purple-300"
                    : b.id === "saital"
                    ? "text-emerald-300"
                    : b.id === "centaur"
                    ? "text-cyan-300"
                    : b.id === "rearn"
                    ? "text-purple-300"
                    : b.id === "forever"
                    ? "text-yellow-300"
                    : "text-amber-300";

                const testBadge = b.isTest
                    ? `<span class="px-1.5 py-0.5 rounded bg-yellow-400 text-slate-950 text-[8px] font-black ml-1">TEST</span>`
                    : "";

                return `
                    <button onclick="selectBrawler('${b.id}')"
                        class="rounded-2xl border-2 p-2 flex flex-col items-center justify-between transition cursor-pointer ${borderStyle}">
                        <div class="flex items-center justify-center mb-1">
                            <span class="px-2 py-0.5 rounded-full text-[9px] font-bold border ${catMeta.badgeClass}">
                                ${catMeta.name}
                            </span>
                            ${testBadge}
                        </div>
                        <div class="my-0.5">${b.svgMini}</div>
                        <div class="text-xs sm:text-sm font-black text-white">${b.name}</div>
                        <div class="text-[9px] font-bold ${isSelected ? selectedTextClass : "text-slate-400"}">
                            ${isSelected ? "★ 選択中" : "タップで選択"}
                        </div>
                    </button>
                `;
            }).join("");

            // 3. 選択中キャラの詳細パネル描画（ウルトチャージ率・弾速・移動速度・リロード速度などを網羅）
            const sel = getSelectedBrawlerData();
            const selCat = getCategoryMeta(sel.category);
            const nameColor = sel.id === "viper"
                ? "text-pink-300"
                : sel.id === "titan"
                ? "text-purple-300"
                : sel.id === "saital"
                ? "text-emerald-300"
                : sel.id === "centaur"
                ? "text-cyan-300"
                : sel.id === "rearn"
                ? "text-purple-300"
                : sel.id === "forever"
                ? "text-yellow-300"
                : "text-amber-300";

            const stageNameEl = document.getElementById("heroStageName");
            if (stageNameEl) {
                stageNameEl.textContent = `${sel.enName} - ${sel.name}`;
                stageNameEl.className = `text-xs font-black tracking-wider z-10 ${nameColor}`;
            }

            detailContainer.innerHTML = `
                <div class="space-y-1.5 text-center sm:text-left">
                    <div class="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                        <span class="text-base sm:text-lg font-black ${nameColor}">${sel.name} (${sel.enName})</span>
                        <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border ${selCat.badgeClass}">${selCat.name}</span>
                        <span class="text-[11px] text-slate-400 hidden md:inline">- ${sel.tagline}</span>
                    </div>

                    <!-- 通常攻撃 ＆ ウルト性能 -->
                    <div class="text-xs text-slate-200 space-y-1">
                        <div class="flex items-start gap-1.5">
                            <span class="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold text-[10px] shrink-0">通常攻撃</span>
                            <span class="text-[11px] leading-snug"><strong>${sel.attackName}：</strong>${sel.attackDesc}</span>
                        </div>
                        <div class="flex items-start gap-1.5">
                            <span class="px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300 font-bold text-[10px] shrink-0">ウルト</span>
                            <span class="text-[11px] leading-snug"><strong>${sel.ultName}：</strong>${sel.ultDesc}</span>
                        </div>
                    </div>

                    <!-- 詳細スペック一覧グリッド -->
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pt-1 text-[10px]">
                        <div class="bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1">
                            <span class="text-slate-400 block">HP / 移動速度</span>
                            <strong class="text-emerald-300">${sel.stats.hp}</strong> / <strong class="text-slate-100">${sel.stats.speed}</strong>
                        </div>
                        <div class="bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1">
                            <span class="text-slate-400 block">通常火力 / 弾速</span>
                            <strong class="text-amber-300">${sel.stats.power}</strong> / <strong class="text-sky-300">${sel.stats.bulletSpeed}</strong>
                        </div>
                        <div class="bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1">
                            <span class="text-slate-400 block">リロード速度 / 射程</span>
                            <strong class="text-cyan-300">${sel.stats.reload}</strong> / <strong class="text-slate-200">${sel.stats.range}</strong>
                        </div>
                        <div class="bg-slate-900/90 border border-slate-800 rounded-lg px-2 py-1 col-span-2 sm:col-span-3 flex flex-wrap items-center justify-between gap-2">
                            <span><span class="text-slate-400">ウルト性能：</span><strong class="text-yellow-300">${sel.stats.ultPower}</strong></span>
                            <span><span class="text-slate-400">ウルトチャージ率：</span><strong class="text-fuchsia-300">${sel.stats.ultCharge}</strong></span>
                        </div>
                    </div>
                </div>
            `;
        }

        window.setCategoryFilter = function (catId) {
            activeCategoryFilter = catId;
            renderCharacterSelectUI();
        };

        window.selectBrawler = function (brawlerId) {
            selectedBrawlerId = brawlerId;
            renderCharacterSelectUI();
            updateHomeLobbyUI();
        };

        // ----------------------------------------------------------------------------
        // 1. サウンドシステム（Tone.js によるシンセ効果音）
        // ----------------------------------------------------------------------------
        class SoundEngine {
            constructor() {
                this.enabled = true;
                this.initialized = false;
                this.lastHitTime = 0;
                this.lastGemTime = 0;
            }

            async init() {
                if (this.initialized) return;
                try {
                    await Tone.start();
                    this.shootSynth = new Tone.PolySynth(Tone.Synth, {
                        oscillator: { type: "triangle" },
                        envelope: { attack: 0.005, decay: 0.12, sustain: 0, release: 0.08 }
                    }).toDestination();
                    this.shootSynth.volume.value = -10;

                    this.hitSynth = new Tone.MembraneSynth({
                        pitchDecay: 0.03,
                        octaves: 3,
                        envelope: { attack: 0.001, decay: 0.15, sustain: 0 }
                    }).toDestination();
                    this.hitSynth.volume.value = -8;

                    this.dashNoise = new Tone.NoiseSynth({
                        noise: { type: "pink" },
                        envelope: { attack: 0.01, decay: 0.22, sustain: 0 }
                    }).toDestination();
                    this.dashNoise.volume.value = -9;

                    this.gemSynth = new Tone.Synth({
                        oscillator: { type: "sine" },
                        envelope: { attack: 0.005, decay: 0.18, sustain: 0.05, release: 0.2 }
                    }).toDestination();
                    this.gemSynth.volume.value = -8;

                    this.initialized = true;
                } catch (e) {}
            }

            toggle() {
                this.enabled = !this.enabled;
                return this.enabled;
            }

            playShoot() {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    this.shootSynth.triggerAttackRelease(["C4", "E4", "G4"], "32n", now);
                } catch (e) {}
            }

            playSniperShoot() {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    this.hitSynth.triggerAttackRelease("C3", "16n", now + 0.002);
                    this.shootSynth.triggerAttackRelease(["A4", "E5"], "32n", now);
                } catch (e) {}
            }

            playPiercingUlt() {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    this.dashNoise.triggerAttackRelease("16n", now);
                    this.hitSynth.triggerAttackRelease("G1", "8n", now + 0.002);
                    this.shootSynth.triggerAttackRelease(["D4", "A4", "F#5"], "16n", now);
                } catch (e) {}
            }

            playHit() {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    // 単音シンセの連続発音衝突を防ぐ（0.04秒間隔）
                    if (now - this.lastHitTime < 0.04) return;
                    this.lastHitTime = now;
                    this.hitSynth.triggerAttackRelease("G2", "32n", now + 0.002);
                } catch (e) {}
            }

            playDash() {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    this.dashNoise.triggerAttackRelease("16n", now);
                    this.shootSynth.triggerAttackRelease(["G4", "D5"], "16n", now);
                } catch (e) {}
            }

            playGem() {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    if (now - this.lastGemTime < 0.05) return;
                    this.lastGemTime = now;
                    this.gemSynth.triggerAttackRelease("B5", "32n", now + 0.002);
                    this.gemSynth.triggerAttackRelease("E6", "16n", now + 0.055);
                } catch (e) {}
            }

            playUltReady() {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    this.gemSynth.triggerAttackRelease("E5", "32n", now + 0.005);
                    this.gemSynth.triggerAttackRelease("G#5", "32n", now + 0.065);
                    this.gemSynth.triggerAttackRelease("B5", "16n", now + 0.125);
                } catch (e) {}
            }

            playEnd(win) {
                if (!this.enabled || !this.initialized) return;
                try {
                    const now = Tone.now();
                    if (win) {
                        this.shootSynth.triggerAttackRelease(["C5", "E5", "G5"], "8n", now);
                        this.shootSynth.triggerAttackRelease(["E5", "G5", "C6"], "4n", now + 0.18);
                    } else {
                        this.shootSynth.triggerAttackRelease(["A3", "C4", "E4"], "8n", now);
                        this.shootSynth.triggerAttackRelease(["F3", "A3", "C4"], "4n", now + 0.22);
                    }
                } catch (e) {}
            }
        }

        const sound = new SoundEngine();

        // ----------------------------------------------------------------------------
        // 2. Canvas & マップ定数・状態管理
        // ----------------------------------------------------------------------------
        const canvas = document.getElementById("gameCanvas");
        const ctx = canvas.getContext("2d");

        const TILE_SIZE = 56;
        const MAP_COLS = 26;
        const MAP_ROWS = 18;
        const MAP_WIDTH = MAP_COLS * TILE_SIZE;
        const MAP_HEIGHT = MAP_ROWS * TILE_SIZE;

        // タイル種別: 0=石畳床, 1=2.5D石壁, 2=ダークブッシュ(草むら), 3=壊せる骨箱, 4=ジェム鉱脈, 5=松明の柱
        function createArenaMap() {
            const grid = [];
            for (let r = 0; r < MAP_ROWS; r++) {
                const row = [];
                for (let c = 0; c < MAP_COLS; c++) {
                    if (r === 0 || r === MAP_ROWS - 1 || c === 0 || c === MAP_COLS - 1) {
                        row.push(1); // 外周の壁
                    } else {
                        row.push(0);
                    }
                }
                grid.push(row);
            }

            // 中央ジェム鉱脈
            grid[8][12] = 4;
            grid[8][13] = 4;
            grid[9][12] = 4;
            grid[9][13] = 4;

            // 対称配置の2.5D石壁カバー
            const wallCoords = [
                [4, 5], [5, 5], [12, 5], [13, 5],
                [4, 20], [5, 20], [12, 20], [13, 20],
                [6, 9], [7, 9], [10, 9], [11, 9],
                [6, 16], [7, 16], [10, 16], [11, 16],
                [3, 12], [3, 13], [14, 12], [14, 13]
            ];
            wallCoords.forEach(([r, c]) => { grid[r][c] = 1; });

            // 松明（光源柱）
            const torchCoords = [
                [2, 4], [15, 4], [2, 21], [15, 21],
                [5, 12], [12, 13]
            ];
            torchCoords.forEach(([r, c]) => { grid[r][c] = 5; });

            // 隠密用ダークブッシュ（草むら）
            const bushCoords = [
                [7, 6], [8, 6], [9, 6], [10, 6],
                [7, 19], [8, 19], [9, 19], [10, 19],
                [2, 10], [2, 11], [2, 14], [2, 15],
                [15, 10], [15, 11], [15, 14], [15, 15],
                [8, 10], [9, 10], [8, 15], [9, 15]
            ];
            bushCoords.forEach(([r, c]) => { grid[r][c] = 2; });

            // 壊せる骨箱（ジェム入り）
            const crateCoords = [
                [4, 8], [13, 8], [4, 17], [13, 17],
                [6, 12], [11, 13]
            ];
            crateCoords.forEach(([r, c]) => { grid[r][c] = 3; });

            return grid;
        }

        function createSoccerArenaMap() {
            const grid = [];
            for (let r = 0; r < MAP_ROWS; r++) {
                const row = [];
                for (let c = 0; c < MAP_COLS; c++) {
                    // 左右の中央（行6〜11）はゴールマウスとして開放
                    const isGoalOpening = (r >= 6 && r <= 11);
                    if (r === 0 || r === MAP_ROWS - 1) {
                        row.push(1);
                    } else if ((c === 0 || c === MAP_COLS - 1) && !isGoalOpening) {
                        row.push(1);
                    } else {
                        row.push(0);
                    }
                }
                grid.push(row);
            }

            // ゴール前のガード壁（サドンデスで消滅する障害物）をボットが滑りやすい直線的な形に整理
            const wallCoords = [
                // 左ゴール前ガード（上下の直線ブロック）
                [4, 4], [5, 4], [6, 4], [7, 4],
                [10, 4], [11, 4], [12, 4], [13, 4],
                
                // 右ゴール前ガード（上下の直線ブロック）
                [4, 21], [5, 21], [6, 21], [7, 21],
                [10, 21], [11, 21], [12, 21], [13, 21],

                // フィールド中盤の壁（上下）
                [4, 10], [5, 10], [12, 10], [13, 10],
                [4, 15], [5, 15], [12, 15], [13, 15],
                
                // センターライン付近の壁
                [3, 12], [4, 12], [13, 12], [14, 12],
                [3, 13], [4, 13], [13, 13], [14, 13]
            ];
            wallCoords.forEach(([r, c]) => { grid[r][c] = 1; });

            // サイドの隠密用ダークブッシュ
            const bushCoords = [
                [2, 7], [2, 8], [2, 17], [2, 18],
                [15, 7], [15, 8], [15, 17], [15, 18]
            ];
            bushCoords.forEach(([r, c]) => { grid[r][c] = 2; });

            return grid;
        }

        function createDangerZoneArenaMap() {
            const grid = [];
            for (let r = 0; r < MAP_ROWS; r++) {
                const row = [];
                for (let c = 0; c < MAP_COLS; c++) {
                    if (r === 0 || r === MAP_ROWS - 1 || c === 0 || c === MAP_COLS - 1) {
                        row.push(1);
                    } else {
                        row.push(0);
                    }
                }
                grid.push(row);
            }

            // 危険地帯専用：壁多め（左右対称のカバー＆遮蔽物）
            const wallCoords = [
                // サイドレーン遮蔽壁
                [3, 4], [4, 4], [13, 4], [14, 4],
                [3, 21], [4, 21], [13, 21], [14, 21],
                // 中盤ゲート壁
                [6, 5], [7, 5], [10, 5], [11, 5],
                [6, 20], [7, 20], [10, 20], [11, 20],
                // 上下ルート遮蔽壁
                [2, 9], [3, 9], [14, 9], [15, 9],
                [2, 16], [3, 16], [14, 16], [15, 16],
                // 中央円外周の戦略壁（射線切り用）
                [5, 8], [6, 8], [11, 8], [12, 8],
                [5, 17], [6, 17], [11, 17], [12, 17],
                [4, 12], [4, 13], [13, 12], [13, 13]
            ];
            wallCoords.forEach(([r, c]) => { grid[r][c] = 1; });

            // 松明（光源柱）
            const torchCoords = [
                [2, 3], [15, 3], [2, 22], [15, 22]
            ];
            torchCoords.forEach(([r, c]) => { grid[r][c] = 5; });

            // 危険地帯専用：草むらとても多め（広大なジャングル＆中央外周ブッシュ）
            for (let r = 1; r < MAP_ROWS - 1; r++) {
                for (let c = 1; c < MAP_COLS - 1; c++) {
                    if (grid[r][c] !== 0) continue;
                    // リスポーン直近は開けておく
                    if ((c <= 3 && r >= 6 && r <= 11) || (c >= 22 && r >= 6 && r <= 11)) continue;

                    const inUpperJungle = (r >= 1 && r <= 4 && c >= 5 && c <= 20);
                    const inLowerJungle = (r >= 13 && r <= 16 && c >= 5 && c <= 20);
                    const inSideBush = ((c >= 6 && c <= 7) || (c >= 18 && c <= 19)) && (r >= 5 && r <= 12);
                    const inCenterRingBush = (r >= 6 && r <= 11 && c >= 9 && c <= 16) && !(r >= 7 && r <= 10 && c >= 11 && c <= 14);

                    if (inUpperJungle || inLowerJungle || inSideBush || inCenterRingBush) {
                        grid[r][c] = 2;
                    }
                }
            }

            return grid;
        }

        function createKnockoutArenaMap() {
            const grid = [];
            for (let r = 0; r < MAP_ROWS; r++) {
                const row = [];
                for (let c = 0; c < MAP_COLS; c++) {
                    if (r === 0 || r === MAP_ROWS - 1 || c === 0 || c === MAP_COLS - 1) {
                        row.push(1);
                    } else {
                        row.push(0);
                    }
                }
                grid.push(row);
            }

            // ノックアウト専用：駆け引きしやすい対称カバー配置
            const wallCoords = [
                [4, 5], [5, 5], [12, 5], [13, 5],
                [4, 20], [5, 20], [12, 20], [13, 20],
                [7, 8], [8, 8], [9, 8], [10, 8],
                [7, 17], [8, 17], [9, 17], [10, 17],
                [3, 12], [3, 13], [14, 12], [14, 13],
                [8, 12], [9, 13]
            ];
            wallCoords.forEach(([r, c]) => { grid[r][c] = 1; });

            // 松明（光源柱）
            const torchCoords = [
                [2, 4], [15, 4], [2, 21], [15, 21]
            ];
            torchCoords.forEach(([r, c]) => { grid[r][c] = 5; });

            // 奇襲用の草むら
            const bushCoords = [
                [2, 9], [2, 10], [3, 9], [3, 10],
                [2, 15], [2, 16], [3, 15], [3, 16],
                [14, 9], [14, 10], [15, 9], [15, 10],
                [14, 15], [14, 16], [15, 15], [15, 16],
                [7, 11], [10, 11], [7, 14], [10, 14]
            ];
            bushCoords.forEach(([r, c]) => { grid[r][c] = 2; });

            return grid;
        }

        const gameState = {
            status: "menu", // 'menu' | 'intro' | 'playing' | 'ended'
            map: createArenaMap(),
            entities: [],
            projectiles: [],
            zones: [], // 追加：滞留エリア用
            gems: [],
            particles: [],
            shockwaves: [],
            floatingTexts: [],
            afterimages: [],
            camera: { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2, shake: 0 },
            gemSpawnerTimer: 2.0,
            blueGems: 0,
            redGems: 0,
            countdownTimer: 15.0,
            countdownTeam: null,
            dangerZone: {
                active: false,
                x: MAP_WIDTH / 2,
                y: MAP_HEIGHT / 2,
                radius: 175,
                blueProgress: 0,
                redProgress: 0,
                bluePresent: false,
                redPresent: false,
                contested: false
            },
            knockout: {
                active: false,
                blueRounds: 0,
                redRounds: 0,
                currentRound: 1,
                roundResetTimer: 0,
                lastRoundWinner: null
            },
            soccer: {
                active: false,
                blueGoals: 0,
                redGoals: 0,
                matchTimer: 180.0, // 3分（180秒）
                suddenDeath: false,
                goalResetTimer: 0,
                ball: {
                    x: MAP_WIDTH / 2,
                    y: MAP_HEIGHT / 2,
                    vx: 0,
                    vy: 0,
                    radius: 15,
                    holderId: null,
                    pickupCooldown: 0,
                    superShot: false,
                    spin: 0
                }
            },
            stats: { kills: 0, damage: 0 },
            time: 0
        };

        // ----------------------------------------------------------------------------
        // 3. レスポンシブCanvas管理
        // ----------------------------------------------------------------------------
        let viewWidth = window.innerWidth;
        let viewHeight = window.innerHeight;

        function resizeCanvas() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            viewWidth = window.innerWidth;
            viewHeight = window.innerHeight;
            canvas.width = Math.floor(viewWidth * dpr);
            canvas.height = Math.floor(viewHeight * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            updateDefaultStickPositions();
        }

        window.addEventListener("resize", resizeCanvas);

        // ----------------------------------------------------------------------------
        // 4. 入力管理（キーボード・マウス・タッチ用デュアルバーチャルスティック＆中央キャンセル）
        // ----------------------------------------------------------------------------
        const input = {
            keys: {},
            mouse: { x: 0, y: 0, active: false },
            mouseCharge: { active: false, angle: 0 },
            moveStick: {
                active: false,
                touchId: null,
                baseX: 110,
                baseY: viewHeight - 110,
                currX: 110,
                currY: viewHeight - 110,
                dx: 0,
                dy: 0,
                radius: 52
            },
            attackStick: {
                active: false,
                touchId: null,
                baseX: viewWidth - 110,
                baseY: viewHeight - 110,
                currX: viewWidth - 110,
                currY: viewHeight - 110,
                startX: 0,
                startY: 0,
                dx: 0,
                dy: 0,
                dragDist: 0,
                maxDragDist: 0,
                maxMovedDist: 0,
                isCanceled: false,
                radius: 54
            },
            ultStick: {
                active: false,
                touchId: null,
                baseX: viewWidth - 205,
                baseY: viewHeight - 175,
                currX: viewWidth - 205,
                currY: viewHeight - 175,
                startX: 0,
                startY: 0,
                dx: 0,
                dy: 0,
                dragDist: 0,
                maxDragDist: 0,
                maxMovedDist: 0,
                isCanceled: false,
                radius: 42
            }
        };

        function updateDefaultStickPositions() {
            const margin = viewWidth < 640 ? 85 : 115;
            const bottomY = viewHeight - (viewWidth < 640 ? 90 : 115);

            if (!input.moveStick.active) {
                input.moveStick.baseX = margin;
                input.moveStick.baseY = bottomY;
                input.moveStick.currX = margin;
                input.moveStick.currY = bottomY;
            }
            if (!input.attackStick.active) {
                input.attackStick.baseX = viewWidth - margin;
                input.attackStick.baseY = bottomY;
                input.attackStick.currX = viewWidth - margin;
                input.attackStick.currY = bottomY;
            }
            if (!input.ultStick.active) {
                input.ultStick.baseX = viewWidth - margin - (viewWidth < 640 ? 82 : 98);
                input.ultStick.baseY = bottomY - (viewWidth < 640 ? 58 : 72);
                input.ultStick.currX = input.ultStick.baseX;
                input.ultStick.currY = input.ultStick.baseY;
            }
        }

        function getPlayer() {
            return gameState.entities.find((e) => e.isPlayer);
        }

        function getAutoAimAngle(shooter) {
            return getAutoAimData(shooter).angle;
        }

        function getAutoAimData(shooter) {
            let nearest = null;
            let minDist = Math.max(shooter.range * 1.45, 620);
            for (const other of gameState.entities) {
                if (other.dead || other.team === shooter.team) continue;
                const d = Math.hypot(other.x - shooter.x, other.y - shooter.y);
                if (other.inBush && other.revealedTimer <= 0 && d > 165) continue;
                if (d < minDist) {
                    minDist = d;
                    nearest = other;
                }
            }
            return nearest
                ? { angle: Math.atan2(nearest.y - shooter.y, nearest.x - shooter.x), dist: Math.min(shooter.range, minDist) }
                : { angle: shooter.facingAngle, dist: Math.min(shooter.range, 300) };
        }

        function spawnGem(x, y, scatter) {
            const angle = Math.random() * Math.PI * 2;
            const speed = scatter ? 120 + Math.random() * 140 : 0;
            gameState.gems.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                bobPhase: Math.random() * Math.PI * 2,
                pickupDelay: scatter ? 0.35 : 0
            });
        }

        function spawnParticles(x, y, color, count, speed) {
            for (let i = 0; i < count; i++) {
                const a = Math.random() * Math.PI * 2;
                const s = (0.25 + Math.random() * 0.75) * speed;
                const life = 0.22 + Math.random() * 0.25;
                gameState.particles.push({
                    x,
                    y,
                    vx: Math.cos(a) * s,
                    vy: Math.sin(a) * s,
                    color,
                    radius: 2.5 + Math.random() * 3,
                    life,
                    maxLife: life
                });
            }
        }

        function spawnFloatingText(x, y, text, color) {
            gameState.floatingTexts.push({
                x,
                y,
                text,
                color,
                life: 0.85,
                maxLife: 0.85
            });
        }

        let toastTimeout = null;
        function showToast(msg) {
            const el = document.getElementById("toastMessage");
            if (!el) return;
            el.textContent = msg;
            el.style.opacity = "1";
            if (toastTimeout) clearTimeout(toastTimeout);
            toastTimeout = setTimeout(() => {
                el.style.opacity = "0";
            }, 1800);
        }

        function updateAimStickDrag(stick, clientX, clientY) {
            const dx = clientX - stick.baseX;
            const dy = clientY - stick.baseY;
            const dist = Math.hypot(dx, dy);
            const movedDist = Math.hypot(clientX - stick.startX, clientY - stick.startY);
            const clamped = Math.min(stick.radius, dist);
            const angle = Math.atan2(dy, dx);

            stick.currX = stick.baseX + Math.cos(angle) * clamped;
            stick.currY = stick.baseY + Math.sin(angle) * clamped;
            stick.dx = dist > 0.001 ? dx / dist : 0;
            stick.dy = dist > 0.001 ? dy / dist : 0;
            stick.dragDist = dist;
            if (dist > stick.maxDragDist) stick.maxDragDist = dist;
            if (movedDist > stick.maxMovedDist) stick.maxMovedDist = movedDist;

            // 外側に引いた後、真ん中へ戻したらキャンセル状態にする
            stick.isCanceled = stick.maxMovedDist > 20 && stick.maxDragDist > 22 && dist < 16;
        }

        function resetStick(stick) {
            stick.active = false;
            stick.touchId = null;
            stick.currX = stick.baseX;
            stick.currY = stick.baseY;
            stick.startX = 0;
            stick.startY = 0;
            stick.dx = 0;
            stick.dy = 0;
            stick.dragDist = 0;
            stick.maxDragDist = 0;
            stick.maxMovedDist = 0;
            stick.isCanceled = false;
        }

        window.addEventListener("keydown", (e) => {
            input.keys[e.code] = true;
            if (gameState.status !== "playing") return;
            const player = getPlayer();
            if (!player || player.dead) return;

            if (e.code === "Space" || e.code === "KeyE") {
                e.preventDefault();
                if (player.ultCharge >= 100) {
                    const target = getAutoAimData(player);
                    triggerBrawlerUlt(player, target.angle, target.dist);
                }
            }
        });

        window.addEventListener("keyup", (e) => {
            input.keys[e.code] = false;
        });

        canvas.addEventListener("mousemove", (e) => {
            input.mouse.x = e.clientX;
            input.mouse.y = e.clientY;
            input.mouse.active = true;

            if (input.attackStick.active) {
                updateAimStickDrag(input.attackStick, e.clientX, e.clientY);
            } else if (input.ultStick.active) {
                updateAimStickDrag(input.ultStick, e.clientX, e.clientY);
            }
        });

        canvas.addEventListener("mousedown", (e) => {
            if (gameState.status !== "playing") return;
            const player = getPlayer();
            if (!player || player.dead) return;

            const distToAttack = Math.hypot(e.clientX - input.attackStick.baseX, e.clientY - input.attackStick.baseY);
            const distToUlt = Math.hypot(e.clientX - input.ultStick.baseX, e.clientY - input.ultStick.baseY);

            if (e.button === 0) {
                if (distToUlt <= input.ultStick.radius + 10 && player.ultCharge >= 100) {
                    input.ultStick.active = true;
                    input.ultStick.startX = e.clientX;
                    input.ultStick.startY = e.clientY;
                    input.ultStick.maxDragDist = 0;
                    input.ultStick.maxMovedDist = 0;
                    input.ultStick.isCanceled = false;
                    updateAimStickDrag(input.ultStick, e.clientX, e.clientY);
                    return;
                }
                if (distToAttack <= input.attackStick.radius + 10) {
                    input.attackStick.active = true;
                    input.attackStick.startX = e.clientX;
                    input.attackStick.startY = e.clientY;
                    input.attackStick.maxDragDist = 0;
                    input.attackStick.maxMovedDist = 0;
                    input.attackStick.isCanceled = false;
                    updateAimStickDrag(input.attackStick, e.clientX, e.clientY);
                    return;
                }

                const worldMouseX = e.clientX - viewWidth / 2 + gameState.camera.x;
                const worldMouseY = e.clientY - viewHeight / 2 + gameState.camera.y;
                const angle = Math.atan2(worldMouseY - player.y, worldMouseX - player.x);

                // ケンタウロス（ボール非所持時）は左クリック長押しで3秒間斧チャージ
                const holdingBall = gameState.soccer.active && gameState.soccer.ball.holderId === player.id;
                if (player.role === "centaur" && !holdingBall) {
                    if (player.ammo >= 1.0 && player.attackCooldown <= 0 && player.dashTimer <= 0) {
                        input.mouseCharge.active = true;
                        input.mouseCharge.angle = angle;
                        player.axeChargeTimer = 0;
                    }
                    return;
                }

                fireBrawlerAttack(player, angle);
            } else if (e.button === 2) {
                const worldMouseX = e.clientX - viewWidth / 2 + gameState.camera.x;
                const worldMouseY = e.clientY - viewHeight / 2 + gameState.camera.y;
                const dx = worldMouseX - player.x;
                const dy = worldMouseY - player.y;
                const angle = Math.atan2(dy, dx);
                const dist = Math.min(600, Math.hypot(dx, dy));
                triggerBrawlerUlt(player, angle, dist);
            }
        });

        window.addEventListener("mouseup", () => {
            const player = getPlayer();
            if (input.mouseCharge.active) {
                input.mouseCharge.active = false;
                if (player && !player.dead) {
                    const worldMouseX = input.mouse.x - viewWidth / 2 + gameState.camera.x;
                    const worldMouseY = input.mouse.y - viewHeight / 2 + gameState.camera.y;
                    const angle = Math.atan2(worldMouseY - player.y, worldMouseX - player.x);
                    fireBrawlerAttack(player, angle);
                    player.axeChargeTimer = 0;
                }
            }
            if (input.attackStick.active) {
                if (player && !player.dead && !input.attackStick.isCanceled) {
                    if (input.attackStick.maxMovedDist < 16) {
                        const target = getAutoAimData(player);
                        fireBrawlerAttack(player, target.angle, target.dist);
                    } else {
                        const angle = Math.atan2(input.attackStick.dy, input.attackStick.dx);
                        fireBrawlerAttack(player, angle);
                    }
                }
                if (player) player.axeChargeTimer = 0;
                resetStick(input.attackStick);
            }
            if (input.ultStick.active) {
                if (player && !player.dead && !input.ultStick.isCanceled && player.ultCharge >= 100) {
                    let angle = player.facingAngle;
                    let aimDist = 300;
                    if (input.ultStick.maxMovedDist >= 16) {
                        angle = Math.atan2(input.ultStick.dy, input.ultStick.dx);
                        aimDist = Math.min(600, (input.ultStick.dragDist / input.ultStick.radius) * 600);
                    } else {
                        const target = getAutoAimData(player);
                        angle = target.angle;
                        aimDist = target.dist;
                    }
                    triggerBrawlerUlt(player, angle, aimDist);
                }
                resetStick(input.ultStick);
            }
        });

        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        canvas.addEventListener("touchstart", (e) => {
            if (gameState.status !== "playing") return;
            e.preventDefault();
            input.mouse.active = false;
            const player = getPlayer();

            for (const touch of e.changedTouches) {
                const tx = touch.clientX;
                const ty = touch.clientY;

                const distToUlt = Math.hypot(tx - input.ultStick.baseX, ty - input.ultStick.baseY);
                if (!input.ultStick.active && player && player.ultCharge >= 100 && distToUlt <= input.ultStick.radius + 18) {
                    input.ultStick.active = true;
                    input.ultStick.touchId = touch.identifier;
                    input.ultStick.startX = tx;
                    input.ultStick.startY = ty;
                    input.ultStick.maxDragDist = 0;
                    input.ultStick.maxMovedDist = 0;
                    input.ultStick.isCanceled = false;
                    updateAimStickDrag(input.ultStick, tx, ty);
                } else if (tx >= viewWidth * 0.5 && !input.attackStick.active) {
                    input.attackStick.active = true;
                    input.attackStick.touchId = touch.identifier;
                    input.attackStick.startX = tx;
                    input.attackStick.startY = ty;
                    input.attackStick.maxDragDist = 0;
                    input.attackStick.maxMovedDist = 0;
                    input.attackStick.isCanceled = false;
                    updateAimStickDrag(input.attackStick, tx, ty);
                } else if (tx < viewWidth * 0.5 && !input.moveStick.active) {
                    input.moveStick.active = true;
                    input.moveStick.touchId = touch.identifier;
                    input.moveStick.baseX = tx;
                    input.moveStick.baseY = ty;
                    input.moveStick.currX = tx;
                    input.moveStick.currY = ty;
                }
            }
        }, { passive: false });

        canvas.addEventListener("touchmove", (e) => {
            if (gameState.status !== "playing") return;
            e.preventDefault();

            for (const touch of e.changedTouches) {
                if (input.moveStick.active && touch.identifier === input.moveStick.touchId) {
                    const dx = touch.clientX - input.moveStick.baseX;
                    const dy = touch.clientY - input.moveStick.baseY;
                    const dist = Math.hypot(dx, dy);
                    const clamped = Math.min(input.moveStick.radius, dist);
                    const angle = Math.atan2(dy, dx);
                    input.moveStick.currX = input.moveStick.baseX + Math.cos(angle) * clamped;
                    input.moveStick.currY = input.moveStick.baseY + Math.sin(angle) * clamped;
                    input.moveStick.dx = dist > 6 ? dx / dist : 0;
                    input.moveStick.dy = dist > 6 ? dy / dist : 0;
                } else if (input.attackStick.active && touch.identifier === input.attackStick.touchId) {
                    updateAimStickDrag(input.attackStick, touch.clientX, touch.clientY);
                } else if (input.ultStick.active && touch.identifier === input.ultStick.touchId) {
                    updateAimStickDrag(input.ultStick, touch.clientX, touch.clientY);
                }
            }
        }, { passive: false });

        function handleTouchEnd(e) {
            const player = getPlayer();
            for (const touch of e.changedTouches) {
                if (input.moveStick.active && touch.identifier === input.moveStick.touchId) {
                    resetStick(input.moveStick);
                    updateDefaultStickPositions();
                } else if (input.attackStick.active && touch.identifier === input.attackStick.touchId) {
                    if (player && !player.dead && !input.attackStick.isCanceled) {
                        if (input.attackStick.maxMovedDist < 16) {
                            const target = getAutoAimData(player);
                            fireBrawlerAttack(player, target.angle, target.dist);
                        } else {
                            const angle = Math.atan2(input.attackStick.dy, input.attackStick.dx);
                            fireBrawlerAttack(player, angle);
                        }
                    }
                    if (player) player.axeChargeTimer = 0;
                    resetStick(input.attackStick);
                } else if (input.ultStick.active && touch.identifier === input.ultStick.touchId) {
                    if (player && !player.dead && !input.ultStick.isCanceled && player.ultCharge >= 100) {
                        let angle = player.facingAngle;
                        let aimDist = 300;
                        if (input.ultStick.maxMovedDist >= 16) {
                            angle = Math.atan2(input.ultStick.dy, input.ultStick.dx);
                            aimDist = Math.min(600, (input.ultStick.dragDist / input.ultStick.radius) * 600);
                        } else {
                            const target = getAutoAimData(player);
                            angle = target.angle;
                            aimDist = target.dist;
                        }
                        triggerBrawlerUlt(player, angle, aimDist);
                    }
                    resetStick(input.ultStick);
                }
            }
        }

        canvas.addEventListener("touchend", handleTouchEnd);
        canvas.addEventListener("touchcancel", handleTouchEnd);

        // ----------------------------------------------------------------------------
        // 5. キャラクター生成・戦闘ロジック（ブレイズ・ヴァイパー・タイタン ＆ AIブロウラー）
        // ----------------------------------------------------------------------------
        function createBrawler(id, name, team, role, isPlayer, x, y) {
            // 全体の移動速度を少しだけ引き上げ、ブレイズ(リロードやや速め)・ヴァイパー(リロードやや遅め)・タイタン(HP13200/若干遅め/リロード普通)を設定
            const configs = {
                blaze: {
                    category: "attack_dealer",
                    maxHp: 7600,
                    speed: 120,
                    radius: 22,
                    reloadTime: 1.15,
                    range: 430,
                    damage: 320
                },
                viper: {
                    category: "sniper",
                    maxHp: 8200,
                    speed: 115,
                    radius: 21,
                    reloadTime: 1.85,
                    range: 660,
                    damage: 1320
                },
                titan: {
                    category: "heavy",
                    maxHp: 13200,
                    speed: 104,
                    radius: 25,
                    reloadTime: 1.45,
                    range: 350,
                    damage: 220
                },
                saital: {
                    category: "supporter",
                    maxHp: 8200,
                    speed: 118,
                    radius: 21,
                    reloadTime: 1.45,
                    range: 470,
                    damage: 520
                },
                eric: {
                    category: "killer",
                    maxHp: 7400,
                    speed: 142,
                    radius: 21,
                    reloadTime: 0.95,
                    range: 120,
                    damage: 840
                },
                frost: {
                    category: "controller",
                    maxHp: 7100,
                    speed: 115,
                    radius: 21,
                    reloadTime: 1.45,
                    range: 360,
                    damage: 430
                },
                pom: {
                    category: "thrower",
                    maxHp: 6000,
                    speed: 115,
                    radius: 20,
                    reloadTime: 1.65,
                    range: 500,
                    damage: 850
                },
                centaur: {
                    category: "speeder",
                    maxHp: 7800,
                    speed: 80, // 初期速度 3.5相当（徐々に12.5相当まで加速）
                    radius: 24,
                    reloadTime: 3.2, // 極遅
                    maxAmmo: 2.0, // リロードは2つのみ
                    range: 145,
                    damage: 250
                },
                rearn: {
                    category: "attack_dealer",
                    maxHp: 6200,
                    speed: 138, // 移動速度は早め
                    radius: 21,
                    reloadTime: 1.65, // リロードは少し遅め
                    range: 460,
                    damage: 420
                },
                forever: {
                    category: "sniper",
                    maxHp: 7400,
                    speed: 115, // 足の早さは普通（探知時2倍）
                    radius: 21,
                    reloadTime: 2.35, // リロードはとても遅い
                    maxAmmo: 1.0, // リロードは1つのみ（ウルト中5秒間は4つ）
                    range: 640,
                    damage: 400
                },
                lil: {
                    category: "pet",
                    maxHp: 4200,
                    speed: 130,
                    radius: 16,
                    reloadTime: 1,
                    range: 120,
                    damage: 620
                },
                knight: {
                    category: "heavy",
                    maxHp: 7800,
                    speed: 110,
                    radius: 24,
                    reloadTime: 1.45,
                    range: 210,
                    damage: 780
                },
                witch: {
                    category: "controller",
                    maxHp: 6400,
                    speed: 112,
                    radius: 21,
                    reloadTime: 1.5,
                    range: 500,
                    damage: 980
                }
            };
            const cfg = configs[role] || configs.blaze;

            return {
                id,
                name,
                team,
                role,
                category: cfg.category,
                isPlayer,
                ownerId: null, // リルなどのペット用
                x,
                y,
                spawnX: x,
                spawnY: y,
                vx: 0,
                vy: 0,
                radius: cfg.radius,
                hp: cfg.maxHp,
                maxHp: cfg.maxHp,
                speed: cfg.speed,
                ammo: cfg.maxAmmo || 3.0,
                maxAmmo: cfg.maxAmmo || 3.0,
                reloadTime: cfg.reloadTime,
                attackCooldown: 0,
                burstQueue: [],
                range: cfg.range,
                damage: cfg.damage,
                ultCharge: 0,
                maxUltCharge: role === "pom" ? 300 : 100,
                dashTimer: 0,
                dashAngle: 0,
                dashSpeed: 680,
                dashHitIds: new Set(),
                dashType: "blaze_ult",
                centaurSpeedScale: 3.5, // ケンタウロス現在速度(3.5〜12.5)
                ramHitCooldowns: {}, // ケンタウロス体当たりクールダウン
                axeChargeTimer: 0, // ケンタウロス斧チャージ時間(0〜3.0秒)
                axeSwingAnim: 0, // 斧振りアニメタイマー
                axeSwingAngle: 0,
                facingAngle: team === "blue" ? 0 : Math.PI,
                capePhase: Math.random() * Math.PI * 2,
                walkAnim: 0,
                hurtFlash: 0,
                inBush: false,
                revealedTimer: 0,
                outOfCombatTimer: 0,
                gems: 0,
                dead: false,
                respawnTimer: 0,
                aiTimer: Math.random() * 0.5,
                aiMoveDir: { x: 0, y: 0 },
                aiStuckTimer: 0,
                aiLastX: x,
                aiLastY: y,
                aiUnstuckDir: { x: 0, y: 0 },
                slowTimer: 0, // スローダウン用
                slipTimer: 0, // ツルツル滑る用
                slipVx: 0,
                slipVy: 0,
                lilTickTimer: 0, // リル攻撃タイマー
                rearnZoneRadius: 210, // レアーン周囲の円半径
                rearnUltTimer: 0, // レアーンウルト発動中の3秒カウント
                isPuppet: false, // レアーンのウルトで黒く染められ操られている状態
                puppetTimer: 0, // 人形化の残り時間（5秒で解除）
                puppetMasterId: null, // 人形化させたレアーンのID
                originalTeam: team,
                puppetSpin: 0,
                puppetAttackCd: 0,
                foreverChargedShot: false, // 400弾を当てた後、次弾が1500になるフラグ
                foreverHuntActive: false, // 目の先の範囲にHP1/3以下の敵がいるか
                foreverUltTimer: 0, // ウルト発動中の5秒カウント（リロード4＆広角600連撃）
                foreverSwingAnim: 0,
                foreverSwingAngle: 0,
                stats: { kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0, healAmount: 0 }
            };
        }

        /**
         * サッカーボールを蹴る（通常シュート or ウルトスーパーシュート）
         */
        function kickSoccerBall(kicker, angle, isSuperShot) {
            const ball = gameState.soccer.ball;
            if (!gameState.soccer.active || ball.holderId !== kicker.id) return false;

            ball.holderId = null;
            ball.lastKickerId = kicker.id;
            ball.lastKickerTeam = kicker.team;
            ball.pickupCooldown = 0.35;
            ball.superShot = isSuperShot;

            const speed = isSuperShot ? 950 : 550;
            ball.x = kicker.x + Math.cos(angle) * (kicker.radius + ball.radius + 6);
            ball.y = kicker.y + Math.sin(angle) * (kicker.radius + ball.radius + 6);
            ball.vx = Math.cos(angle) * speed;
            ball.vy = Math.sin(angle) * speed;

            kicker.facingAngle = angle;
            kicker.revealedTimer = 1.5;

            if (isSuperShot) {
                kicker.ultCharge = 0;
                if (kicker.isPlayer) {
                    sound.playPiercingUlt();
                    gameState.camera.shake = 8;
                    showToast("スーパーシュート！超高速・長距離キック！");
                }
                spawnParticles(ball.x, ball.y, "#facc15", 18, 240);
                spawnParticles(ball.x, ball.y, "#34d399", 14, 180);
            } else {
                if (kicker.isPlayer) sound.playShoot();
                spawnParticles(ball.x, ball.y, "#ffffff", 8, 120);
            }
            return true;
        }

        /**
         * プレイヤー＆キャラクター共通 通常攻撃ディスパッチャー
         */
        function fireBrawlerAttack(shooter, angle, overrideAimDist = null) {
            if (gameState.soccer.active && gameState.soccer.goalResetTimer > 0) return;
            if (gameState.knockout.active && gameState.knockout.roundResetTimer > 0) return;
            if (shooter.dead || shooter.isPuppet || shooter.rearnUltTimer > 0 || shooter.ammo < 1.0 || shooter.attackCooldown > 0 || shooter.dashTimer > 0) return;

            // サッカーモードでボール所持中なら通常シュートを放つ
            if (gameState.soccer.active && gameState.soccer.ball.holderId === shooter.id) {
                kickSoccerBall(shooter, angle, false);
                shooter.attackCooldown = 0.25;
                return;
            }

            if (shooter.role === "blaze") {
                // ブレイズ（アタックディーラー）：横に並んだ3つの玉を発射！（ウルトチャージを14%→9%に調整）
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.22;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) sound.playShoot();

                const speed = 640;
                const life = shooter.range / speed;
                const perpX = -Math.sin(angle);
                const perpY = Math.cos(angle);
                const forwardX = Math.cos(angle);
                const forwardY = Math.sin(angle);

                const lateralOffsets = [-24, 0, 24];
                lateralOffsets.forEach((offset, idx) => {
                    const forwardOffset = idx === 1 ? 26 : 20;
                    const startX = shooter.x + forwardX * forwardOffset + perpX * offset;
                    const startY = shooter.y + forwardY * forwardOffset + perpY * offset;

                    gameState.projectiles.push({
                        ownerId: shooter.id,
                        team: shooter.team,
                        type: "blaze_orb",
                        x: startX,
                        y: startY,
                        vx: forwardX * speed,
                        vy: forwardY * speed,
                        radius: 9,
                        damage: shooter.damage,
                        healAmount: 0,
                        life: life,
                        maxLife: life,
                        ultGain: 9,
                        piercing: false,
                        hitEntityIds: new Set()
                    });
                });
            } else if (shooter.role === "viper") {
                // ヴァイパー（スナイパー）：超長射程＆高火力の単発スナイプ（4発命中でウルトMAX）
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.28;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) sound.playSniperShoot();

                const speed = 940;
                const life = shooter.range / speed;
                const forwardX = Math.cos(angle);
                const forwardY = Math.sin(angle);
                const startX = shooter.x + forwardX * 26;
                const startY = shooter.y + forwardY * 26;

                gameState.projectiles.push({
                    ownerId: shooter.id,
                    team: shooter.team,
                    type: "viper_snipe",
                    x: startX,
                    y: startY,
                    vx: forwardX * speed,
                    vy: forwardY * speed,
                    radius: 7,
                    damage: shooter.damage,
                    healAmount: 0,
                    life: life,
                    maxLife: life,
                    ultGain: 25,
                    piercing: false,
                    hitEntityIds: new Set()
                });
                spawnParticles(startX, startY, "#f472b6", 6, 120);
            } else if (shooter.role === "titan") {
                // タイタン（ヘビー）：横に並んだ5つのエネルギー弾を同時発射
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.3;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) sound.playShoot();

                const speed = 560;
                const life = shooter.range / speed;
                const perpX = -Math.sin(angle);
                const perpY = Math.cos(angle);
                const forwardX = Math.cos(angle);
                const forwardY = Math.sin(angle);

                const lateralOffsets = [-36, -18, 0, 18, 36];
                lateralOffsets.forEach((offset, idx) => {
                    const forwardOffset = idx === 2 ? 26 : (idx === 1 || idx === 3 ? 22 : 18);
                    const startX = shooter.x + forwardX * forwardOffset + perpX * offset;
                    const startY = shooter.y + forwardY * forwardOffset + perpY * offset;

                    gameState.projectiles.push({
                        ownerId: shooter.id,
                        team: shooter.team,
                        type: "titan_orb",
                        x: startX,
                        y: startY,
                        vx: forwardX * speed,
                        vy: forwardY * speed,
                        radius: 8,
                        damage: shooter.damage,
                        healAmount: 0,
                        life: life,
                        maxLife: life,
                        ultGain: 4,
                        piercing: false,
                        hitEntityIds: new Set()
                    });
                });
            } else if (shooter.role === "saital") {
                // サイタル（サポーター）：時間差で3発の貫通弾を発射（敵ダメ＆味方回復）
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.32;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                // 1発目（左側）を即時発射し、2発目（右側）・3発目（中央高速）を時間差キューへ登録
                spawnSaitalShot(shooter, {
                    angle: angle,
                    lateral: -22,
                    speed: 520,
                    damage: 170,
                    heal: 100,
                    ultGain: 12,
                    isCenter: false
                });
                shooter.burstQueue.push(
                    {
                        delay: 0.08,
                        angle: angle,
                        lateral: 22,
                        speed: 520,
                        damage: 170,
                        heal: 100,
                        ultGain: 12,
                        isCenter: false
                    },
                    {
                        delay: 0.16,
                        angle: angle,
                        lateral: 0,
                        speed: 860,
                        damage: 520,
                        heal: 300,
                        ultGain: 26,
                        isCenter: true
                    }
                );
            } else if (shooter.role === "eric") {
                // エリック（キラー）：自身が前方へ素早く移動して斬り抜けるショートダッシュ攻撃
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.25;
                shooter.facingAngle = angle;
                shooter.dashAngle = angle;
                shooter.dashSpeed = 800;
                shooter.dashTimer = shooter.range / shooter.dashSpeed;
                shooter.dashHitIds.clear();
                shooter.dashType = "eric_attack";
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) sound.playDash();
                spawnParticles(shooter.x, shooter.y, "#94a3b8", 10, 140);
            } else if (shooter.role === "frost") {
                // フロスト（コントローラー）：扇形の冷気を放ち、2秒間滞留させる（自身に追従・壁貫通なし）
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.35;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) sound.playShoot();

                gameState.zones.push({
                    ownerId: shooter.id,
                    team: shooter.team,
                    type: "frost_attack",
                    x: shooter.x,
                    y: shooter.y,
                    angle: angle,
                    radius: shooter.range,
                    spread: Math.PI / 4, // 約45度の扇形（範囲を縮小）
                    damagePerSec: shooter.damage,
                    life: 2.0,
                    maxLife: 2.0,
                    tickTimer: 0
                });
            } else if (shooter.role === "pom") {
                // ポム＆リル（スロワー）：壁を越えて飛ぶ魔法のフラスコ
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.35;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) sound.playShoot();

                let aimDist = shooter.range;
                if (overrideAimDist !== null) {
                    aimDist = Math.min(shooter.range, overrideAimDist);
                } else if (shooter.isPlayer && input.attackStick.active) {
                    aimDist = Math.min(shooter.range, (input.attackStick.dragDist / input.attackStick.radius) * shooter.range);
                } else if (shooter.isPlayer && input.mouse.active) {
                    const wx = input.mouse.x - viewWidth / 2 + gameState.camera.x;
                    const wy = input.mouse.y - viewHeight / 2 + gameState.camera.y;
                    aimDist = Math.min(shooter.range, Math.hypot(wx - shooter.x, wy - shooter.y));
                }

                const targetX = shooter.x + Math.cos(angle) * aimDist;
                const targetY = shooter.y + Math.sin(angle) * aimDist;

                gameState.projectiles.push({
                    ownerId: shooter.id,
                    team: shooter.team,
                    type: "pom_flask",
                    startX: shooter.x,
                    startY: shooter.y,
                    targetX: targetX,
                    targetY: targetY,
                    x: shooter.x,
                    y: shooter.y,
                    vx: 0,
                    vy: 0,
                    radius: 65, // 爆発半径を拡大
                    damage: shooter.damage,
                    healAmount: 0,
                    life: 0.8,
                    maxLife: 0.8,
                    ultGain: 8.4, // 12発命中で100%
                    piercing: false,
                    wallPiercing: true // 壁を越える
                });
            } else if (shooter.role === "centaur") {
                // ケンタウロス（スピーダー）：5秒チャージで250→700ダメージになる斧フルスイング（弾数2・極遅リロード）
                const chargeRatio = Math.min(1, (shooter.axeChargeTimer || 0) / 5.0);
                const finalDamage = Math.round(250 + 450 * chargeRatio);

                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.35;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;
                shooter.axeChargeTimer = 0;
                shooter.axeSwingAnim = 0.28;
                shooter.axeSwingAngle = angle;

                if (shooter.isPlayer) {
                    if (chargeRatio >= 0.95) {
                        sound.playPiercingUlt();
                        gameState.camera.shake = 6;
                    } else {
                        sound.playDash();
                    }
                }

                const axeRange = shooter.range;
                const spreadDeg = 35 + 135 * chargeRatio; // 最初は目の前(35度)のみ → フルチャージで170度の超広角へ拡大
                const halfSpread = (Math.PI * spreadDeg) / 360;
                const ultGain = chargeRatio >= 0.95 ? 16 : 10;

                // 斬撃パーティクル
                for (let k = -4; k <= 4; k++) {
                    const a = angle + (k / 4) * halfSpread;
                    const px = shooter.x + Math.cos(a) * (axeRange * 0.72);
                    const py = shooter.y + Math.sin(a) * (axeRange * 0.72);
                    spawnParticles(px, py, chargeRatio >= 0.95 ? "#facc15" : "#38bdf8", 3, 120);
                }

                for (const target of gameState.entities) {
                    if (target.dead || target.team === shooter.team) continue;
                    const dist = Math.hypot(target.x - shooter.x, target.y - shooter.y);
                    if (dist <= axeRange + target.radius) {
                        const angleTo = Math.atan2(target.y - shooter.y, target.x - shooter.x);
                        let diff = Math.abs(angleTo - angle);
                        if (diff > Math.PI) diff = Math.PI * 2 - diff;
                        if (diff <= halfSpread + 0.12) {
                            applyDamage(shooter, target, finalDamage);
                            const prevUlt = shooter.ultCharge;
                            shooter.ultCharge = Math.min(shooter.maxUltCharge, shooter.ultCharge + ultGain);
                            if (shooter.isPlayer && prevUlt < 100 && shooter.ultCharge >= 100) {
                                sound.playUltReady();
                                showToast("ウルトチャージ完了！15m疾風突撃 発動可能！");
                            }
                        }
                    }
                }
            } else if (shooter.role === "rearn") {
                // レアーン（アタックディーラー）：右側と左側に弧を描くように壁貫通＆敵ホーミング弾を2発発射（1発420ダメージ）
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.28;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) sound.playShoot();

                const speed = 500;
                const life = shooter.range / speed + 0.22;
                const sides = [-1, 1]; // 左側と右側に弧を描く

                sides.forEach((side) => {
                    const launchAngle = angle + side * 0.68;
                    const startX = shooter.x + Math.cos(launchAngle) * 22;
                    const startY = shooter.y + Math.sin(launchAngle) * 22;

                    gameState.projectiles.push({
                        ownerId: shooter.id,
                        team: shooter.team,
                        type: "rearn_homing",
                        x: startX,
                        y: startY,
                        vx: Math.cos(launchAngle) * speed,
                        vy: Math.sin(launchAngle) * speed,
                        speed: speed,
                        baseAngle: angle,
                        curveSide: side,
                        radius: 9,
                        damage: shooter.damage,
                        healAmount: 0,
                        life: life,
                        maxLife: life,
                        ultGain: 6,
                        piercing: false,
                        wallPiercing: true, // 壁を貫通する
                        hitEntityIds: new Set()
                    });
                });
                spawnParticles(shooter.x, shooter.y, "#f43f5e", 10, 130);
            } else if (shooter.role === "forever") {
                // フォーエバー（スナイパー・蜂キャラ）
                shooter.ammo -= 1.0;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                if (shooter.foreverUltTimer > 0) {
                    // ウルト発動中（5秒間）：ケンタウロスの最大チャージと同じくらいの超広角（170度）600ダメージ攻撃を繰り返し出す
                    shooter.attackCooldown = 0.22;
                    shooter.foreverSwingAnim = 0.24;
                    shooter.foreverSwingAngle = angle;

                    if (shooter.isPlayer) {
                        sound.playDash();
                        gameState.camera.shake = Math.max(gameState.camera.shake, 4);
                    }

                    const swarmRange = 165;
                    const halfSpread = (Math.PI * 170) / 360;

                    for (let k = -5; k <= 5; k++) {
                        const a = angle + (k / 5) * halfSpread;
                        const px = shooter.x + Math.cos(a) * (swarmRange * 0.72);
                        const py = shooter.y + Math.sin(a) * (swarmRange * 0.72);
                        spawnParticles(px, py, k % 2 === 0 ? "#facc15" : "#fef08a", 2, 130);
                    }

                    for (const target of gameState.entities) {
                        if (target.dead || target.team === shooter.team) continue;
                        const dist = Math.hypot(target.x - shooter.x, target.y - shooter.y);
                        if (dist <= swarmRange + target.radius) {
                            const angleTo = Math.atan2(target.y - shooter.y, target.x - shooter.x);
                            let diff = Math.abs(angleTo - angle);
                            if (diff > Math.PI) diff = Math.PI * 2 - diff;
                            if (diff <= halfSpread + 0.12) {
                                applyDamage(shooter, target, 600);
                                spawnParticles(target.x, target.y, "#facc15", 8, 150);
                            }
                        }
                    }
                } else {
                    // 通常攻撃：基本400ダメ(ウルト3%)、1発当てた後の次弾は1500ダメ(ウルト8%)
                    // 目の先の範囲にHP1/3以下の敵がいる場合のみ壁を貫通できる
                    shooter.attackCooldown = 0.28;
                    const isSuperSting = shooter.foreverChargedShot;
                    shooter.foreverChargedShot = false;

                    if (shooter.isPlayer) {
                        if (isSuperSting) sound.playPiercingUlt();
                        else sound.playSniperShoot();
                    }

                    const speed = isSuperSting ? 1020 : 920;
                    const life = shooter.range / speed;
                    const forwardX = Math.cos(angle);
                    const forwardY = Math.sin(angle);
                    const startX = shooter.x + forwardX * 26;
                    const startY = shooter.y + forwardY * 26;

                    gameState.projectiles.push({
                        ownerId: shooter.id,
                        team: shooter.team,
                        type: isSuperSting ? "forever_super_sting" : "forever_sting",
                        x: startX,
                        y: startY,
                        vx: forwardX * speed,
                        vy: forwardY * speed,
                        radius: isSuperSting ? 12 : 7,
                        damage: isSuperSting ? 1500 : 400,
                        healAmount: 0,
                        life: life,
                        maxLife: life,
                        ultGain: isSuperSting ? 16 : 6,
                        piercing: false,
                        wallPiercing: shooter.foreverHuntActive,
                        hitEntityIds: new Set()
                    });
                    spawnParticles(startX, startY, isSuperSting ? "#facc15" : "#fde047", isSuperSting ? 12 : 6, 140);
                }
            } else if (shooter.role === "knight" || shooter.role === "witch") {
                // AI専用キャラの通常攻撃処理
                shooter.ammo -= 1.0;
                shooter.attackCooldown = 0.4;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.5;
                shooter.outOfCombatTimer = 0;

                const speed = shooter.role === "knight" ? 500 : 400;
                const life = shooter.range / speed;
                const pType = shooter.role === "knight" ? "knight_slash" : "witch_bolt";
                const pColor = shooter.role === "knight" ? "#38bdf8" : "#a855f7";

                gameState.projectiles.push({
                    ownerId: shooter.id,
                    team: shooter.team,
                    type: pType,
                    x: shooter.x + Math.cos(angle) * 20,
                    y: shooter.y + Math.sin(angle) * 20,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    radius: shooter.role === "knight" ? 14 : 10,
                    damage: shooter.damage,
                    healAmount: 0,
                    life: life,
                    maxLife: life,
                    ultGain: 0,
                    piercing: false,
                    hitEntityIds: new Set()
                });
                spawnParticles(shooter.x, shooter.y, pColor, 5, 100);
            }
        }

        /**
         * サイタルの時間差3連発を生成するヘルパー関数
         */
        function spawnSaitalShot(shooter, shot) {
            if (shooter.dead) return;
            const startX = shooter.x + Math.cos(shot.angle) * 20 - Math.sin(shot.angle) * shot.lateral;
            const startY = shooter.y + Math.sin(shot.angle) * 20 + Math.cos(shot.angle) * shot.lateral;
            
            if (shooter.isPlayer) sound.playShoot();
            
            gameState.projectiles.push({
                ownerId: shooter.id,
                team: shooter.team,
                type: shot.isCenter ? "saital_center" : "saital_outer",
                x: startX,
                y: startY,
                vx: Math.cos(shot.angle) * shot.speed,
                vy: Math.sin(shot.angle) * shot.speed,
                radius: shot.isCenter ? 12 : 9,
                damage: shot.damage,
                healAmount: shot.heal,
                life: shooter.range / shot.speed,
                maxLife: shooter.range / shot.speed,
                ultGain: shot.ultGain,
                piercing: true,
                hitEntityIds: new Set()
            });
            spawnParticles(startX, startY, shot.isCenter ? "#34d399" : "#a7f3d0", 6, 90);
        }

        /**
         * ウルト発動ディスパッチャー
         */
        function triggerBrawlerUlt(shooter, angle, aimDist = 300) {
            if (gameState.soccer.active && gameState.soccer.goalResetTimer > 0) return;
            if (gameState.knockout.active && gameState.knockout.roundResetTimer > 0) return;
            if (shooter.dead || shooter.isPuppet || shooter.rearnUltTimer > 0 || shooter.ultCharge < 100 || shooter.dashTimer > 0) return;

            // サッカーモードでボール所持中ならウルトで超高速・長距離シュート！
            if (gameState.soccer.active && gameState.soccer.ball.holderId === shooter.id) {
                kickSoccerBall(shooter, angle, true);
                return;
            }

            if (shooter.role === "blaze") {
                shooter.ultCharge = 0;
                shooter.facingAngle = angle;
                shooter.dashAngle = angle;
                shooter.dashTimer = 0.25;
                shooter.dashHitIds.clear();
                shooter.revealedTimer = 1.8;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playDash();
                    gameState.camera.shake = 7;
                    showToast("ウルト発動！ブレイズダッシュ！");
                }

                spawnParticles(shooter.x, shooter.y, "#facc15", 16, 220);
                spawnParticles(shooter.x, shooter.y, "#ef4444", 14, 180);
            } else if (shooter.role === "viper") {
                shooter.ultCharge = 0;
                shooter.facingAngle = angle;
                shooter.revealedTimer = 1.8;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playPiercingUlt();
                    gameState.camera.shake = 9;
                    showToast("ウルト発動！ハートブレイク・キャノン！");
                }

                const speed = 1080;
                const range = 820;
                const life = range / speed;
                const forwardX = Math.cos(angle);
                const forwardY = Math.sin(angle);
                const startX = shooter.x + forwardX * 28;
                const startY = shooter.y + forwardY * 28;

                gameState.projectiles.push({
                    ownerId: shooter.id,
                    team: shooter.team,
                    type: "viper_pierce_ult",
                    x: startX,
                    y: startY,
                    vx: forwardX * speed,
                    vy: forwardY * speed,
                    radius: 15,
                    damage: 2320,
                    life: life,
                    maxLife: life,
                    ultGain: 0,
                    piercing: true,
                    wallPiercing: false,
                    hitEntityIds: new Set()
                });

                spawnParticles(startX, startY, "#f472b6", 18, 240);
                spawnParticles(startX, startY, "#facc15", 14, 200);
            } else if (shooter.role === "titan") {
                // タイタンのウルト（タイタン・ノヴァ）：周りの敵を吹き飛ばし＆2800回復！
                shooter.ultCharge = 0;
                shooter.revealedTimer = 1.8;
                shooter.outOfCombatTimer = 0;

                // 自身を2800回復
                const healAmount = 2800;
                const actualHeal = Math.min(healAmount, shooter.maxHp - shooter.hp);
                shooter.hp += actualHeal;
                shooter.stats.healAmount += actualHeal;
                spawnFloatingText(shooter.x, shooter.y - 38, `+${actualHeal}`, "#4ade80");

                if (shooter.isPlayer) {
                    sound.playPiercingUlt();
                    gameState.camera.shake = 10;
                    showToast("ウルト発動！タイタン・ノヴァ（2800回復＆周囲吹き飛ばし）！");
                }

                const novaRadius = 200;
                gameState.shockwaves.push({
                    x: shooter.x,
                    y: shooter.y,
                    maxRadius: novaRadius,
                    color: "#c084fc",
                    life: 0.36,
                    maxLife: 0.36
                });

                spawnParticles(shooter.x, shooter.y, "#c084fc", 22, 260);
                spawnParticles(shooter.x, shooter.y, "#4ade80", 16, 180);

                // 周囲の敵を吹き飛ばし＆衝撃波ダメージ
                for (const target of gameState.entities) {
                    if (target.dead || target.team === shooter.team) continue;
                    const dx = target.x - shooter.x;
                    const dy = target.y - shooter.y;
                    const dist = Math.hypot(dx, dy);
                    if (dist <= novaRadius + target.radius) {
                        applyDamage(shooter, target, 650);
                        const pushAngle = dist > 1 ? Math.atan2(dy, dx) : angle;
                        const knockbackDist = 125;
                        target.x += Math.cos(pushAngle) * knockbackDist;
                        target.y += Math.sin(pushAngle) * knockbackDist;
                        resolveMapCollision(target);
                        spawnParticles(target.x, target.y, "#e9d5ff", 10, 160);
                    }
                }
            } else if (shooter.role === "saital") {
                // サイタルのウルト（サンクチュアリ・ヒール）：範囲内の味方を2800回復！
                shooter.ultCharge = 0;
                shooter.revealedTimer = 1.8;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playUltReady();
                    gameState.camera.shake = 5;
                    showToast("ウルト発動！サンクチュアリ・ヒール（範囲内の味方を2800回復）！");
                }

                const healRadius = 230;
                const healAmount = 2800;

                gameState.shockwaves.push({
                    x: shooter.x,
                    y: shooter.y,
                    maxRadius: healRadius,
                    color: "#34d399",
                    life: 0.42,
                    maxLife: 0.42
                });

                spawnParticles(shooter.x, shooter.y, "#34d399", 24, 240);
                spawnParticles(shooter.x, shooter.y, "#fef08a", 14, 180);

                for (const ally of gameState.entities) {
                    if (ally.dead || ally.team !== shooter.team) continue;
                    const dist = Math.hypot(ally.x - shooter.x, ally.y - shooter.y);
                    if (dist <= healRadius + ally.radius) {
                        const actualHeal = Math.min(healAmount, ally.maxHp - ally.hp);
                        ally.hp += actualHeal;
                        shooter.stats.healAmount += actualHeal;
                        spawnFloatingText(ally.x, ally.y - 36, `+${actualHeal}`, "#4ade80");
                        spawnParticles(ally.x, ally.y, "#6ee7b7", 12, 140);
                    }
                }
            } else if (shooter.role === "eric") {
                // エリックのウルト（紅蓮・影縫いの疾風斬）：ロングダッシュ＆敵1体ごと1000回復＆1340ダメージ
                shooter.ultCharge = 0;
                shooter.facingAngle = angle;
                shooter.dashAngle = angle;
                shooter.dashTimer = 0.32;
                shooter.dashSpeed = 1250;
                shooter.dashHitIds.clear();
                shooter.dashType = "eric_ult";
                shooter.revealedTimer = 1.8;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playDash();
                    gameState.camera.shake = 8;
                    showToast("ウルト発動！紅蓮・影縫いの疾風斬！");
                }

                spawnParticles(shooter.x, shooter.y, "#be123c", 18, 260);
                spawnParticles(shooter.x, shooter.y, "#1e293b", 12, 180);
            } else if (shooter.role === "frost") {
                // フロストのウルト（アブソリュート・ゼロ）：投擲で指定位置に氷結エリアを生成
                shooter.ultCharge = 0;
                shooter.revealedTimer = 1.8;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playPiercingUlt();
                    gameState.camera.shake = 8;
                    showToast("ウルト発動！アブソリュート・ゼロ！");
                }

                const targetX = shooter.x + Math.cos(angle) * aimDist;
                const targetY = shooter.y + Math.sin(angle) * aimDist;

                gameState.zones.push({
                    ownerId: shooter.id,
                    team: shooter.team,
                    type: "frost_ult",
                    x: targetX,
                    y: targetY,
                    radius: 165, // 3分の2に縮小
                    damagePerSec: 250,
                    life: 7.0,
                    maxLife: 7.0,
                    tickTimer: 0
                });
            } else if (shooter.role === "pom") {
                // ポムのウルト（カモン！リル）：リルを召喚する
                shooter.ultCharge -= 100; // 300%のうち100%を消費
                shooter.revealedTimer = 1.8;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playDash();
                    showToast("ウルト発動！カモン！リル！");
                }

                // 最大5匹までの制限。5匹いる場合は一番古いものを自爆させる
                const lils = gameState.entities.filter(e => e.ownerId === shooter.id && e.role === "lil" && !e.dead);
                if (lils.length >= 5) {
                    lils[0].hp = 0;
                }

                const spawnX = shooter.x + Math.cos(angle) * 50;
                const spawnY = shooter.y + Math.sin(angle) * 50;
                const lilId = Date.now() + Math.floor(Math.random() * 1000);
                const lil = createBrawler(lilId, "リル", shooter.team, "lil", false, spawnX, spawnY);
                lil.ownerId = shooter.id;
                gameState.entities.push(lil);
                
                spawnParticles(spawnX, spawnY, "#d946ef", 16, 160);
            } else if (shooter.role === "centaur") {
                // ケンタウロスのウルト（15m疾風突撃）：15m/秒の速度で前方へ15m突撃（1m=32px換算: 480px/s × 1.0s）
                shooter.ultCharge = 0;
                shooter.facingAngle = angle;
                shooter.dashAngle = angle;
                shooter.dashSpeed = 480; // 15m/s
                shooter.dashTimer = 1.0; // 15m (480px)
                shooter.dashHitIds.clear();
                shooter.dashType = "centaur_ult";
                shooter.centaurSpeedScale = 12.5; // 突撃後は最高速を維持
                shooter.revealedTimer = 2.0;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playPiercingUlt();
                    gameState.camera.shake = 9;
                    showToast("ウルト発動！15m疾風突撃！");
                }

                spawnParticles(shooter.x, shooter.y, "#38bdf8", 20, 240);
                spawnParticles(shooter.x, shooter.y, "#facc15", 14, 200);
            } else if (shooter.role === "rearn") {
                // レアーンのウルト（ブラッドムーン・パペット）：円の範囲内を真っ黒のブラッドムーンにし、自身を3秒間くるくる回らせる
                shooter.ultCharge = 0;
                shooter.rearnUltTimer = 3.0;
                shooter.revealedTimer = 3.2;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playPiercingUlt();
                    gameState.camera.shake = 10;
                    showToast("ウルト発動！ブラッドムーン展開…3秒後に円内の敵を人形化！");
                }

                gameState.shockwaves.push({
                    x: shooter.x,
                    y: shooter.y,
                    maxRadius: shooter.rearnZoneRadius,
                    color: "#dc2626",
                    life: 0.45,
                    maxLife: 0.45
                });
                spawnParticles(shooter.x, shooter.y, "#09080f", 20, 220);
                spawnParticles(shooter.x, shooter.y, "#dc2626", 18, 220);
            } else if (shooter.role === "forever") {
                // フォーエバーのウルト（ホーネット・ラッシュ）：前方へ毎秒15の速度(480px/s)でダッシュ＆5秒間リロード4＆広角600連撃
                shooter.ultCharge = 0;
                shooter.facingAngle = angle;
                shooter.dashAngle = angle;
                shooter.dashSpeed = 480; // 15m/s
                shooter.dashTimer = 0.45;
                shooter.dashHitIds.clear();
                shooter.dashType = "forever_ult";
                shooter.foreverUltTimer = 5.0;
                shooter.maxAmmo = 4.0;
                shooter.ammo = 4.0;
                shooter.revealedTimer = 2.0;
                shooter.outOfCombatTimer = 0;

                if (shooter.isPlayer) {
                    sound.playPiercingUlt();
                    gameState.camera.shake = 8;
                    showToast("ウルト発動！5秒間リロード4＆広角600ダメージ連撃！");
                }

                spawnParticles(shooter.x, shooter.y, "#facc15", 20, 240);
                spawnParticles(shooter.x, shooter.y, "#0f172a", 12, 180);
            }
        }

        function applyDamage(attacker, target, amount) {
            if (target.dead) return;
            target.hp = Math.max(0, target.hp - amount);
            target.hurtFlash = 0.14;
            target.revealedTimer = 1.5;
            target.outOfCombatTimer = 0;
            
            target.stats.damageTaken += amount;

            spawnParticles(target.x, target.y, "#ef4444", 7, 130);
            spawnFloatingText(target.x, target.y - 28, `-${amount}`, "#fca5a5");

            if (attacker) {
                attacker.stats.damageDealt += amount;
                if (attacker.isPlayer) {
                    gameState.stats.damage += amount;
                    sound.playHit();
                }
            }

            if (target.hp <= 0) {
                handleBrawlerDeath(attacker, target);
            }
        }

        function handleBrawlerDeath(killer, victim) {
            victim.dead = true;
            victim.stats.deaths += 1;

            // 人形化されていた場合は元のチームへ戻して解除
            if (victim.isPuppet) {
                victim.isPuppet = false;
                victim.team = victim.originalTeam;
                victim.puppetTimer = 0;
                victim.puppetMasterId = null;
                victim.puppetAttackCd = 0;
            }
            victim.rearnUltTimer = 0;

            if (victim.role === "lil") {
                spawnParticles(victim.x, victim.y, "#d946ef", 16, 160);
                const owner = gameState.entities.find(e => e.id === victim.ownerId);
                if (owner && !owner.dead) {
                    const prevUlt = owner.ultCharge;
                    owner.ultCharge = Math.min(owner.maxUltCharge, owner.ultCharge + 100);
                    if (owner.isPlayer && Math.floor(prevUlt/100) < Math.floor(owner.ultCharge/100)) {
                        sound.playUltReady();
                        showToast("リルが倒された！ウルト還元！");
                    }
                }
                if (killer && killer.isPlayer) {
                    gameState.stats.kills += 1; // ペットをキルした場合もキル数追加
                }
                return; // リルはジェムやボールを落とさない、リスポーンしない
            }

            victim.respawnTimer = 3.5;
            victim.respawnTimer = gameState.knockout.active ? 99999 : 3.5;
            victim.dashTimer = 0;

            spawnParticles(victim.x, victim.y, "#f87171", 22, 220);
            spawnParticles(victim.x, victim.y, "#fef08a", 12, 160);

            // 所持していたジェムをその場にすべてドロップ
            if (victim.gems > 0) {
                for (let i = 0; i < victim.gems; i++) {
                    spawnGem(victim.x, victim.y, true);
                }
                victim.gems = 0;
                recalculateTeamGems();
            }

            // サッカーモードでボールを持っていたらその場に落とす
            if (gameState.soccer.active && gameState.soccer.ball.holderId === victim.id) {
                gameState.soccer.ball.holderId = null;
                gameState.soccer.ball.vx = (Math.random() - 0.5) * 180;
                gameState.soccer.ball.vy = (Math.random() - 0.5) * 180;
                gameState.soccer.ball.pickupCooldown = 0.25;
            }

            if (killer) {
                killer.stats.kills += 1;
                if (killer.isPlayer) {
                    gameState.stats.kills += 1;
                    showToast(`${victim.name} を撃破！`);
                }
            }
            if (victim.isPlayer) {
                gameState.camera.shake = 10;
                if (gameState.knockout.active) {
                    const ov = document.getElementById("respawnOverlay");
                    if (ov) {
                        ov.classList.remove("hidden");
                        ov.innerHTML = `撃破された！次のラウンドまで観戦中...`;
                    }
                }
            }
        }

        function recalculateTeamGems() {
            let blue = 0;
            let red = 0;
            for (const ent of gameState.entities) {
                if (!ent.dead) {
                    if (ent.team === "blue") blue += ent.gems;
                    else red += ent.gems;
                }
            }
            gameState.blueGems = blue;
            gameState.redGems = red;
        }

        function checkLineOfSight(x1, y1, x2, y2) {
            const dist = Math.hypot(x2 - x1, y2 - y1);
            const steps = Math.ceil(dist / 14);
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const cx = x1 + (x2 - x1) * t;
                const cy = y1 + (y2 - y1) * t;
                const col = Math.floor(cx / TILE_SIZE);
                const row = Math.floor(cy / TILE_SIZE);
                if (row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS) {
                    const tile = gameState.map[row][col];
                    if (tile === 1 || tile === 3 || tile === 5) return false;
                }
            }
            return true;
        }

        function resolveMapCollision(ent) {
            let hitWall = false;

            // 外壁バウンダリ制限
            const clampedX = Math.max(ent.radius, Math.min(MAP_WIDTH - ent.radius, ent.x));
            const clampedY = Math.max(ent.radius, Math.min(MAP_HEIGHT - ent.radius, ent.y));
            if (clampedX !== ent.x || clampedY !== ent.y) {
                ent.x = clampedX;
                ent.y = clampedY;
                hitWall = true;
            }

            const col = Math.floor(ent.x / TILE_SIZE);
            const row = Math.floor(ent.y / TILE_SIZE);

            // 近隣の3x3タイルをチェックして円形と矩形（AABB）の押し出し処理
            for (let r = row - 1; r <= row + 1; r++) {
                for (let c = col - 1; c <= col + 1; c++) {
                    if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS) {
                        const tile = gameState.map[r][c];
                        // 1: 2.5D石壁, 3: 壊せる骨箱, 5: 松明
                        if (tile === 1 || tile === 3 || tile === 5) {
                            const tileX = c * TILE_SIZE;
                            const tileY = r * TILE_SIZE;
                            const testX = Math.max(tileX, Math.min(ent.x, tileX + TILE_SIZE));
                            const testY = Math.max(tileY, Math.min(ent.y, tileY + TILE_SIZE));
                            const distX = ent.x - testX;
                            const distY = ent.y - testY;
                            const distance = Math.hypot(distX, distY);
                            
                            if (distance < ent.radius) {
                                hitWall = true;
                                const pushDist = ent.radius - distance;
                                if (distance === 0) { 
                                    ent.x += pushDist; // 完全に中心が重なった場合のフェールセーフ
                                } else {
                                    ent.x += (distX / distance) * pushDist;
                                    ent.y += (distY / distance) * pushDist;
                                }
                            }
                        }
                    }
                }
            }
            return hitWall;
        }

        // ----------------------------------------------------------------------------
        // 7. AI思考ルーチン（壁ハマり回避＋モード別行動）
        // ----------------------------------------------------------------------------
        function applyAiAntiStuck(ai, dt) {
            // 壁に引っかかって移動距離が極端に小さい場合は横方向へ回避する
            if (ai.aiUnstuckTimer && ai.aiUnstuckTimer > 0) {
                ai.aiUnstuckTimer -= dt;
                ai.vx = ai.aiUnstuckDir.x * ai.speed;
                ai.vy = ai.aiUnstuckDir.y * ai.speed;
                return true;
            }

            const moved = Math.hypot(ai.x - ai.aiLastX, ai.y - ai.aiLastY);
            // 以前より検知基準を敏感にし(0.28 -> 0.45)、早く回避行動を取らせる
            if (Math.hypot(ai.vx, ai.vy) > 10 && moved < ai.speed * dt * 0.45) {
                ai.aiStuckTimer += dt;
                if (ai.aiStuckTimer >= 0.2) { // 0.25 -> 0.2秒で早く諦める
                    ai.aiStuckTimer = 0;
                    ai.aiUnstuckTimer = 0.55; // 0.45 -> 0.55秒に伸ばして確実に障害物を回り込む
                    const curAngle = Math.atan2(ai.vy, ai.vx);
                    const side = Math.random() < 0.5 ? 1 : -1;
                    const escapeAngle = curAngle + side * (Math.PI * 0.55);
                    ai.aiUnstuckDir = { x: Math.cos(escapeAngle), y: Math.sin(escapeAngle) };
                    ai.vx = ai.aiUnstuckDir.x * ai.speed;
                    ai.vy = ai.aiUnstuckDir.y * ai.speed;
                    return true;
                }
            } else {
                ai.aiStuckTimer = Math.max(0, ai.aiStuckTimer - dt);
            }
            ai.aiLastX = ai.x;
            ai.aiLastY = ai.y;
            return false;
        }

        function updateAiController(ai, dt) {
            ai.aiTimer -= dt;

            // 壁ハマり回避中なら最優先で抜ける
            if (applyAiAntiStuck(ai, dt)) {
                if (Math.hypot(ai.vx, ai.vy) > 5) {
                    ai.facingAngle = Math.atan2(ai.vy, ai.vx);
                }
                return;
            }

            // 近くのターゲット探索（ジェム or 敵）
            let nearestEnemy = null;
            let nearestEnemyDist = Infinity;
            for (const other of gameState.entities) {
                if (other.dead || other.team === ai.team) continue;
                const d = Math.hypot(other.x - ai.x, other.y - ai.y);
                if (other.inBush && other.revealedTimer <= 0 && d > 170) continue;
                if (d < nearestEnemyDist) {
                    nearestEnemyDist = d;
                    nearestEnemy = other;
                }
            }

            let nearestGem = null;
            let nearestGemDist = Infinity;
            for (const g of gameState.gems) {
                const d = Math.hypot(g.x - ai.x, g.y - ai.y);
                if (d < nearestGemDist) {
                    nearestGemDist = d;
                    nearestGem = g;
                }
            }

            // キックオフサッカー専用AI思考
            if (gameState.soccer.active) {
                // リルはサッカーボールを追わないし蹴らない（単純に敵を追うのみ）
                if (ai.role === "lil") {
                    if (nearestEnemy) {
                        const aimAngle = Math.atan2(nearestEnemy.y - ai.y, nearestEnemy.x - ai.x);
                        ai.vx = Math.cos(aimAngle) * ai.speed;
                        ai.vy = Math.sin(aimAngle) * ai.speed;
                        ai.facingAngle = aimAngle;
                    } else {
                        const owner = gameState.entities.find(e => e.id === ai.ownerId);
                        if (owner && !owner.dead) {
                            const dx = owner.x - ai.x;
                            const dy = owner.y - ai.y;
                            if (Math.hypot(dx, dy) > 80) {
                                ai.vx = (dx / Math.hypot(dx, dy)) * ai.speed;
                                ai.vy = (dy / Math.hypot(dx, dy)) * ai.speed;
                                ai.facingAngle = Math.atan2(dy, dx);
                            } else {
                                ai.vx = 0; ai.vy = 0;
                            }
                        } else {
                            ai.vx = 0; ai.vy = 0;
                        }
                    }
                    return;
                }

                const ball = gameState.soccer.ball;
                const enemyGoalX = ai.team === "blue" ? MAP_WIDTH - TILE_SIZE * 0.6 : TILE_SIZE * 0.6;
                const enemyGoalY = MAP_HEIGHT * 0.5;

                if (ball.holderId === ai.id) {
                    const goalAngle = Math.atan2(enemyGoalY - ai.y, enemyGoalX - ai.x);
                    const distToGoal = Math.hypot(enemyGoalX - ai.x, enemyGoalY - ai.y);

                    // 敵が近づいてきたら前線の味方へパス、または空きスペースへ蹴る
                    if (nearestEnemy && nearestEnemyDist < 180) {
                        let bestAlly = null;
                        let bestAllyDistToGoal = distToGoal;
                        for (const ally of gameState.entities) {
                            if (ally.dead || ally.team !== ai.team || ally.id === ai.id) continue;
                            const dGoal = Math.hypot(enemyGoalX - ally.x, enemyGoalY - ally.y);
                            if (dGoal < bestAllyDistToGoal) {
                                bestAllyDistToGoal = dGoal;
                                bestAlly = ally;
                            }
                        }
                        
                        const rand = Math.random();
                        if (bestAlly && rand < 0.5) {
                            // 前線の味方へパス
                            const passAngle = Math.atan2(bestAlly.y - ai.y, bestAlly.x - ai.x);
                            ai.facingAngle = passAngle;
                            kickSoccerBall(ai, passAngle, false);
                            return;
                        } else if (rand < 0.75) {
                            // 何もない前方の空きスペースへスルーパス・クリア
                            const randomAngle = goalAngle + (Math.random() - 0.5) * Math.PI * 0.8;
                            ai.facingAngle = randomAngle;
                            kickSoccerBall(ai, randomAngle, false);
                            return;
                        } else {
                            // 苦し紛れにゴール方向へ蹴り出す
                            ai.facingAngle = goalAngle;
                            kickSoccerBall(ai, goalAngle, false);
                            return;
                        }
                    }

                    // ボールを持っている場合：敵ゴールへ向かってドリブル＆射程内でシュート！
                    ai.vx = Math.cos(goalAngle) * ai.speed;
                    ai.vy = Math.sin(goalAngle) * ai.speed;
                    ai.facingAngle = goalAngle;

                    if (ai.ultCharge >= 100 && distToGoal < 680) {
                        kickSoccerBall(ai, goalAngle, true);
                    } else if (distToGoal < 420) {
                        kickSoccerBall(ai, goalAngle, false);
                    }
                    return;
                } else {
                    // ボールを追いかける or 近くの敵を牽制
                    let closestAllyToBall = null;
                    let closestAllyDist = Infinity;
                    for (const ally of gameState.entities) {
                        if (ally.dead || ally.team !== ai.team) continue;
                        const refX = ball.holderId === ally.id ? ally.x : ball.x;
                        const refY = ball.holderId === ally.id ? ally.y : ball.y;
                        const d = Math.hypot(ally.x - refX, ally.y - refY);
                        if (d < closestAllyDist) {
                            closestAllyDist = d;
                            closestAllyToBall = ally;
                        }
                    }

                    // 自分よりボールに近い味方がいる場合は群がらずに散らばる（戦略的ポジショニング）
                    if (closestAllyToBall && closestAllyToBall.id !== ai.id) {
                        const enemyGoalX = ai.team === "blue" ? MAP_WIDTH - TILE_SIZE * 3 : TILE_SIZE * 3;
                        const spreadY = (ai.id % 2 === 0) ? -160 : 160;
                        let targetX = ball.x * 0.4 + enemyGoalX * 0.6; 
                        let targetY = MAP_HEIGHT / 2 + spreadY;

                        // フィールド内に収める
                        targetX = Math.max(TILE_SIZE * 2, Math.min(MAP_WIDTH - TILE_SIZE * 2, targetX));
                        targetY = Math.max(TILE_SIZE * 2, Math.min(MAP_HEIGHT - TILE_SIZE * 2, targetY));

                        const dxTarget = targetX - ai.x;
                        const dyTarget = targetY - ai.y;
                        const lenTarget = Math.hypot(dxTarget, dyTarget) || 1;
                        
                        if (lenTarget > 40) {
                            ai.vx = (dxTarget / lenTarget) * ai.speed * 0.95;
                            ai.vy = (dyTarget / lenTarget) * ai.speed * 0.95;
                        } else {
                            ai.vx = 0; ai.vy = 0;
                        }

                        if (nearestEnemy && nearestEnemyDist <= ai.range * 1.05) {
                            const aimAngle = Math.atan2(nearestEnemy.y - ai.y, nearestEnemy.x - ai.x);
                            ai.facingAngle = aimAngle;
                            if (ai.ammo >= 1.0) fireBrawlerAttack(ai, aimAngle);
                        } else if (Math.hypot(ai.vx, ai.vy) > 5) {
                            ai.facingAngle = Math.atan2(ai.vy, ai.vx);
                        }
                        return;
                    }
                    
                    // 自分が一番ボールに近い場合はボールに向かってダッシュ！
                    const targetX = ball.x;
                    const targetY = ball.y;
                    const dx = targetX - ai.x;
                    const dy = targetY - ai.y;
                    const len = Math.hypot(dx, dy) || 1;
                    
                    ai.vx = (dx / len) * ai.speed;
                    ai.vy = (dy / len) * ai.speed;

                    if (nearestEnemy && nearestEnemyDist <= ai.range * 1.05) {
                        const aimAngle = Math.atan2(nearestEnemy.y - ai.y, nearestEnemy.x - ai.x);
                        ai.facingAngle = aimAngle;
                        if (ai.ammo >= 1.0) fireBrawlerAttack(ai, aimAngle);
                    } else {
                        ai.facingAngle = Math.atan2(dy, dx);
                    }
                    return;
                }
            }

            // 通常モードのリルAI思考
            if (ai.role === "lil") {
                if (nearestEnemy) {
                    const aimAngle = Math.atan2(nearestEnemy.y - ai.y, nearestEnemy.x - ai.x);
                    ai.vx = Math.cos(aimAngle) * ai.speed;
                    ai.vy = Math.sin(aimAngle) * ai.speed;
                    ai.facingAngle = aimAngle;
                } else {
                    const owner = gameState.entities.find(e => e.id === ai.ownerId);
                    if (owner && !owner.dead) {
                        const dx = owner.x - ai.x;
                        const dy = owner.y - ai.y;
                        if (Math.hypot(dx, dy) > 80) {
                            ai.vx = (dx / Math.hypot(dx, dy)) * ai.speed;
                            ai.vy = (dy / Math.hypot(dx, dy)) * ai.speed;
                            ai.facingAngle = Math.atan2(dy, dx);
                        } else {
                            ai.vx = 0; ai.vy = 0;
                        }
                    } else {
                        ai.vx = 0; ai.vy = 0;
                    }
                }
                return;
            }

            if (ai.aiTimer <= 0) {
                ai.aiTimer = 0.25 + Math.random() * 0.25;
                let goalX = MAP_WIDTH * 0.5;
                let goalY = MAP_HEIGHT * 0.5;

                if (gameState.dangerZone.active) {
                    const dz = gameState.dangerZone;
                    const distToZone = Math.hypot(ai.x - dz.x, ai.y - dz.y);
                    const spreadAngle = ((ai.id * 2.1) % (Math.PI * 2));
                    const targetOffsetR = dz.radius * 0.48;
                    if (distToZone > dz.radius * 0.72) {
                        goalX = dz.x + Math.cos(spreadAngle) * targetOffsetR;
                        goalY = dz.y + Math.sin(spreadAngle) * targetOffsetR;
                    } else if (nearestEnemy && nearestEnemyDist < ai.range * 0.95) {
                        const strafe = (Math.random() < 0.5 ? 1 : -1) * (Math.PI * 0.45);
                        const aToE = Math.atan2(nearestEnemy.y - ai.y, nearestEnemy.x - ai.x);
                        goalX = Math.max(dz.x - dz.radius * 0.75, Math.min(dz.x + dz.radius * 0.75, ai.x + Math.cos(aToE + strafe) * 90));
                        goalY = Math.max(dz.y - dz.radius * 0.75, Math.min(dz.y + dz.radius * 0.75, ai.y + Math.sin(aToE + strafe) * 90));
                    } else {
                        goalX = dz.x + Math.cos(spreadAngle + gameState.time * 0.4) * targetOffsetR;
                        goalY = dz.y + Math.sin(spreadAngle + gameState.time * 0.4) * targetOffsetR;
                    }
                } else if (ai.gems >= 4 && ai.hp < ai.maxHp * 0.55) {
                    // ジェムを多く持っている場合は自陣側へ後退
                    goalX = ai.spawnX;
                    goalY = ai.spawnY;
                } else if (nearestGem && nearestGemDist < 420) {
                    goalX = nearestGem.x;
                    goalY = nearestGem.y;
                } else if (nearestEnemy) {
                    const idealRange = ai.range * 0.72;
                    const angleToEnemy = Math.atan2(nearestEnemy.y - ai.y, nearestEnemy.x - ai.x);
                    if (nearestEnemyDist > idealRange) {
                        goalX = nearestEnemy.x;
                        goalY = nearestEnemy.y;
                    } else {
                        // 適度な距離を保ちつつ横ステップ
                        const strafe = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2);
                        goalX = ai.x + Math.cos(angleToEnemy + strafe) * 120;
                        goalY = ai.y + Math.sin(angleToEnemy + strafe) * 120;
                    }
                } else if (gameState.knockout.active) {
                    // ノックアウト時：敵が視界にいなければマップ中央〜敵陣方向へ積極的に索敵
                    const patrolX = ai.team === "blue" ? MAP_WIDTH * 0.58 : MAP_WIDTH * 0.42;
                    goalX = patrolX + (Math.random() - 0.5) * 260;
                    goalY = MAP_HEIGHT * 0.5 + (Math.random() - 0.5) * 380;
                }

                const dx = goalX - ai.x;
                const dy = goalY - ai.y;
                const len = Math.hypot(dx, dy);
                if (len > 10) {
                    ai.aiMoveDir.x = dx / len;
                    ai.aiMoveDir.y = dy / len;
                } else {
                    ai.aiMoveDir.x = 0;
                    ai.aiMoveDir.y = 0;
                }
            }

            ai.vx = ai.aiMoveDir.x * ai.speed;
            ai.vy = ai.aiMoveDir.y * ai.speed;

            if (nearestEnemy && nearestEnemyDist <= ai.range * 1.05) {
                const aimAngle = Math.atan2(nearestEnemy.y - ai.y, nearestEnemy.x - ai.x);
                ai.facingAngle = aimAngle;
                if (ai.ultCharge >= 100 && (ai.role === "blaze" || ai.role === "viper" || ai.role === "titan" || ai.role === "saital" || ai.role === "eric" || ai.role === "frost" || ai.role === "centaur" || ai.role === "rearn" || ai.role === "forever")) {
                    triggerBrawlerUlt(ai, aimAngle, nearestEnemyDist);
                } else if (ai.ammo >= 1.0) {
                    fireBrawlerAttack(ai, aimAngle);
                }
            } else if (Math.hypot(ai.vx, ai.vy) > 5) {
                ai.facingAngle = Math.atan2(ai.vy, ai.vx);
            }
        }

        // ----------------------------------------------------------------------------
        // 8. ゲーム全体アップデート処理
        // ----------------------------------------------------------------------------
        function resetAfterSoccerGoal(concedingTeam) {
            const sc = gameState.soccer;
            const ball = sc.ball;
            ball.holderId = null;
            ball.lastKickerId = null;
            ball.vx = 0;
            ball.vy = 0;
            ball.superShot = false;
            ball.pickupCooldown = 0.4;

            // 先に一点決めると「失点した敵チーム側」にボールがスポーンする
            ball.x = concedingTeam === "red" ? MAP_WIDTH * 0.68 : MAP_WIDTH * 0.32;
            ball.y = MAP_HEIGHT * 0.5;

            for (const ent of gameState.entities) {
                ent.dead = false;
                ent.respawnTimer = 0;
                ent.hp = ent.maxHp;
                ent.ammo = ent.maxAmmo;
                ent.dashTimer = 0;
                ent.x = ent.spawnX;
                ent.y = ent.spawnY;
            }
            document.getElementById("respawnOverlay").classList.add("hidden");
            spawnParticles(ball.x, ball.y, "#34d399", 20, 180);
        }

        function triggerSoccerSuddenDeath() {
            const sc = gameState.soccer;
            if (sc.suddenDeath) return;
            sc.suddenDeath = true;
            gameState.camera.shake = 14;
            sound.playPiercingUlt();
            showToast("サドンデス突入！フィールドの壁がすべて消滅！");

            // 外周とフィールド内の壁をすべて消滅させる
            for (let r = 0; r < MAP_ROWS; r++) {
                for (let c = 0; c < MAP_COLS; c++) {
                    if (gameState.map[r][c] === 1 || gameState.map[r][c] === 3 || gameState.map[r][c] === 5) {
                        gameState.map[r][c] = 0;
                        if ((r + c) % 2 === 0) {
                            spawnParticles((c + 0.5) * TILE_SIZE, (r + 0.5) * TILE_SIZE, "#facc15", 5, 160);
                        }
                    }
                }
            }
        }

        function updateSoccerMode(dt) {
            const sc = gameState.soccer;
            const ball = sc.ball;

            // ゴール直後の小休止演出
            if (sc.goalResetTimer > 0) {
                sc.goalResetTimer -= dt;
                if (sc.goalResetTimer <= 0 && gameState.status === "playing") {
                    const lastConceding = sc.lastConcedingTeam || "red";
                    resetAfterSoccerGoal(lastConceding);
                }
                return;
            }

            // 3分（180秒）タイマー進行
            if (!sc.suddenDeath) {
                sc.matchTimer = Math.max(0, sc.matchTimer - dt);
                const mins = Math.floor(sc.matchTimer / 60);
                const secs = Math.floor(sc.matchTimer % 60);
                document.getElementById("hudSoccerClock").textContent =
                    `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

                if (sc.matchTimer <= 0) {
                    // 3分経って 1対1 の場合のみサドンデスになり壁が全部消える
                    if (sc.blueGoals === 1 && sc.redGoals === 1) {
                        triggerSoccerSuddenDeath();
                        document.getElementById("hudSoccerClock").textContent = "SUDDEN!";
                    } else if (sc.blueGoals !== sc.redGoals) {
                        finishMatch(sc.blueGoals > sc.redGoals);
                        return;
                    } else {
                        // 0-0 の場合も延長サドンデスへ突入
                        triggerSoccerSuddenDeath();
                        document.getElementById("hudSoccerClock").textContent = "SUDDEN!";
                    }
                }
            }

            if (ball.pickupCooldown > 0) ball.pickupCooldown = Math.max(0, ball.pickupCooldown - dt);

            const holder = ball.holderId ? gameState.entities.find((e) => e.id === ball.holderId && !e.dead) : null;
            if (holder) {
                ball.x = holder.x + Math.cos(holder.facingAngle) * (holder.radius + 10);
                ball.y = holder.y + Math.sin(holder.facingAngle) * (holder.radius + 10);
                ball.vx = 0;
                ball.vy = 0;
                ball.spin += dt * 8;
            } else {
                ball.holderId = null;
                ball.x += ball.vx * dt;
                ball.y += ball.vy * dt;
                const speed = Math.hypot(ball.vx, ball.vy);
                ball.spin += speed * dt * 0.04;

                if (ball.superShot && speed > 300) {
                    spawnParticles(ball.x, ball.y, "#facc15", 2, 70);
                }

                // 摩擦減速
                const drag = ball.superShot ? 0.5 : 0.25;
                ball.vx *= Math.pow(drag, dt);
                ball.vy *= Math.pow(drag, dt);
                if (speed < 25) {
                    ball.vx = 0;
                    ball.vy = 0;
                    ball.superShot = false;
                }

                // タイル壁との反射（スーパーシュート中は障害物壁を粉砕！）
                const col = Math.floor(ball.x / TILE_SIZE);
                const row = Math.floor(ball.y / TILE_SIZE);
                if (row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS) {
                    const tile = gameState.map[row][col];
                    if (tile === 1 || tile === 3 || tile === 5) {
                        const isOuterBoundary = (row === 0 || row === MAP_ROWS - 1 || col === 0 || col === MAP_COLS - 1);
                        if (ball.superShot && !isOuterBoundary && !sc.suddenDeath) {
                            gameState.map[row][col] = 0;
                            spawnParticles((col + 0.5) * TILE_SIZE, (row + 0.5) * TILE_SIZE, "#fbbf24", 14, 180);
                        } else {
                            const tileCenterX = (col + 0.5) * TILE_SIZE;
                            const tileCenterY = (row + 0.5) * TILE_SIZE;
                            if (Math.abs(ball.x - tileCenterX) > Math.abs(ball.y - tileCenterY)) {
                                ball.vx = -ball.vx * 0.78;
                                ball.x += Math.sign(ball.x - tileCenterX) * 8;
                            } else {
                                ball.vy = -ball.vy * 0.78;
                                ball.y += Math.sign(ball.y - tileCenterY) * 8;
                            }
                            ball.superShot = false;
                        }
                    }
                }

                // 上下境界バウンド
                if (ball.y < TILE_SIZE + ball.radius) {
                    ball.y = TILE_SIZE + ball.radius;
                    ball.vy = Math.abs(ball.vy) * 0.8;
                } else if (ball.y > MAP_HEIGHT - TILE_SIZE - ball.radius) {
                    ball.y = MAP_HEIGHT - TILE_SIZE - ball.radius;
                    ball.vy = -Math.abs(ball.vy) * 0.8;
                }

                // キャラクターによるボール拾い判定（蹴った本人はクールダウン中拾えないが、他人は拾える）
                for (const ent of gameState.entities) {
                    if (ent.dead) continue;
                    if (ent.id === ball.lastKickerId && ball.pickupCooldown > 0) continue;
                    
                    if (Math.hypot(ent.x - ball.x, ent.y - ball.y) < ent.radius + ball.radius + 18) {
                        ball.holderId = ent.id;
                        ball.superShot = false;
                        if (ent.isPlayer) showToast("ボール所持！攻撃でシュート / ウルトで超高速シュート！");
                        break;
                    }
                }
            }

            // ゴールライン判定（左ゴール＝赤得点 / 右ゴール＝青得点）を少し広げて壁反射を防ぐ
            const inGoalY = ball.y >= 5.0 * TILE_SIZE && ball.y <= 13.0 * TILE_SIZE;
            if (inGoalY && ball.x <= TILE_SIZE * 1.5) {
                if (ball.lastKickerTeam === "blue") {
                    // 自陣へのオウンゴール防止（見えない壁で反射）
                    ball.x = TILE_SIZE * 1.5;
                    ball.vx = Math.abs(ball.vx) * 0.8;
                } else {
                    // 赤チーム得点！
                    sc.redGoals += 1;
                    sc.lastConcedingTeam = "blue";
                    document.getElementById("redGemCount").textContent = sc.redGoals;
                    gameState.camera.shake = 12;
                    sound.playEnd(false);
                    spawnParticles(ball.x, ball.y, "#f43f5e", 28, 260);
                    if (sc.redGoals >= 2) {
                        finishMatch(false);
                        return;
                    }
                    showToast("RED GOAL!! 失点した青陣地にボール出現！");
                    sc.goalResetTimer = 2.5;
                }
            } else if (inGoalY && ball.x >= MAP_WIDTH - TILE_SIZE * 1.5) {
                if (ball.lastKickerTeam === "red") {
                    // 自陣へのオウンゴール防止（見えない壁で反射）
                    ball.x = MAP_WIDTH - TILE_SIZE * 1.5;
                    ball.vx = -Math.abs(ball.vx) * 0.8;
                } else {
                    // 青チーム得点！
                    sc.blueGoals += 1;
                    sc.lastConcedingTeam = "red";
                    document.getElementById("blueGemCount").textContent = sc.blueGoals;
                    gameState.camera.shake = 12;
                    sound.playGem();
                    spawnParticles(ball.x, ball.y, "#38bdf8", 28, 260);
                    if (sc.blueGoals >= 2) {
                        finishMatch(true);
                        return;
                    }
                    showToast("BLUE GOAL!! 失点した赤陣地にボール出現！");
                    sc.goalResetTimer = 2.5;
                }
            } else {
                // ゴール枠外の左右壁跳ね返り
                if (ball.x < TILE_SIZE + ball.radius) {
                    ball.x = TILE_SIZE + ball.radius;
                    ball.vx = Math.abs(ball.vx) * 0.8;
                } else if (ball.x > MAP_WIDTH - TILE_SIZE - ball.radius) {
                    ball.x = MAP_WIDTH - TILE_SIZE - ball.radius;
                    ball.vx = -Math.abs(ball.vx) * 0.8;
                }
            }
        }

        function resetKnockoutRound() {
            const ko = gameState.knockout;
            ko.currentRound += 1;
            ko.lastRoundWinner = null;

            // マップと戦場エフェクトを新ラウンド用に初期化
            gameState.map = createKnockoutArenaMap();
            gameState.projectiles = [];
            gameState.zones = [];
            gameState.particles = [];
            gameState.shockwaves = [];
            gameState.afterimages = [];

            // 召喚ペット（リル）を除去
            gameState.entities = gameState.entities.filter((e) => e.role !== "lil");

            // 全キャラクターを初期位置へ復帰・全回復（ウルトゲージは引き継ぎ）
            for (const ent of gameState.entities) {
                ent.dead = false;
                ent.respawnTimer = 0;
                ent.hp = ent.maxHp;
                ent.ammo = ent.maxAmmo;
                ent.dashTimer = 0;
                ent.slowTimer = 0;
                ent.slipTimer = 0;
                ent.centaurSpeedScale = 3.5;
                ent.axeChargeTimer = 0;
                ent.rearnUltTimer = 0;
                ent.burstQueue = [];
                if (ent.role === "forever") {
                    ent.foreverChargedShot = false;
                    ent.foreverHuntActive = false;
                    ent.foreverUltTimer = 0;
                    ent.maxAmmo = 1.0;
                    ent.ammo = 1.0;
                }
                if (ent.isPuppet) {
                    ent.isPuppet = false;
                    ent.team = ent.originalTeam;
                    ent.puppetTimer = 0;
                    ent.puppetMasterId = null;
                }
                ent.x = ent.spawnX;
                ent.y = ent.spawnY;
                ent.vx = 0;
                ent.vy = 0;
                ent.facingAngle = ent.team === "blue" ? 0 : Math.PI;
            }

            const ov = document.getElementById("respawnOverlay");
            if (ov) {
                ov.classList.add("hidden");
                ov.innerHTML = `撃破された！復活まで <span id="respawnSec" class="text-white text-lg">3</span> 秒...`;
            }

            document.getElementById("hudSoccerClock").textContent = `ROUND ${ko.currentRound}`;
            showToast(`ROUND ${ko.currentRound} START！敵を全員倒せ！`);
        }

        function updateKnockoutMode(dt) {
            const ko = gameState.knockout;
            const banner = document.getElementById("countdownBanner");

            if (ko.roundResetTimer > 0) {
                ko.roundResetTimer -= dt;
                if (ko.roundResetTimer <= 0 && gameState.status === "playing") {
                    resetKnockoutRound();
                }
                return;
            }

            let blueAlive = 0;
            let redAlive = 0;
            for (const ent of gameState.entities) {
                if (ent.dead || ent.role === "lil") continue;
                const origTeam = ent.originalTeam || ent.team;
                if (origTeam === "blue") blueAlive++;
                else if (origTeam === "red") redAlive++;
            }

            // 生存人数バナー表示
            banner.classList.remove("hidden");
            banner.className = "mt-2 px-4 py-1 rounded-full bg-slate-900/90 border border-slate-600/80 text-slate-100 font-black text-xs sm:text-sm tracking-wider shadow-lg";
            banner.textContent = `生存数：BLUE ${blueAlive} vs ${redAlive} RED`;

            // どちらかのチームが全滅したら相手チームに＋1点
            if (blueAlive === 0 || redAlive === 0) {
                if (redAlive === 0 && blueAlive > 0) {
                    ko.blueRounds += 1;
                    ko.lastRoundWinner = "blue";
                    document.getElementById("blueGemCount").textContent = ko.blueRounds;
                    sound.playGem();
                    gameState.camera.shake = 10;
                    banner.className = "mt-2 px-4 py-1 rounded-full bg-sky-400 text-slate-950 font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                    banner.textContent = `BLUE TEAM ROUND WIN! (+1pt)`;
                    if (ko.blueRounds >= 3) {
                        finishMatch(true);
                        return;
                    }
                    showToast(`敵を全員撃破！青チームに＋1点（${ko.blueRounds} - ${ko.redRounds}）`);
                } else if (blueAlive === 0 && redAlive > 0) {
                    ko.redRounds += 1;
                    ko.lastRoundWinner = "red";
                    document.getElementById("redGemCount").textContent = ko.redRounds;
                    sound.playEnd(false);
                    gameState.camera.shake = 10;
                    banner.className = "mt-2 px-4 py-1 rounded-full bg-rose-500 text-white font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                    banner.textContent = `RED TEAM ROUND WIN! (+1pt)`;
                    if (ko.redRounds >= 3) {
                        finishMatch(false);
                        return;
                    }
                    showToast(`味方が全滅…赤チームに＋1点（${ko.blueRounds} - ${ko.redRounds}）`);
                } else {
                    // 完全相打ちの場合はドローで次ラウンドへ
                    ko.lastRoundWinner = "draw";
                    banner.className = "mt-2 px-4 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                    banner.textContent = `DRAW ROUND! 次のラウンドへ`;
                    showToast("相打ちドロー！次のラウンドへ進みます");
                }
                ko.roundResetTimer = 2.2;
            }
        }

        function updateGame(dt) {
            gameState.time += dt;

            if (gameState.camera.shake > 0) {
                gameState.camera.shake = Math.max(0, gameState.camera.shake - dt * 28);
            }

            if (gameState.status !== "playing") return;

            // ゴール後・ノックアウトラウンド間の休止中は全員の動きを止める
            const isGoalPause =
                (gameState.soccer.active && gameState.soccer.goalResetTimer > 0) ||
                (gameState.knockout.active && gameState.knockout.roundResetTimer > 0);

            // 中央ジェム鉱脈からの定期スポーン（サッカー・危険地帯・ノックアウト時は無効）
            if (!gameState.soccer.active && !gameState.dangerZone.active && !gameState.knockout.active) {
                gameState.gemSpawnerTimer -= dt;
                if (gameState.gemSpawnerTimer <= 0) {
                    gameState.gemSpawnerTimer = selectedGameMode === "gem_rush" ? 3.5 : 6.5;
                    if (gameState.gems.length < 14) {
                        spawnGem(MAP_WIDTH * 0.5, MAP_HEIGHT * 0.5, false);
                        spawnParticles(MAP_WIDTH * 0.5, MAP_HEIGHT * 0.5, "#22d3ee", 10, 100);
                    }
                }
            }

            // キャラクター更新
            for (const ent of gameState.entities) {
                ent.capePhase += dt * 7.5;
                if (ent.hurtFlash > 0) ent.hurtFlash = Math.max(0, ent.hurtFlash - dt);
                if (ent.revealedTimer > 0) ent.revealedTimer = Math.max(0, ent.revealedTimer - dt);
                if (ent.axeSwingAnim > 0) ent.axeSwingAnim = Math.max(0, ent.axeSwingAnim - dt);
                if (ent.foreverSwingAnim > 0) ent.foreverSwingAnim = Math.max(0, ent.foreverSwingAnim - dt);

                if (ent.dead) {
                    if (ent.role === "lil") {
                        gameState.entities.splice(gameState.entities.indexOf(ent), 1);
                        continue;
                    }
                    // ノックアウトモードではそのラウンド中の復活なし
                    if (gameState.knockout.active) {
                        continue;
                    }
                    ent.respawnTimer -= dt;
                    if (ent.isPlayer) {
                        document.getElementById("respawnOverlay").classList.remove("hidden");
                        const secEl = document.getElementById("respawnSec");
                        if (secEl) secEl.textContent = Math.max(1, Math.ceil(ent.respawnTimer));
                    }
                    if (ent.respawnTimer <= 0) {
                        ent.dead = false;
                        ent.hp = ent.maxHp;
                        ent.ammo = ent.maxAmmo;
                        ent.x = ent.spawnX;
                        ent.y = ent.spawnY;
                        ent.dashTimer = 0;
                        ent.slowTimer = 0;
                        ent.slipTimer = 0;
                        ent.centaurSpeedScale = 3.5;
                        ent.axeChargeTimer = 0;
                        ent.rearnUltTimer = 0;
                        if (ent.role === "forever") {
                            ent.foreverChargedShot = false;
                            ent.foreverHuntActive = false;
                            ent.foreverUltTimer = 0;
                            ent.maxAmmo = 1.0;
                            ent.ammo = 1.0;
                        }
                        if (ent.isPuppet) {
                            ent.isPuppet = false;
                            ent.team = ent.originalTeam;
                            ent.puppetTimer = 0;
                            ent.puppetMasterId = null;
                        }
                        if (ent.isPlayer) {
                            document.getElementById("respawnOverlay").classList.add("hidden");
                            showToast("戦場へ復帰した！");
                        }
                        spawnParticles(ent.x, ent.y, "#38bdf8", 16, 160);
                    }
                    continue;
                }

                // レアーン専用パッシブ：自分の周囲の大きめの円内に敵がいるとウルトが自動で溜まる
                if (ent.role === "rearn" && ent.rearnUltTimer <= 0 && !ent.isPuppet && !isGoalPause) {
                    let enemyInAura = false;
                    for (const other of gameState.entities) {
                        if (other.dead || other.team === ent.team) continue;
                        if (Math.hypot(other.x - ent.x, other.y - ent.y) <= ent.rearnZoneRadius + other.radius) {
                            enemyInAura = true;
                            break;
                        }
                    }
                    if (enemyInAura) {
                        const prevUlt = ent.ultCharge;
                        ent.ultCharge = Math.min(ent.maxUltCharge, ent.ultCharge + 14 * dt);
                        if (ent.isPlayer && prevUlt < 100 && ent.ultCharge >= 100) {
                            sound.playUltReady();
                            showToast("ウルトチャージ完了！ブラッドムーン発動可能！");
                        }
                    }
                }

                // レアーン専用ウルト発動中：3秒間くるくる回転し、終了時に円内の敵を5秒間人形化
                if (ent.role === "rearn" && ent.rearnUltTimer > 0) {
                    ent.rearnUltTimer -= dt;
                    ent.facingAngle += dt * 14;
                    ent.vx = 0;
                    ent.vy = 0;
                    if (Math.random() < 0.5) {
                        spawnParticles(ent.x, ent.y, "#dc2626", 1, 90);
                    }
                    if (ent.rearnUltTimer <= 0) {
                        ent.rearnUltTimer = 0;
                        let puppetCount = 0;
                        for (const target of gameState.entities) {
                            if (target.dead || target.team === ent.team || target.role === "lil") continue;
                            if (Math.hypot(target.x - ent.x, target.y - ent.y) <= ent.rearnZoneRadius + target.radius) {
                                // 3秒後に円の中にいた敵を黒く染めて人形化！5秒後に解除され、体力の半分をレアーンへ献上する
                                target.isPuppet = true;
                                target.team = ent.team;
                                target.puppetTimer = 5.0;
                                target.puppetMasterId = ent.id;
                                target.puppetSpin = 0;
                                target.puppetAttackCd = 0;
                                target.dashTimer = 0;
                                target.rearnUltTimer = 0;
                                puppetCount++;

                                // ボールを所持していれば落とす
                                if (gameState.soccer.active && gameState.soccer.ball.holderId === target.id) {
                                    gameState.soccer.ball.holderId = null;
                                    gameState.soccer.ball.vx = (Math.random() - 0.5) * 200;
                                    gameState.soccer.ball.vy = (Math.random() - 0.5) * 200;
                                }
                                spawnParticles(target.x, target.y, "#09080f", 20, 180);
                                spawnParticles(target.x, target.y, "#a855f7", 14, 160);
                                spawnFloatingText(target.x, target.y - 42, "人形支配(5秒)！", "#c084fc");
                            }
                        }
                        if (ent.isPlayer) {
                            sound.playPiercingUlt();
                            gameState.camera.shake = 12;
                            showToast(puppetCount > 0 ? `ブラッドムーン発動！${puppetCount}体を5秒間人形化！` : "円内に敵がいなかった…");
                        }
                    }
                    continue;
                }

                // 人形化状態（黒く染められ、くるくる回り手を横に上げながら敵に攻撃し続ける／5秒で解除時に体力半分をレアーンへ献上）
                if (ent.isPuppet) {
                    ent.puppetTimer -= dt;
                    if (ent.puppetTimer <= 0) {
                        // 5秒経過で人形化解除：現在の体力の半分をレアーンに収める
                        const tribute = Math.max(1, Math.floor(ent.hp * 0.5));
                        ent.hp = Math.max(1, ent.hp - tribute);
                        ent.hurtFlash = 0.2;
                        ent.stats.damageTaken += tribute;
                        spawnFloatingText(ent.x, ent.y - 40, `-${tribute} (体力献上)`, "#c084fc");
                        spawnParticles(ent.x, ent.y, "#a855f7", 18, 170);

                        const master = gameState.entities.find((e) => e.id === ent.puppetMasterId && !e.dead);
                        if (master) {
                            master.stats.damageDealt += tribute;
                            const actualHeal = Math.min(tribute, master.maxHp - master.hp);
                            master.hp += actualHeal;
                            master.stats.healAmount += actualHeal;
                            spawnFloatingText(master.x, master.y - 42, `+${actualHeal} (吸収)`, "#d8b4fe");
                            spawnParticles(master.x, master.y, "#c084fc", 18, 160);
                            if (master.isPlayer) {
                                sound.playGem();
                                showToast(`${ent.name} から体力を半分(${tribute})回収した！`);
                            }
                        }

                        ent.isPuppet = false;
                        ent.team = ent.originalTeam;
                        ent.puppetTimer = 0;
                        ent.puppetMasterId = null;
                        ent.puppetAttackCd = 0;
                        continue;
                    }

                    ent.puppetSpin += dt * 11;
                    ent.facingAngle = ent.puppetSpin;
                    if (ent.puppetAttackCd > 0) ent.puppetAttackCd -= dt;

                    let nearestTarget = null;
                    let minDist = Infinity;
                    for (const other of gameState.entities) {
                        if (other.dead || other.team === ent.team) continue;
                        const d = Math.hypot(other.x - ent.x, other.y - ent.y);
                        if (d < minDist) {
                            minDist = d;
                            nearestTarget = other;
                        }
                    }

                    if (nearestTarget && !isGoalPause) {
                        const a = Math.atan2(nearestTarget.y - ent.y, nearestTarget.x - ent.x);
                        const chaseSpd = Math.max(ent.speed, 130);
                        ent.vx = Math.cos(a) * chaseSpd;
                        ent.vy = Math.sin(a) * chaseSpd;

                        if (minDist <= ent.radius + nearestTarget.radius + 16 && ent.puppetAttackCd <= 0) {
                            ent.puppetAttackCd = 0.45;
                            applyDamage(ent, nearestTarget, 420);
                            spawnParticles(nearestTarget.x, nearestTarget.y, "#dc2626", 8, 120);
                        }
                    } else {
                        ent.vx = 0;
                        ent.vy = 0;
                    }

                    ent.x += ent.vx * dt;
                    ent.y += ent.vy * dt;
                    ent.walkAnim += dt * 12;
                    resolveMapCollision(ent);
                    continue;
                }

                // 攻撃クールダウン＆リロード＆自然回復
                if (ent.attackCooldown > 0) ent.attackCooldown = Math.max(0, ent.attackCooldown - dt);

                // フォーエバー専用：ウルト5秒間タイマー＆リロード4管理
                if (ent.role === "forever" && ent.foreverUltTimer > 0) {
                    ent.foreverUltTimer -= dt;
                    if (ent.foreverUltTimer <= 0) {
                        ent.foreverUltTimer = 0;
                        ent.maxAmmo = 1.0;
                        ent.ammo = Math.min(1.0, ent.ammo);
                        if (ent.isPlayer) showToast("ホーネット・ラッシュ終了！");
                    }
                }

                if (ent.ammo < ent.maxAmmo) {
                    const activeReloadTime = (ent.role === "forever" && ent.foreverUltTimer > 0) ? 0.6 : ent.reloadTime;
                    ent.ammo = Math.min(ent.maxAmmo, ent.ammo + dt / activeReloadTime);
                }

                ent.outOfCombatTimer += dt;
                if (ent.outOfCombatTimer >= 3.5 && ent.hp < ent.maxHp && ent.role !== "lil") {
                    const regen = Math.min(ent.maxHp - ent.hp, ent.maxHp * 0.1 * dt);
                    ent.hp += regen;
                }

                // サイタル等の時間差バースト射撃キュー処理
                if (ent.burstQueue && ent.burstQueue.length > 0) {
                    for (let bIdx = ent.burstQueue.length - 1; bIdx >= 0; bIdx--) {
                        ent.burstQueue[bIdx].delay -= dt;
                        if (ent.burstQueue[bIdx].delay <= 0) {
                            const shot = ent.burstQueue.splice(bIdx, 1)[0];
                            spawnSaitalShot(ent, shot);
                        }
                    }
                }

                // ダッシュ中処理 (ブレイズ、エリック、ケンタウロスなど)
                if (ent.dashTimer > 0) {
                    ent.dashTimer -= dt;
                    ent.x += Math.cos(ent.dashAngle) * ent.dashSpeed * dt;
                    ent.y += Math.sin(ent.dashAngle) * ent.dashSpeed * dt;

                    // ケンタウロスウルト：フィールド内の壁・草むら・骨箱・松明を破壊しながら突き進む
                    if (ent.dashType === "centaur_ult") {
                        const smashRadius = ent.radius + 16;
                        const minCol = Math.max(1, Math.floor((ent.x - smashRadius) / TILE_SIZE));
                        const maxCol = Math.min(MAP_COLS - 2, Math.floor((ent.x + smashRadius) / TILE_SIZE));
                        const minRow = Math.max(1, Math.floor((ent.y - smashRadius) / TILE_SIZE));
                        const maxRow = Math.min(MAP_ROWS - 2, Math.floor((ent.y + smashRadius) / TILE_SIZE));

                        for (let r = minRow; r <= maxRow; r++) {
                            for (let c = minCol; c <= maxCol; c++) {
                                const tile = gameState.map[r][c];
                                if (tile === 1 || tile === 2 || tile === 3 || tile === 5) {
                                    const tx = (c + 0.5) * TILE_SIZE;
                                    const ty = (r + 0.5) * TILE_SIZE;
                                    gameState.map[r][c] = 0;
                                    if (tile === 2) {
                                        spawnParticles(tx, ty, "#10b981", 10, 140);
                                    } else if (tile === 3) {
                                        spawnParticles(tx, ty, "#e2e8f0", 14, 180);
                                        spawnGem(tx, ty, true);
                                    } else {
                                        spawnParticles(tx, ty, "#94a3b8", 12, 180);
                                        spawnParticles(tx, ty, "#facc15", 6, 150);
                                        if (ent.isPlayer) gameState.camera.shake = Math.max(gameState.camera.shake, 5);
                                    }
                                }
                            }
                        }
                    }

                    resolveMapCollision(ent);

                    // 残像と軌跡
                    if (Math.random() < 0.75) {
                        gameState.afterimages.push({
                            x: ent.x,
                            y: ent.y,
                            facingAngle: ent.dashAngle,
                            life: 0.22,
                            maxLife: 0.22,
                            type: ent.dashType
                        });
                        const pColor = ent.dashType === "blaze_ult"
                            ? "#fb923c"
                            : ent.dashType === "centaur_ult"
                            ? "#38bdf8"
                            : ent.dashType === "forever_ult"
                            ? "#facc15"
                            : "#94a3b8";
                        spawnParticles(ent.x, ent.y, pColor, 2, 70);
                    }

                    // ダッシュ軌道上の敵へダメージ
                    const hitReach = ent.dashType === "centaur_ult" ? 46 : 14;
                    for (const target of gameState.entities) {
                        if (target.dead || target.team === ent.team) continue;
                        if (ent.dashHitIds.has(target.id)) continue;
                        if (Math.hypot(target.x - ent.x, target.y - ent.y) < ent.radius + target.radius + hitReach) {
                            ent.dashHitIds.add(target.id);
                            
                            if (ent.dashType === "blaze_ult") {
                                applyDamage(ent, target, 1280);
                                target.x += Math.cos(ent.dashAngle) * 42;
                                target.y += Math.sin(ent.dashAngle) * 42;
                                resolveMapCollision(target);
                            } else if (ent.dashType === "eric_attack") {
                                applyDamage(ent, target, 840);
                                ent.ultCharge = Math.min(100, ent.ultCharge + 15);
                                if (ent.isPlayer && ent.ultCharge >= 100) {
                                    sound.playUltReady();
                                    showToast("ウルトチャージ完了！");
                                }
                            } else if (ent.dashType === "eric_ult") {
                                applyDamage(ent, target, 1340);
                                const healAmount = 1000;
                                const actualHeal = Math.min(healAmount, ent.maxHp - ent.hp);
                                ent.hp += actualHeal;
                                ent.stats.healAmount += actualHeal;
                                spawnFloatingText(ent.x, ent.y - 38, `+${actualHeal}`, "#4ade80");
                                spawnParticles(target.x, target.y, "#be123c", 8, 150);
                            } else if (ent.dashType === "centaur_ult") {
                                // ケンタウロスウルト：火力700＆範囲外へノックバック＆ボール強制ドロップ
                                applyDamage(ent, target, 700);
                                // 突撃ラインの外側へ大きく弾き飛ばす
                                const dx = target.x - ent.x;
                                const dy = target.y - ent.y;
                                const cross = Math.cos(ent.dashAngle) * dy - Math.sin(ent.dashAngle) * dx;
                                const sideDir = cross >= 0 ? 1 : -1;
                                const knockAngle = ent.dashAngle + sideDir * (Math.PI * 0.42);
                                const knockDist = 155;
                                target.x += Math.cos(knockAngle) * knockDist;
                                target.y += Math.sin(knockAngle) * knockDist;
                                resolveMapCollision(target);
                                spawnParticles(target.x, target.y, "#facc15", 14, 200);

                                // ボールを所持していれば強制ドロップ
                                if (gameState.soccer.active && gameState.soccer.ball.holderId === target.id) {
                                    gameState.soccer.ball.holderId = null;
                                    gameState.soccer.ball.vx = Math.cos(knockAngle) * 320;
                                    gameState.soccer.ball.vy = Math.sin(knockAngle) * 320;
                                    gameState.soccer.ball.pickupCooldown = 0.65;
                                    showToast(`${target.name} が突撃で吹き飛ばされボールを落とした！`);
                                }
                            }
                        }
                    }
                    continue;
                }

                // ケンタウロス：5秒間斧チャージタイマー更新（プレイヤー用）
                if (ent.role === "centaur" && ent.isPlayer) {
                    const isChargingStick = input.attackStick.active && !input.attackStick.isCanceled;
                    const isChargingMouse = input.mouseCharge.active;
                    const holdingBall = gameState.soccer.active && gameState.soccer.ball.holderId === ent.id;
                    if ((isChargingStick || isChargingMouse) && !holdingBall && ent.ammo >= 1.0 && ent.attackCooldown <= 0) {
                        ent.axeChargeTimer = Math.min(5.0, ent.axeChargeTimer + dt);
                    } else {
                        ent.axeChargeTimer = 0;
                    }
                }

                // 通常移動入力（プレイヤー or AI）
                if (isGoalPause) {
                    ent.vx = 0;
                    ent.vy = 0;
                } else if (ent.isPlayer) {
                    let moveX = 0;
                    let moveY = 0;

                    if (input.keys["KeyW"] || input.keys["ArrowUp"]) moveY -= 1;
                    if (input.keys["KeyS"] || input.keys["ArrowDown"]) moveY += 1;
                    if (input.keys["KeyA"] || input.keys["ArrowLeft"]) moveX -= 1;
                    if (input.keys["KeyD"] || input.keys["ArrowRight"]) moveX += 1;

                    if (input.moveStick.active) {
                        moveX = input.moveStick.dx;
                        moveY = input.moveStick.dy;
                    } else if (moveX !== 0 || moveY !== 0) {
                        const len = Math.hypot(moveX, moveY);
                        moveX /= len;
                        moveY /= len;
                    }

                    ent.vx = moveX * ent.speed;
                    ent.vy = moveY * ent.speed;

                    if (input.mouse.active && !input.attackStick.active && !input.ultStick.active) {
                        const worldMouseX = input.mouse.x - viewWidth / 2 + gameState.camera.x;
                        const worldMouseY = input.mouse.y - viewHeight / 2 + gameState.camera.y;
                        ent.facingAngle = Math.atan2(worldMouseY - ent.y, worldMouseX - ent.x);
                    } else if (Math.hypot(ent.vx, ent.vy) > 10) {
                        ent.facingAngle = Math.atan2(ent.vy, ent.vx);
                    }
                } else {
                    updateAiController(ent, dt);
                }

                // フォーエバー専用パッシブ：目の先の細い範囲にHP半分以下の敵がいる場合のみ足の速さが2倍＆通常攻撃が壁貫通
                if (ent.role === "forever" && !isGoalPause) {
                    const huntRange = 480;
                    const huntHalfAngle = (Math.PI * 10) / 180;
                    let lowHpDetected = false;

                    for (const target of gameState.entities) {
                        if (target.dead || target.team === ent.team) continue;
                        if (target.hp > target.maxHp * 0.5) continue;
                        const dist = Math.hypot(target.x - ent.x, target.y - ent.y);
                        if (dist <= huntRange + target.radius) {
                            const angleTo = Math.atan2(target.y - ent.y, target.x - ent.x);
                            let diff = Math.abs(angleTo - ent.facingAngle);
                            if (diff > Math.PI) diff = Math.PI * 2 - diff;
                            if (diff <= huntHalfAngle) {
                                lowHpDetected = true;
                                break;
                            }
                        }
                    }

                    ent.foreverHuntActive = lowHpDetected;
                    if (lowHpDetected) {
                        ent.vx *= 2.0;
                        ent.vy *= 2.0;
                        if (Math.hypot(ent.vx, ent.vy) > 10 && Math.random() < 0.4) {
                            spawnParticles(ent.x, ent.y + 6, "#facc15", 1, 55);
                        }
                    }
                }

                // ケンタウロス専用：加速システム（3.5 → 最大12.5）＆体当たり攻撃（350〜1200ダメージ）
                if (ent.role === "centaur" && !isGoalPause) {
                    const inputMag = Math.hypot(ent.vx, ent.vy);
                    if (inputMag > 5) {
                        // 走り続けると徐々に加速（従来の半分の速度：dt * 1.0）
                        ent.centaurSpeedScale = Math.min(12.5, ent.centaurSpeedScale + dt * 1.0);
                        const dynamicSpeed = (ent.centaurSpeedScale / 3.5) * ent.speed;
                        ent.vx = (ent.vx / inputMag) * dynamicSpeed;
                        ent.vy = (ent.vy / inputMag) * dynamicSpeed;

                        if (ent.centaurSpeedScale >= 9.0 && Math.random() < 0.45) {
                            spawnParticles(ent.x, ent.y + 8, "#38bdf8", 1, 50);
                        }

                        // 走ることでも徐々にウルトが溜まる（現在の速度が高いほど増加量がアップ）
                        const runSpeedRatio = Math.max(0, Math.min(1, (ent.centaurSpeedScale - 3.5) / (12.5 - 3.5)));
                        const runUltGain = (0.8 + runSpeedRatio * 5.2) * dt;
                        const prevRunUlt = ent.ultCharge;
                        ent.ultCharge = Math.min(ent.maxUltCharge, ent.ultCharge + runUltGain);
                        if (ent.isPlayer && prevRunUlt < 100 && ent.ultCharge >= 100) {
                            sound.playUltReady();
                            showToast("ウルトチャージ完了！15m疾風突撃 発動可能！");
                        }
                    } else {
                        // 立ち止まると初期速度(3.5)へ戻る
                        ent.centaurSpeedScale = Math.max(3.5, ent.centaurSpeedScale - dt * 6.0);
                    }

                    // 体当たりクールダウン減算
                    for (const tid in ent.ramHitCooldowns) {
                        ent.ramHitCooldowns[tid] -= dt;
                        if (ent.ramHitCooldowns[tid] <= 0) delete ent.ramHitCooldowns[tid];
                    }

                    // 移動中の敵への体当たり判定（最低350〜最大1200ダメージ / 速度12超えでノックバック＆ボールドロップ）
                    if (inputMag > 5) {
                        const speedRatio = Math.max(0, Math.min(1, (ent.centaurSpeedScale - 3.5) / (12.5 - 3.5)));
                        const ramDamage = Math.round(350 + 850 * speedRatio);
                        const isOver12 = ent.centaurSpeedScale > 12.0;
                        for (const target of gameState.entities) {
                            if (target.dead || target.team === ent.team) continue;
                            if (ent.ramHitCooldowns[target.id]) continue;
                            if (Math.hypot(target.x - ent.x, target.y - ent.y) < ent.radius + target.radius + 6) {
                                ent.ramHitCooldowns[target.id] = 0.65;
                                applyDamage(ent, target, ramDamage);
                                const pushA = Math.atan2(target.y - ent.y, target.x - ent.x);
                                const knockDist = isOver12 ? 125 : (16 + speedRatio * 24);
                                target.x += Math.cos(pushA) * knockDist;
                                target.y += Math.sin(pushA) * knockDist;
                                resolveMapCollision(target);
                                spawnParticles(target.x, target.y, isOver12 ? "#facc15" : "#38bdf8", isOver12 ? 16 : 10, isOver12 ? 210 : 160);

                                if (isOver12 && gameState.soccer.active && gameState.soccer.ball.holderId === target.id) {
                                    gameState.soccer.ball.holderId = null;
                                    gameState.soccer.ball.vx = Math.cos(pushA) * 320;
                                    gameState.soccer.ball.vy = Math.sin(pushA) * 320;
                                    gameState.soccer.ball.pickupCooldown = 0.65;
                                    showToast(`${target.name} を超高速体当たりで吹き飛ばしボールを落とした！`);
                                }

                                const prevUlt = ent.ultCharge;
                                ent.ultCharge = Math.min(ent.maxUltCharge, ent.ultCharge + 8);
                                if (ent.isPlayer && prevUlt < 100 && ent.ultCharge >= 100) {
                                    sound.playUltReady();
                                    showToast("ウルトチャージ完了！15m疾風突撃 発動可能！");
                                }
                            }
                        }
                    }
                }

                // スローダウン処理
                if (ent.slowTimer > 0) {
                    ent.slowTimer = Math.max(0, ent.slowTimer - dt);
                    ent.vx *= 0.5;
                    ent.vy *= 0.5;
                }

                // 氷のスリップ（慣性）処理
                if (ent.slipTimer > 0) {
                    ent.slipTimer = Math.max(0, ent.slipTimer - dt);
                    ent.slipVx = (ent.slipVx !== undefined) ? ent.slipVx : ent.vx;
                    ent.slipVy = (ent.slipVy !== undefined) ? ent.slipVy : ent.vy;
                    
                    ent.slipVx += (ent.vx - ent.slipVx) * dt * 1.5;
                    ent.slipVy += (ent.vy - ent.slipVy) * dt * 1.5;
                    
                    ent.vx = ent.slipVx;
                    ent.vy = ent.slipVy;
                    
                    // ボール所持中に滑ると落とす
                    if (gameState.soccer.active && gameState.soccer.ball.holderId === ent.id) {
                        gameState.soccer.ball.holderId = null;
                        gameState.soccer.ball.vx = (Math.random() - 0.5) * 300;
                        gameState.soccer.ball.vy = (Math.random() - 0.5) * 300;
                        gameState.soccer.ball.pickupCooldown = 0.6;
                        showToast(`${ent.name} が氷で滑ってボールを手放した！`);
                    }
                } else {
                    ent.slipVx = ent.vx;
                    ent.slipVy = ent.vy;
                }

                ent.x += ent.vx * dt;
                ent.y += ent.vy * dt;
                if (Math.hypot(ent.vx, ent.vy) > 12 && !isGoalPause) {
                    ent.walkAnim += dt * 11;
                }
                const hitWall = resolveMapCollision(ent);

                // ケンタウロス：壁につっかえたりぶつかると減速する
                if (ent.role === "centaur" && hitWall && !isGoalPause) {
                    ent.centaurSpeedScale = Math.max(3.5, ent.centaurSpeedScale - dt * 7.5);
                }

                // 草むら（ダークブッシュ）潜伏判定
                const footCol = Math.floor(ent.x / TILE_SIZE);
                const footRow = Math.floor(ent.y / TILE_SIZE);
                ent.inBush = (
                    footRow >= 0 && footRow < MAP_ROWS &&
                    footCol >= 0 && footCol < MAP_COLS &&
                    gameState.map[footRow][footCol] === 2
                );

                // リルの自動攻撃処理（毎秒620ダメージ ＋ 1ヒットごとに親のウルト6%回復）
                if (ent.role === "lil" && !isGoalPause) {
                    ent.lilTickTimer -= dt;
                    if (ent.lilTickTimer <= 0) {
                        ent.lilTickTimer = 1.0;
                        const dmgRadius = 120;
                        let hitEnemy = false;
                        for (const target of gameState.entities) {
                            if (target.dead || target.team === ent.team) continue;
                            const dist = Math.hypot(target.x - ent.x, target.y - ent.y);
                            if (dist < target.radius + dmgRadius) {
                                applyDamage(ent, target, ent.damage);
                                spawnParticles(target.x, target.y, "#d946ef", 5, 80);
                                hitEnemy = true;
                            }
                        }
                        if (hitEnemy) {
                            spawnParticles(ent.x, ent.y, "#fbcfe8", 8, 100);
                            const owner = gameState.entities.find(e => e.id === ent.ownerId);
                            if (owner && !owner.dead) {
                                const prevUlt = owner.ultCharge;
                                owner.ultCharge = Math.min(owner.maxUltCharge, owner.ultCharge + 6);
                                if (owner.isPlayer && Math.floor(prevUlt/100) < Math.floor(owner.ultCharge/100)) {
                                    sound.playUltReady();
                                }
                            }
                        }
                    }
                }
            }

            // カメラ追従（プレイヤー中心、ゴール時はボール中心、ノックアウト死亡時は生存中の味方を観戦）
            if (gameState.soccer.active && gameState.soccer.goalResetTimer > 0) {
                const ball = gameState.soccer.ball;
                const targetCamX = Math.max(viewWidth * 0.42, Math.min(MAP_WIDTH - viewWidth * 0.42, ball.x));
                const targetCamY = Math.max(viewHeight * 0.42, Math.min(MAP_HEIGHT - viewHeight * 0.42, ball.y));
                gameState.camera.x += (targetCamX - gameState.camera.x) * Math.min(1, dt * 6);
                gameState.camera.y += (targetCamY - gameState.camera.y) * Math.min(1, dt * 6);
            } else {
                let focusEnt = getPlayer();
                if (gameState.knockout.active && focusEnt && focusEnt.dead) {
                    focusEnt =
                        gameState.entities.find((e) => !e.dead && e.role !== "lil" && e.team === "blue") ||
                        gameState.entities.find((e) => !e.dead && e.role !== "lil") ||
                        focusEnt;
                }
                if (focusEnt) {
                    const targetCamX = Math.max(viewWidth * 0.42, Math.min(MAP_WIDTH - viewWidth * 0.42, focusEnt.x));
                    const targetCamY = Math.max(viewHeight * 0.42, Math.min(MAP_HEIGHT - viewHeight * 0.42, focusEnt.y));
                    gameState.camera.x += (targetCamX - gameState.camera.x) * Math.min(1, dt * 8);
                    gameState.camera.y += (targetCamY - gameState.camera.y) * Math.min(1, dt * 8);
                }
            }

            // 弾丸（プロジェクタイル）更新
            for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
                const p = gameState.projectiles[i];
                p.life -= dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;

                if (p.type === "blaze_orb" && Math.random() < 0.65) {
                    spawnParticles(p.x, p.y, "#f97316", 1, 35);
                } else if (p.type === "pom_flask") {
                    const progress = 1 - (p.life / p.maxLife);
                    p.x = p.startX + (p.targetX - p.startX) * progress;
                    p.y = p.startY + (p.targetY - p.startY) * progress;

                    if (p.life <= 0) {
                        // 着弾爆発
                        spawnParticles(p.x, p.y, "#d946ef", 16, 150);
                        gameState.shockwaves.push({
                            x: p.x, y: p.y, maxRadius: p.radius, color: "#d946ef", life: 0.2, maxLife: 0.2
                        });
                        for (const target of gameState.entities) {
                            if (target.dead || target.team === p.team) continue;
                            const dist = Math.hypot(target.x - p.x, target.y - p.y);
                            if (dist < target.radius + p.radius) {
                                const attacker = gameState.entities.find((e) => e.id === p.ownerId);
                                applyDamage(attacker, target, p.damage);
                                if (attacker && !attacker.dead && p.ultGain > 0) {
                                    const prevUlt = attacker.ultCharge;
                                    attacker.ultCharge = Math.min(attacker.maxUltCharge, attacker.ultCharge + p.ultGain);
                                    if (attacker.isPlayer && Math.floor(prevUlt/100) < Math.floor(attacker.ultCharge/100)) {
                                        sound.playUltReady();
                                        showToast("ウルトチャージ完了！");
                                    }
                                }
                            }
                        }
                        gameState.projectiles.splice(i, 1);
                        continue;
                    }
                    continue; // 飛行中は当たり判定なし
                } else if (p.type === "viper_snipe") {
                    spawnParticles(p.x, p.y, "#f472b6", 1, 25);
                } else if (p.type === "viper_pierce_ult") {
                    spawnParticles(p.x, p.y, "#f472b6", 2, 60);
                    spawnParticles(p.x, p.y, "#fde047", 1, 50);
                } else if (p.type === "titan_orb" && Math.random() < 0.45) {
                    spawnParticles(p.x, p.y, "#a855f7", 1, 30);
                } else if (p.type === "saital_center") {
                    spawnParticles(p.x, p.y, "#34d399", 1, 35);
                } else if (p.type === "saital_outer" && Math.random() < 0.5) {
                    spawnParticles(p.x, p.y, "#a7f3d0", 1, 25);
                } else if (p.type === "forever_sting") {
                    if (Math.random() < 0.55) spawnParticles(p.x, p.y, "#fde047", 1, 30);
                } else if (p.type === "forever_super_sting") {
                    spawnParticles(p.x, p.y, "#facc15", 2, 55);
                } else if (p.type === "rearn_homing") {
                    // レアーンの弧を描きながら敵をホーミングする壁貫通弾
                    const elapsedRatio = 1 - (p.life / p.maxLife);
                    let curAngle = Math.atan2(p.vy, p.vx);

                    // 近くの敵を探索してホーミング追尾
                    let targetEnemy = null;
                    let bestDist = 340;
                    for (const cand of gameState.entities) {
                        if (cand.dead || cand.team === p.team) continue;
                        const d = Math.hypot(cand.x - p.x, cand.y - p.y);
                        if (cand.inBush && cand.revealedTimer <= 0 && d > 165) continue;
                        if (d < bestDist) {
                            bestDist = d;
                            targetEnemy = cand;
                        }
                    }

                    let desiredAngle = p.baseAngle - p.curveSide * Math.max(0, (0.45 - elapsedRatio) * 0.9);
                    if (targetEnemy && elapsedRatio > 0.14) {
                        desiredAngle = Math.atan2(targetEnemy.y - p.y, targetEnemy.x - p.x);
                    } else if (elapsedRatio > 0.2) {
                        // 敵がいなくても左右から正面へ綺麗に弧を描いて収束
                        desiredAngle = p.baseAngle - p.curveSide * 0.25;
                    }

                    let diff = desiredAngle - curAngle;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    const turnRate = targetEnemy ? 5.6 : 3.2;
                    curAngle += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));

                    p.vx = Math.cos(curAngle) * p.speed;
                    p.vy = Math.sin(curAngle) * p.speed;

                    if (Math.random() < 0.55) {
                        spawnParticles(p.x, p.y, "#f43f5e", 1, 28);
                    }
                }

                if (p.life <= 0) {
                    gameState.projectiles.splice(i, 1);
                    continue;
                }

                // マップ壁・骨箱との衝突チェック
                const col = Math.floor(p.x / TILE_SIZE);
                const row = Math.floor(p.y / TILE_SIZE);
                if (row >= 0 && row < MAP_ROWS && col >= 0 && col < MAP_COLS) {
                    const tile = gameState.map[row][col];
                    if (tile === 1 || tile === 5) {
                        if (!p.wallPiercing) {
                            const wallHitColor = p.type.startsWith("viper")
                                ? "#f472b6"
                                : p.type === "titan_orb"
                                ? "#c084fc"
                                : p.type.startsWith("saital")
                                ? "#34d399"
                                : "#fbbf24";
                            spawnParticles(p.x, p.y, wallHitColor, 8, 110);
                            gameState.projectiles.splice(i, 1);
                            continue;
                        }
                    } else if (tile === 3) {
                        gameState.map[row][col] = 0;
                        const boxX = (col + 0.5) * TILE_SIZE;
                        const boxY = (row + 0.5) * TILE_SIZE;
                        spawnParticles(boxX, boxY, "#e2e8f0", 16, 180);
                        spawnGem(boxX, boxY, true);
                        if (!p.piercing) {
                            gameState.projectiles.splice(i, 1);
                            continue;
                        }
                    }
                }

                // キャラクターとの命中チェック（敵へのダメージ ＋ サポーター弾による味方回復）
                let hitSomething = false;
                for (const target of gameState.entities) {
                    if (target.dead) continue;
                    if (target.id === p.ownerId) continue;
                    if (p.hitEntityIds && p.hitEntityIds.has(target.id)) continue;

                    const dist = Math.hypot(target.x - p.x, target.y - p.y);
                    if (dist < target.radius + p.radius) {
                        if (target.team === p.team) {
                            // 同じチーム（味方）に当たった場合：回復効果を持つ弾なら味方を回復！
                            if (p.healAmount && p.healAmount > 0) {
                                if (p.hitEntityIds) p.hitEntityIds.add(target.id);
                                const actualHeal = Math.min(p.healAmount, target.maxHp - target.hp);
                                target.hp += actualHeal;
                                const healer = gameState.entities.find((e) => e.id === p.ownerId);
                                if (healer) healer.stats.healAmount += actualHeal;
                                spawnParticles(target.x, target.y, "#34d399", 8, 120);
                                spawnFloatingText(target.x, target.y - 30, `+${actualHeal}`, "#4ade80");

                                if (healer && !healer.dead && p.ultGain > 0) {
                                    const prevUlt = healer.ultCharge;
                                    healer.ultCharge = Math.min(healer.maxUltCharge, healer.ultCharge + p.ultGain);
                                    if (healer.isPlayer && Math.floor(prevUlt/100) < Math.floor(healer.ultCharge/100)) {
                                        sound.playUltReady();
                                        showToast("ウルトチャージ完了！発動可能！");
                                    }
                                }
                            }
                            continue;
                        }

                        // 敵キャラクターへの命中
                        if (p.hitEntityIds) p.hitEntityIds.add(target.id);
                        const attacker = gameState.entities.find((e) => e.id === p.ownerId);
                        applyDamage(attacker, target, p.damage);

                        // フォーエバー：400ダメージの弾を当てると、次の1発が1500ダメージに強化される！
                        if (p.type === "forever_sting" && attacker && !attacker.dead) {
                            attacker.foreverChargedShot = true;
                            spawnFloatingText(attacker.x, attacker.y - 44, "次弾 1500 DMG!", "#facc15");
                            spawnParticles(attacker.x, attacker.y - 16, "#facc15", 10, 120);
                        }

                        if (attacker && !attacker.dead && p.ultGain > 0) {
                            const prevUlt = attacker.ultCharge;
                            attacker.ultCharge = Math.min(attacker.maxUltCharge, attacker.ultCharge + p.ultGain);
                            if (attacker.isPlayer && Math.floor(prevUlt/100) < Math.floor(attacker.ultCharge/100)) {
                                sound.playUltReady();
                                showToast("ウルトチャージ完了！発動可能！");
                            }
                        }

                        if (p.piercing) {
                            const pierceColor = p.type.startsWith("saital") ? "#34d399" : "#f472b6";
                            spawnParticles(target.x, target.y, pierceColor, 10, 160);
                        } else {
                            hitSomething = true;
                            break;
                        }
                    }
                }

                if (hitSomething) {
                    gameState.projectiles.splice(i, 1);
                }
            }

            // 滞留エリア（ゾーン）更新
            for (let i = gameState.zones.length - 1; i >= 0; i--) {
                const z = gameState.zones[i];
                z.life -= dt;
                z.tickTimer -= dt;

                // フロスト通常攻撃：持ち主の座標にのみ追従させ、向き（angle）は固定する
                if (z.type === "frost_attack") {
                    const owner = gameState.entities.find(e => e.id === z.ownerId);
                    if (owner && !owner.dead) {
                        z.x = owner.x;
                        z.y = owner.y;
                    }
                }

                // 視覚的なパーティクル発生
                if (z.type === "frost_attack" && Math.random() < 0.4) {
                    const r = Math.random() * z.radius;
                    const a = z.angle + (Math.random() - 0.5) * z.spread;
                    // 壁貫通なし：壁越しにはエフェクトを出さない
                    if (checkLineOfSight(z.x, z.y, z.x + Math.cos(a)*r, z.y + Math.sin(a)*r)) {
                        spawnParticles(z.x + Math.cos(a)*r, z.y + Math.sin(a)*r, "#67e8f9", 1, 40);
                    }
                } else if (z.type === "frost_ult" && Math.random() < 0.6) {
                    const a = Math.random() * Math.PI * 2;
                    const r = Math.random() * z.radius;
                    spawnParticles(z.x + Math.cos(a)*r, z.y + Math.sin(a)*r, "#a5f3fc", 1, 30);
                }

                if (z.tickTimer <= 0) {
                    z.tickTimer = 0.5; // 0.5秒ごとにダメージと効果を適用
                    const dmg = z.damagePerSec * 0.5;
                    for (const target of gameState.entities) {
                        if (target.dead || target.team === z.team) continue;
                        
                        let hit = false;
                        const dist = Math.hypot(target.x - z.x, target.y - z.y);
                        
                        if (z.type === "frost_attack") {
                            if (dist <= z.radius + target.radius) {
                                let angleTo = Math.atan2(target.y - z.y, target.x - z.x);
                                let diff = Math.abs(angleTo - z.angle);
                                if (diff > Math.PI) diff = Math.PI * 2 - diff;
                                if (diff <= z.spread / 2) {
                                    // 壁貫通なし：間に障害物があるかチェック
                                    if (checkLineOfSight(z.x, z.y, target.x, target.y)) {
                                        hit = true;
                                    }
                                }
                            }
                        } else if (z.type === "frost_ult") {
                            if (dist <= z.radius + target.radius) hit = true;
                        }

                        if (hit) {
                            const owner = gameState.entities.find(e => e.id === z.ownerId);
                            applyDamage(owner, target, dmg);
                            if (z.type === "frost_attack") {
                                target.slowTimer = 1.5;
                            } else if (z.type === "frost_ult") {
                                target.slipTimer = 0.6;
                            }
                            if (owner && owner.isPlayer && owner.ultCharge < 100) {
                                const prevUlt = owner.ultCharge;
                                owner.ultCharge = Math.min(owner.maxUltCharge, owner.ultCharge + 3);
                                if (Math.floor(prevUlt/100) < Math.floor(owner.ultCharge/100)) sound.playUltReady();
                            }
                        }
                    }
                }

                if (z.life <= 0) {
                    gameState.zones.splice(i, 1);
                }
            }

            // ジェム更新＆回収判定
            for (let i = gameState.gems.length - 1; i >= 0; i--) {
                const g = gameState.gems[i];
                g.bobPhase += dt * 4.5;
                if (g.pickupDelay > 0) g.pickupDelay = Math.max(0, g.pickupDelay - dt);

                g.x += g.vx * dt;
                g.y += g.vy * dt;
                g.vx *= Math.pow(0.04, dt);
                g.vy *= Math.pow(0.04, dt);
                g.x = Math.max(TILE_SIZE * 1.2, Math.min(MAP_WIDTH - TILE_SIZE * 1.2, g.x));
                g.y = Math.max(TILE_SIZE * 1.2, Math.min(MAP_HEIGHT - TILE_SIZE * 1.2, g.y));

                if (g.pickupDelay <= 0) {
                    for (const ent of gameState.entities) {
                        if (ent.dead || ent.role === "lil") continue;
                        if (Math.hypot(ent.x - g.x, ent.y - g.y) < ent.radius + 18) {
                            ent.gems += 1;
                            recalculateTeamGems();
                            spawnParticles(g.x, g.y, "#22d3ee", 8, 110);
                            if (ent.isPlayer) {
                                sound.playGem();
                                showToast("ダイヤモンド獲得！");
                            }
                            gameState.gems.splice(i, 1);
                            break;
                        }
                    }
                }
            }

            // パーティクル・衝撃波・ダメージ表記・残像の更新
            for (let i = gameState.particles.length - 1; i >= 0; i--) {
                const pt = gameState.particles[i];
                pt.life -= dt;
                pt.x += pt.vx * dt;
                pt.y += pt.vy * dt;
                pt.vx *= Math.pow(0.15, dt);
                pt.vy *= Math.pow(0.15, dt);
                if (pt.life <= 0) gameState.particles.splice(i, 1);
            }

            for (let i = gameState.shockwaves.length - 1; i >= 0; i--) {
                const sw = gameState.shockwaves[i];
                sw.life -= dt;
                if (sw.life <= 0) gameState.shockwaves.splice(i, 1);
            }

            for (let i = gameState.floatingTexts.length - 1; i >= 0; i--) {
                const ft = gameState.floatingTexts[i];
                ft.life -= dt;
                ft.y -= 32 * dt;
                if (ft.life <= 0) gameState.floatingTexts.splice(i, 1);
            }

            for (let i = gameState.afterimages.length - 1; i >= 0; i--) {
                const aiImg = gameState.afterimages[i];
                aiImg.life -= dt;
                if (aiImg.life <= 0) gameState.afterimages.splice(i, 1);
            }

            // サッカーモード更新 or 危険地帯モード更新 or ノックアウトモード更新 or ダイヤモンドハント勝利条件更新
            if (gameState.soccer.active) {
                updateSoccerMode(dt);
                const banner = document.getElementById("countdownBanner");
                if (gameState.soccer.suddenDeath) {
                    banner.classList.remove("hidden");
                    banner.className = "mt-2 px-4 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                    banner.textContent = "SUDDEN DEATH! 壁全消滅・次の1点で勝利！";
                } else {
                    banner.classList.add("hidden");
                }
                return;
            }

            if (gameState.knockout.active) {
                updateKnockoutMode(dt);
                return;
            }

            if (gameState.dangerZone.active) {
                const dz = gameState.dangerZone;
                let blueIn = false;
                let redIn = false;

                for (const ent of gameState.entities) {
                    if (ent.dead || ent.role === "lil") continue;
                    if (Math.hypot(ent.x - dz.x, ent.y - dz.y) <= dz.radius + ent.radius * 0.5) {
                        if (ent.team === "blue") blueIn = true;
                        else if (ent.team === "red") redIn = true;
                    }
                }

                dz.bluePresent = blueIn;
                dz.redPresent = redIn;
                dz.contested = blueIn && redIn;

                // 1人で踏んでもみんなで踏んでも一定のスピード（約50秒で100%）で進行（両方踏んでいるときはどちらも増える）
                const captureRate = 2.0;
                if (blueIn) {
                    dz.blueProgress = Math.min(100, dz.blueProgress + captureRate * dt);
                }
                if (redIn) {
                    dz.redProgress = Math.min(100, dz.redProgress + captureRate * dt);
                }

                const bluePct = Math.floor(dz.blueProgress);
                const redPct = Math.floor(dz.redProgress);
                document.getElementById("blueGemCount").textContent = `${bluePct}%`;
                document.getElementById("redGemCount").textContent = `${redPct}%`;

                const banner = document.getElementById("countdownBanner");
                if (dz.contested) {
                    banner.classList.remove("hidden");
                    banner.className = "mt-2 px-4 py-1 rounded-full bg-amber-400 text-slate-950 font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                    banner.textContent = `⚠️ 両チーム同時制圧中！ BLUE ${bluePct}% / RED ${redPct}%`;
                } else if (blueIn) {
                    banner.classList.remove("hidden");
                    banner.className = "mt-2 px-4 py-1 rounded-full bg-sky-400 text-slate-950 font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                    banner.textContent = `BLUE 制圧中... ${bluePct}%`;
                } else if (redIn) {
                    banner.classList.remove("hidden");
                    banner.className = "mt-2 px-4 py-1 rounded-full bg-rose-500 text-white font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                    banner.textContent = `RED 制圧中... ${redPct}%`;
                } else {
                    banner.classList.add("hidden");
                }

                if (dz.blueProgress >= 100) {
                    finishMatch(true);
                } else if (dz.redProgress >= 100) {
                    finishMatch(false);
                }
                return;
            }

            // スコアHUD更新 ＆ 10ジェムカウントダウン勝利条件
            document.getElementById("blueGemCount").textContent = gameState.blueGems;
            document.getElementById("redGemCount").textContent = gameState.redGems;

            const banner = document.getElementById("countdownBanner");
            let leadingTeam = null;
            if (gameState.blueGems >= 10 && gameState.blueGems > gameState.redGems) {
                leadingTeam = "blue";
            } else if (gameState.redGems >= 10 && gameState.redGems > gameState.blueGems) {
                leadingTeam = "red";
            }

            if (leadingTeam) {
                if (gameState.countdownTeam !== leadingTeam) {
                    gameState.countdownTeam = leadingTeam;
                    gameState.countdownTimer = 15.0;
                }
                gameState.countdownTimer -= dt;
                banner.classList.remove("hidden");
                banner.className = leadingTeam === "blue"
                    ? "mt-2 px-4 py-1 rounded-full bg-sky-400 text-slate-950 font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse"
                    : "mt-2 px-4 py-1 rounded-full bg-rose-500 text-white font-black text-xs sm:text-sm tracking-wider shadow-lg animate-pulse";
                document.getElementById("countdownSec").textContent = Math.max(0, Math.ceil(gameState.countdownTimer));

                if (gameState.countdownTimer <= 0) {
                    finishMatch(leadingTeam === "blue");
                }
            } else {
                gameState.countdownTeam = null;
                gameState.countdownTimer = 15.0;
                banner.classList.add("hidden");
            }
        }

        function finishMatch(playerWon) {
            gameState.status = "ended";
            if (typeof updateMyPresence === "function") updateMyPresence("online");
            if (typeof leaveCoopRoom === "function" && coopState.active) leaveCoopRoom(true);
            sound.playEnd(playerWon);

          // ▼ 戦績をFirestoreにクラウド保存（勝利: +8 / 敗北: -4）
            if (typeof saveMatchResult === "function") {
                saveMatchResult(playerWon, playerWon ? 8 : -4);
            }

            document.getElementById("hudLayer").classList.add("hidden");
            document.getElementById("respawnOverlay").classList.add("hidden");
            document.getElementById("resultModal").classList.remove("hidden");

            const titleEl = document.getElementById("resultTitle");
            const subEl = document.getElementById("resultSubtitle");
            const badgeEl = document.getElementById("resultBadge");

            if (playerWon) {
                badgeEl.textContent = "VICTORY";
                badgeEl.className = "px-2.5 py-0.5 rounded-lg text-[10px] sm:text-xs font-black tracking-widest bg-amber-400 text-slate-950";
                titleEl.textContent = "VICTORY!";
                titleEl.className = "font-fantasy text-2xl sm:text-4xl font-black text-amber-300 drop-shadow-[0_3px_0_rgba(0,0,0,0.8)]";
                subEl.textContent = gameState.soccer.active
                    ? "キックオフサッカーで勝利を掴み取った！"
                    : gameState.dangerZone.active
                    ? "中央の危険地帯を100%制圧した！"
                    : gameState.knockout.active
                    ? "ノックアウト5本勝負で先に3本先取した！"
                    : "ダイヤモンドを守り抜き、闇のアリーナを制覇！";
            } else {
                badgeEl.textContent = "DEFEAT";
                badgeEl.className = "px-2.5 py-0.5 rounded-lg text-[10px] sm:text-xs font-black tracking-widest bg-rose-500 text-white";
                titleEl.textContent = "DEFEAT...";
                titleEl.className = "font-fantasy text-2xl sm:text-4xl font-black text-rose-300 drop-shadow-[0_3px_0_rgba(0,0,0,0.8)]";
                subEl.textContent = gameState.soccer.active
                    ? "ゴールを奪われてしまった…リベンジしよう！"
                    : gameState.dangerZone.active
                    ? "危険地帯を制圧されてしまった…リベンジしよう！"
                    : gameState.knockout.active
                    ? "相手に3本先取されてしまった…リベンジしよう！"
                    : "ダイヤモンドを奪われてしまった…リベンジしよう！";
            }

            // 6人本体のみを対象にMVP（STAR PLAYER）および最多称号を判定（ペットのリルは除外）
            const mainEntities = gameState.entities.filter((e) => e.role !== "lil");
            let mvp = null;
            let maxScore = -Infinity;
            let mostKillsEnt = null;
            let maxKills = 0;
            let mostHealEnt = null;
            let maxHeal = 0;
            let mostDmgEnt = null;
            let maxDmg = 0;

            mainEntities.forEach((ent) => {
                const score = ent.stats.kills * 100 - ent.stats.deaths * 50 + ent.stats.damageDealt * 0.1 + ent.stats.healAmount * 0.15;
                if (score > maxScore) {
                    maxScore = score;
                    mvp = ent;
                }
                if (ent.stats.kills > maxKills) {
                    maxKills = ent.stats.kills;
                    mostKillsEnt = ent;
                }
                if (ent.stats.healAmount > maxHeal) {
                    maxHeal = ent.stats.healAmount;
                    mostHealEnt = ent;
                }
                if (ent.stats.damageDealt > maxDmg) {
                    maxDmg = ent.stats.damageDealt;
                    mostDmgEnt = ent;
                }
            });

            const blueTeam = mainEntities.filter((e) => e.team === "blue");
            const redTeam = mainEntities.filter((e) => e.team === "red");

            // いいね（Kudos）ボタン用ハンドラ
            window.toggleResultKudos = function (btnEl) {
                const liked = btnEl.dataset.liked === "1";
                if (liked) return;
                btnEl.dataset.liked = "1";
                btnEl.className = "w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-amber-400 text-slate-950 border-2 border-yellow-100 flex items-center justify-center text-xs sm:text-sm font-black shadow-[0_0_12px_rgba(250,204,21,0.85)] scale-110 transition cursor-default";
                btnEl.innerHTML = "👍";
                sound.playGem();
            };

            const buildResultSlotHtml = (ent, isBlue) => {
                const isMvp = mvp && mvp.id === ent.id;
                const cardBg = isBlue
                    ? "bg-[#172554]/95 border-blue-400/70"
                    : "bg-[#450a0a]/95 border-rose-400/70";
                const nameClass = ent.isPlayer
                    ? "text-amber-300"
                    : (isBlue ? "text-emerald-300" : "text-amber-200");

                const dmgDealtVal = Math.round(ent.stats.damageDealt).toLocaleString();
                const healVal = Math.round(ent.stats.healAmount).toLocaleString();
                const dmgTakenVal = Math.round(ent.stats.damageTaken).toLocaleString();

                // カード下部の黄色い称号ラベル
                let awardLabel = "";
                if (mostKillsEnt && mostKillsEnt.id === ent.id && maxKills > 0) {
                    awardLabel = "Most Takedowns";
                } else if (mostHealEnt && mostHealEnt.id === ent.id && maxHeal >= 500) {
                    awardLabel = "Most Healing";
                } else if (mostDmgEnt && mostDmgEnt.id === ent.id && maxDmg > 0) {
                    awardLabel = "Most Damage";
                }

                return `
                    <div class="flex flex-col items-center w-full">
                        <!-- 実物キャラクター描画エリア -->
                        <div class="relative w-full h-28 sm:h-36 flex items-end justify-center overflow-visible">
                            ${isMvp ? `<div class="absolute bottom-1 w-24 h-6 rounded-full bg-yellow-300/45 blur-md pointer-events-none"></div>` : ""}
                            <canvas id="resultCharCanvas_${ent.id}" class="w-full h-full block"></canvas>
                            ${isMvp ? `<div class="absolute bottom-0 px-2 py-0.5 rounded bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-300 text-slate-950 font-black text-[9px] sm:text-[11px] tracking-wider shadow-[0_2px_8px_rgba(250,204,21,0.9)] border border-white whitespace-nowrap">STAR PLAYER</div>` : ""}
                        </div>

                        <!-- ブロスタ風スタッツカード -->
                        <div class="w-full rounded-xl border-2 ${cardBg} p-1.5 sm:p-2.5 shadow-xl relative">
                            <div class="flex items-center justify-between gap-1 mb-1.5">
                                <div class="text-[10px] sm:text-xs font-black ${nameClass} truncate" title="${ent.name}">${ent.name}</div>
                                <button type="button" onclick="toggleResultKudos(this)" data-liked="0" title="いいね！"
                                    class="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-sky-500 hover:bg-sky-400 text-white border-2 border-sky-200 flex items-center justify-center text-[11px] sm:text-xs shadow transition cursor-pointer shrink-0">
                                    👍
                                </button>
                            </div>

                            <!-- キル＆デス -->
                            <div class="flex items-center justify-around text-xs sm:text-sm font-black text-white mb-1.5 pb-1 border-b border-white/15">
                                <span class="flex items-center gap-1" title="キル数"><span class="text-sky-300">🔫</span>${ent.stats.kills}</span>
                                <span class="flex items-center gap-1" title="デス数"><span class="text-slate-200">💀</span>${ent.stats.deaths}</span>
                            </div>

                            <!-- 与ダメージ・回復・被弾の全3項目 -->
                            <div class="space-y-0.5 text-[10px] sm:text-xs font-extrabold">
                                <div class="flex items-center justify-between text-amber-200" title="与ダメージ">
                                    <span>✊ 与ダメ</span>
                                    <span class="text-white">${dmgDealtVal}</span>
                                </div>
                                <div class="flex items-center justify-between text-emerald-300" title="回復量">
                                    <span>💚 回復</span>
                                    <span class="text-white">${healVal}</span>
                                </div>
                                <div class="flex items-center justify-between text-rose-300" title="被弾ダメージ">
                                    <span>🛡️ 被弾</span>
                                    <span class="text-white">${dmgTakenVal}</span>
                                </div>
                            </div>
                        </div>

                        <!-- 最多称号ラベル -->
                        <div class="h-5 mt-1 flex items-center justify-center">
                            ${awardLabel ? `<span class="text-[10px] sm:text-xs font-black text-amber-300 drop-shadow-[0_2px_0_rgba(0,0,0,0.9)] whitespace-nowrap">${awardLabel}</span>` : ""}
                        </div>
                    </div>
                `;
            };

            const blueContainer = document.getElementById("resultBlueLineup");
            const redContainer = document.getElementById("resultRedLineup");
            if (blueContainer) blueContainer.innerHTML = blueTeam.map((e) => buildResultSlotHtml(e, true)).join("");
            if (redContainer) redContainer.innerHTML = redTeam.map((e) => buildResultSlotHtml(e, false)).join("");

            // 各キャラのキャンバスに実物モデルを正面向きで大きく描画
            requestAnimationFrame(() => {
                mainEntities.forEach((ent) => {
                    const rCanvas = document.getElementById(`resultCharCanvas_${ent.id}`);
                    if (!rCanvas) return;
                    const rCtx = rCanvas.getContext("2d");
                    const dpr = Math.min(window.devicePixelRatio || 1, 2);
                    const rect = rCanvas.getBoundingClientRect();
                    const w = Math.max(90, rect.width);
                    const h = Math.max(100, rect.height);
                    rCanvas.width = Math.floor(w * dpr);
                    rCanvas.height = Math.floor(h * dpr);

                    rCtx.save();
                    rCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    rCtx.clearRect(0, 0, w, h);

                    const poseEnt = {
                        ...ent,
                        facingAngle: Math.PI * 0.5,
                        walkAnim: 0,
                        capePhase: 0.6,
                        hurtFlash: 0,
                        axeChargeTimer: 0,
                        axeSwingAnim: 0,
                        isPuppet: false
                    };
                    const isMvp = mvp && mvp.id === ent.id;
                    const scale = isMvp ? 1.95 : 1.72;
                    drawBrawlerModelOnly(rCtx, poseEnt, w / 2, h * 0.84, scale);
                    rCtx.restore();
                });
            });

            if (gameState.soccer.active) {
                document.getElementById("statScoreLabel").textContent = "GOALS:";
                document.getElementById("statGems").textContent = `${gameState.soccer.blueGoals} - ${gameState.soccer.redGoals}`;
            } else if (gameState.dangerZone.active) {
                document.getElementById("statScoreLabel").textContent = "ZONE:";
                document.getElementById("statGems").textContent = `${Math.floor(gameState.dangerZone.blueProgress)}% - ${Math.floor(gameState.dangerZone.redProgress)}%`;
            } else if (gameState.knockout.active) {
                document.getElementById("statScoreLabel").textContent = "ROUNDS:";
                document.getElementById("statGems").textContent = `${gameState.knockout.blueRounds} - ${gameState.knockout.redRounds}`;
            } else {
                document.getElementById("statScoreLabel").textContent = "DIAMONDS:";
                document.getElementById("statGems").textContent = `${gameState.blueGems} - ${gameState.redGems}`;
            }
        }

        // ----------------------------------------------------------------------------
        // 9. 2.5D レンダリングエンジン
        // ----------------------------------------------------------------------------
        function drawArenaFloor() {
            const startCol = Math.max(0, Math.floor((gameState.camera.x - viewWidth / 2) / TILE_SIZE) - 1);
            const endCol = Math.min(MAP_COLS - 1, Math.ceil((gameState.camera.x + viewWidth / 2) / TILE_SIZE) + 1);
            const startRow = Math.max(0, Math.floor((gameState.camera.y - viewHeight / 2) / TILE_SIZE) - 1);
            const endRow = Math.min(MAP_ROWS - 1, Math.ceil((gameState.camera.y + viewHeight / 2) / TILE_SIZE) + 1);

            for (let r = startRow; r <= endRow; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    const x = c * TILE_SIZE;
                    const y = r * TILE_SIZE;
                    const isAlt = (r + c) % 2 === 0;

                    if (gameState.soccer.active) {
                        ctx.fillStyle = isAlt ? "#0b291e" : "#0e3326";
                    } else {
                        ctx.fillStyle = isAlt ? "#12101c" : "#161322";
                    }
                    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

                    ctx.strokeStyle = gameState.soccer.active ? "rgba(16, 185, 129, 0.14)" : "rgba(30, 27, 46, 0.85)";
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

                    // 中央ジェム鉱脈の魔法陣・光る亀裂
                    if (gameState.map[r][c] === 4) {
                        const pulse = 0.65 + Math.sin(gameState.time * 4) * 0.25;
                        ctx.fillStyle = `rgba(6, 182, 212, ${0.18 * pulse})`;
                        ctx.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);

                        ctx.strokeStyle = `rgba(34, 211, 238, ${0.65 * pulse})`;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 16, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                }
            }

            // サッカーコートの白線＆左右ゴールエリア描画
            if (gameState.soccer.active) {
                ctx.save();
                ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
                ctx.lineWidth = 3;
                // センターライン＆センターサークル
                ctx.beginPath();
                ctx.moveTo(MAP_WIDTH / 2, TILE_SIZE);
                ctx.lineTo(MAP_WIDTH / 2, MAP_HEIGHT - TILE_SIZE);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(MAP_WIDTH / 2, MAP_HEIGHT / 2, 95, 0, Math.PI * 2);
                ctx.stroke();

                // 左ゴール（青陣地ゴール）
                const goalTop = 6 * TILE_SIZE;
                const goalH = 6 * TILE_SIZE;
                ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
                ctx.fillRect(0, goalTop, TILE_SIZE * 0.9, goalH);
                ctx.strokeStyle = "#38bdf8";
                ctx.lineWidth = 4;
                ctx.strokeRect(2, goalTop, TILE_SIZE * 0.9, goalH);

                // 右ゴール（赤陣地ゴール）
                ctx.fillStyle = "rgba(244, 63, 94, 0.25)";
                ctx.fillRect(MAP_WIDTH - TILE_SIZE * 0.9, goalTop, TILE_SIZE * 0.9, goalH);
                ctx.strokeStyle = "#f43f5e";
                ctx.strokeRect(MAP_WIDTH - TILE_SIZE * 0.9 - 2, goalTop, TILE_SIZE * 0.9, goalH);
                ctx.restore();
            }

            // 危険地帯モード：中央の大きな制圧サークル描画
            if (gameState.dangerZone.active) {
                const dz = gameState.dangerZone;
                ctx.save();

                // サークル背景塗りつぶし
                let fillCol = "rgba(148, 163, 184, 0.14)";
                let strokeCol = "rgba(226, 232, 240, 0.65)";
                if (dz.contested) {
                    fillCol = "rgba(251, 191, 36, 0.22)";
                    strokeCol = "#facc15";
                } else if (dz.bluePresent) {
                    fillCol = "rgba(56, 189, 248, 0.22)";
                    strokeCol = "#38bdf8";
                } else if (dz.redPresent) {
                    fillCol = "rgba(244, 63, 94, 0.22)";
                    strokeCol = "#f43f5e";
                }

                ctx.fillStyle = fillCol;
                ctx.beginPath();
                ctx.arc(dz.x, dz.y, dz.radius, 0, Math.PI * 2);
                ctx.fill();

                // 外周破線リング
                ctx.strokeStyle = strokeCol;
                ctx.lineWidth = 4;
                ctx.setLineDash([14, 10]);
                ctx.beginPath();
                ctx.arc(dz.x, dz.y, dz.radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                // 青チーム進行度リング（内側）
                if (dz.blueProgress > 0) {
                    ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
                    ctx.lineWidth = 7;
                    ctx.beginPath();
                    ctx.arc(dz.x, dz.y, dz.radius - 10, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (dz.blueProgress / 100)));
                    ctx.stroke();
                }

                // 赤チーム進行度リング（さらに内側）
                if (dz.redProgress > 0) {
                    ctx.strokeStyle = "rgba(244, 63, 94, 0.9)";
                    ctx.lineWidth = 7;
                    ctx.beginPath();
                    ctx.arc(dz.x, dz.y, dz.radius - 20, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * (dz.redProgress / 100)));
                    ctx.stroke();
                }

                // サークル中央の進行度テキスト
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = "900 13px Inter, sans-serif";
                ctx.fillStyle = "rgba(248, 250, 252, 0.75)";
                ctx.fillText("DANGER ZONE", dz.x, dz.y - 18);

                ctx.font = "900 22px Inter, sans-serif";
                ctx.fillStyle = "#38bdf8";
                ctx.fillText(`${Math.floor(dz.blueProgress)}%`, dz.x - 42, dz.y + 8);
                ctx.fillStyle = "#94a3b8";
                ctx.fillText("/", dz.x, dz.y + 8);
                ctx.fillStyle = "#f43f5e";
                ctx.fillText(`${Math.floor(dz.redProgress)}%`, dz.x + 42, dz.y + 8);

                ctx.restore();
            }
        }

        /**
         * キャラクター本体モデル描画（バトル場＆ホーム回転プレビュー共通）
         */
        function drawBrawlerModelOnly(targetCtx, ent, x, y, scale) {
            targetCtx.save();
            targetCtx.translate(x, y);
            targetCtx.scale(scale, scale);

            const bobY = Math.abs(Math.sin(ent.walkAnim)) * -3.5;
            const isFlashing = ent.hurtFlash > 0;
            const sinA = Math.sin(ent.facingAngle);
            const cosA = Math.cos(ent.facingAngle);
            const isFacingBack = sinA < -0.25;

            // 足元影
            targetCtx.fillStyle = "rgba(0, 0, 0, 0.5)";
            targetCtx.beginPath();
            targetCtx.ellipse(0, 8, ent.radius * 0.95, ent.radius * 0.48, 0, 0, Math.PI * 2);
            targetCtx.fill();

            targetCtx.translate(0, bobY);

            if (ent.role === "blaze") {
                // ====================================================================
                // ブレイズ（アタックディーラー）：赤いマント＆黄色い王冠の骸骨王
                // ====================================================================
                const flutter = Math.sin(ent.capePhase) * 3.5;
                const lookX = cosA * 5.5;
                const lookY = sinA * 2.5;

                // 後ろ向きの場合は骸骨ボディを先に描き、手前に赤いマントを描画
                if (!isFacingBack) {
                    // なびく深紅の赤いマント（背面）
                    targetCtx.fillStyle = isFlashing ? "#ffffff" : "#b91c1c";
                    targetCtx.beginPath();
                    targetCtx.moveTo(-13, -18);
                    targetCtx.lineTo(13, -18);
                    targetCtx.lineTo(18 + flutter, 7);
                    targetCtx.lineTo(0, 4 + flutter * 0.5);
                    targetCtx.lineTo(-18 - flutter, 7);
                    targetCtx.closePath();
                    targetCtx.fill();

                    targetCtx.fillStyle = isFlashing ? "#ffffff" : "#dc2626";
                    targetCtx.beginPath();
                    targetCtx.moveTo(-10, -18);
                    targetCtx.lineTo(10, -18);
                    targetCtx.lineTo(13 + flutter * 0.6, 5);
                    targetCtx.lineTo(-13 - flutter * 0.6, 5);
                    targetCtx.closePath();
                    targetCtx.fill();
                }

                // 骸骨の肋骨ボディ
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#e2e8f0";
                targetCtx.beginPath();
                targetCtx.roundRect(-7, -16, 14, 14, 4);
                targetCtx.fill();

                if (isFacingBack) {
                    // 後ろ向き時は赤いマントが背中を覆う
                    targetCtx.fillStyle = isFlashing ? "#ffffff" : "#dc2626";
                    targetCtx.beginPath();
                    targetCtx.moveTo(-13, -18);
                    targetCtx.lineTo(13, -18);
                    targetCtx.lineTo(18 + flutter, 7);
                    targetCtx.lineTo(0, 4 + flutter * 0.5);
                    targetCtx.lineTo(-18 - flutter, 7);
                    targetCtx.closePath();
                    targetCtx.fill();
                }

                // 骸骨の頭蓋骨
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#f8fafc";
                targetCtx.beginPath();
                targetCtx.arc(lookX * 0.35, -26 + lookY * 0.35, 12, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.strokeStyle = "#cbd5e1";
                targetCtx.lineWidth = 1.2;
                targetCtx.stroke();

                if (!isFacingBack) {
                    // 顎パーツ
                    targetCtx.fillStyle = isFlashing ? "#ffffff" : "#f1f5f9";
                    targetCtx.beginPath();
                    targetCtx.roundRect(-6 + lookX * 0.5, -19 + lookY * 0.5, 12, 6, 2);
                    targetCtx.fill();

                    // 眼窩と燃える赤い瞳
                    targetCtx.fillStyle = "#0f172a";
                    targetCtx.beginPath();
                    targetCtx.arc(-4 + lookX, -27 + lookY, 3, 0, Math.PI * 2);
                    targetCtx.arc(4 + lookX, -27 + lookY, 3, 0, Math.PI * 2);
                    targetCtx.fill();

                    targetCtx.fillStyle = "#ef4444";
                    targetCtx.beginPath();
                    targetCtx.arc(-4 + lookX, -27 + lookY, 1.6, 0, Math.PI * 2);
                    targetCtx.arc(4 + lookX, -27 + lookY, 1.6, 0, Math.PI * 2);
                    targetCtx.fill();
                }

                // 黄色い王冠
                targetCtx.save();
                targetCtx.translate(lookX * 0.35, -36 + lookY * 0.35);
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#facc15";
                targetCtx.strokeStyle = "#a16207";
                targetCtx.lineWidth = 1.3;
                targetCtx.beginPath();
                targetCtx.moveTo(-10, 2);
                targetCtx.lineTo(-11, -7);
                targetCtx.lineTo(-5, -2);
                targetCtx.lineTo(0, -9);
                targetCtx.lineTo(5, -2);
                targetCtx.lineTo(11, -7);
                targetCtx.lineTo(10, 2);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                if (!isFacingBack) {
                    targetCtx.fillStyle = "#ef4444";
                    targetCtx.beginPath();
                    targetCtx.arc(0, -1.5, 1.8, 0, Math.PI * 2);
                    targetCtx.fill();
                }
                targetCtx.restore();

            } else if (ent.role === "viper") {
                // ====================================================================
                // ヴァイパー（スナイパー）：ピンク髪の可愛い女の子スナイパー
                // ====================================================================
                const flutter = Math.sin(ent.capePhase) * 3;
                const lookX = cosA * 5;
                const lookY = sinA * 2.5;

                // ふわふわピンクのツインテール（左右）
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#f472b6";
                targetCtx.strokeStyle = "#db2777";
                targetCtx.lineWidth = 1.2;
                // 左ツインテール
                targetCtx.beginPath();
                targetCtx.moveTo(-10, -25);
                targetCtx.quadraticCurveTo(-21 - flutter, -12, -16 - flutter * 0.6, 4);
                targetCtx.quadraticCurveTo(-10, 0, -9, -15);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();
                // 右ツインテール
                targetCtx.beginPath();
                targetCtx.moveTo(10, -25);
                targetCtx.quadraticCurveTo(21 + flutter, -12, 16 + flutter * 0.6, 4);
                targetCtx.quadraticCurveTo(10, 0, 9, -15);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                // 可愛いフリルスカート＆トップス
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#9d174d";
                targetCtx.beginPath();
                targetCtx.moveTo(-9, -15);
                targetCtx.lineTo(9, -15);
                targetCtx.lineTo(14, 6);
                targetCtx.lineTo(-14, 6);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.strokeStyle = "#f472b6";
                targetCtx.lineWidth = 1.2;
                targetCtx.stroke();

                // 頭部ベース（肌色）
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#ffe4e6";
                targetCtx.beginPath();
                targetCtx.arc(lookX * 0.3, -25 + lookY * 0.3, 11.5, 0, Math.PI * 2);
                targetCtx.fill();

                if (isFacingBack) {
                    // 後ろ向き時はピンク色の後頭部の髪全体を描画
                    targetCtx.fillStyle = isFlashing ? "#ffffff" : "#f472b6";
                    targetCtx.beginPath();
                    targetCtx.arc(lookX * 0.3, -25 + lookY * 0.3, 12, 0, Math.PI * 2);
                    targetCtx.fill();
                } else {
                    // ピンクの前髪
                    targetCtx.fillStyle = isFlashing ? "#ffffff" : "#f472b6";
                    targetCtx.beginPath();
                    targetCtx.arc(lookX * 0.3, -26 + lookY * 0.3, 12, Math.PI, Math.PI * 2);
                    targetCtx.lineTo(12 + lookX * 0.3, -22 + lookY * 0.3);
                    targetCtx.quadraticCurveTo(4 + lookX * 0.5, -28 + lookY * 0.5, lookX * 0.5, -23 + lookY * 0.5);
                    targetCtx.quadraticCurveTo(-4 + lookX * 0.5, -28 + lookY * 0.5, -12 + lookX * 0.3, -22 + lookY * 0.3);
                    targetCtx.closePath();
                    targetCtx.fill();

                    // キラキラした大きな瞳
                    targetCtx.fillStyle = "#be185d";
                    targetCtx.beginPath();
                    targetCtx.ellipse(-4 + lookX, -23 + lookY, 2.1, 2.7, 0, 0, Math.PI * 2);
                    targetCtx.ellipse(4 + lookX, -23 + lookY, 2.1, 2.7, 0, 0, Math.PI * 2);
                    targetCtx.fill();

                    // 瞳のハイライト
                    targetCtx.fillStyle = "#ffffff";
                    targetCtx.beginPath();
                    targetCtx.arc(-4.6 + lookX, -23.8 + lookY, 0.9, 0, Math.PI * 2);
                    targetCtx.arc(3.4 + lookX, -23.8 + lookY, 0.9, 0, Math.PI * 2);
                    targetCtx.fill();

                    // ピンクのほっぺ
                    targetCtx.fillStyle = "rgba(251, 113, 133, 0.65)";
                    targetCtx.beginPath();
                    targetCtx.ellipse(-6.5 + lookX, -20.5 + lookY, 1.8, 1, 0, 0, Math.PI * 2);
                    targetCtx.ellipse(6.5 + lookX, -20.5 + lookY, 1.8, 1, 0, 0, Math.PI * 2);
                    targetCtx.fill();
                }

                // ツインテール根元の赤いリボン
                targetCtx.fillStyle = "#fb7185";
                targetCtx.beginPath();
                targetCtx.arc(-10, -29, 3, 0, Math.PI * 2);
                targetCtx.arc(10, -29, 3, 0, Math.PI * 2);
                targetCtx.fill();

                // 構えたラブリー・スナイパーライフル
                targetCtx.save();
                targetCtx.translate(0, -12);
                targetCtx.rotate(ent.facingAngle);
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#334155";
                targetCtx.fillRect(-6, -2.5, 34, 5);
                targetCtx.fillStyle = "#f472b6";
                targetCtx.fillRect(4, -5.5, 11, 3);
                targetCtx.fillStyle = "#fde047";
                targetCtx.beginPath();
                targetCtx.arc(28, 0, 3, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.restore();

            } else if (ent.role === "titan") {
                // ====================================================================
                // タイタン（ヘビー）：多面体ダーク装甲＆薄紫スパイク＆バイザーの重装巨兵
                // ====================================================================
                const lookX = cosA * 4.5;
                const lookY = sinA * 2;
                const armSwing = Math.sin(ent.walkAnim) * 2.5;

                const darkArmor = isFlashing ? "#ffffff" : "#1e192b";
                const midArmor = isFlashing ? "#ffffff" : "#2f2842";
                const shoulderLight = isFlashing ? "#ffffff" : "#786b94";
                const shoulderDark = isFlashing ? "#ffffff" : "#423959";
                const accentLavender = isFlashing ? "#ffffff" : "#d8cce8";

                // 1. 四角く重厚な左右の脚部
                targetCtx.fillStyle = darkArmor;
                targetCtx.strokeStyle = "#0e0b16";
                targetCtx.lineWidth = 1.2;
                // 左脚
                targetCtx.fillRect(-12, -8 - armSwing * 0.4, 9.5, 14);
                targetCtx.strokeRect(-12, -8 - armSwing * 0.4, 9.5, 14);
                // 右脚
                targetCtx.fillRect(2.5, -8 + armSwing * 0.4, 9.5, 14);
                targetCtx.strokeRect(2.5, -8 + armSwing * 0.4, 9.5, 14);

                if (!isFacingBack) {
                    // 膝の薄紫アクセントプレート
                    targetCtx.fillStyle = accentLavender;
                    targetCtx.fillRect(-10, -3 - armSwing * 0.4, 5.5, 2.5);
                    targetCtx.fillRect(4.5, -3 + armSwing * 0.4, 5.5, 2.5);
                }

                // 2. 逆台形の重厚な胴体アーマー
                targetCtx.fillStyle = darkArmor;
                targetCtx.beginPath();
                targetCtx.moveTo(-15, -26);
                targetCtx.lineTo(15, -26);
                targetCtx.lineTo(11, -8);
                targetCtx.lineTo(-11, -8);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                // 胸中央の立体的な菱形クリスタルコア（正面時）
                if (!isFacingBack) {
                    const cxCore = lookX * 0.5;
                    const cyCore = -17 + lookY * 0.4;
                    targetCtx.fillStyle = accentLavender;
                    targetCtx.beginPath();
                    targetCtx.moveTo(cxCore, cyCore - 4.5);
                    targetCtx.lineTo(cxCore + 6.5, cyCore);
                    targetCtx.lineTo(cxCore - 6.5, cyCore);
                    targetCtx.closePath();
                    targetCtx.fill();

                    targetCtx.fillStyle = shoulderLight;
                    targetCtx.beginPath();
                    targetCtx.moveTo(cxCore - 6.5, cyCore);
                    targetCtx.lineTo(cxCore + 6.5, cyCore);
                    targetCtx.lineTo(cxCore, cyCore + 4.5);
                    targetCtx.closePath();
                    targetCtx.fill();
                }

                // 3. 左右の多面体ショルダーアーマー＆四角前腕＆スパイク突起
                [-1, 1].forEach((side) => {
                    const sx = side * 17.5;
                    const sy = -22 + (side === -1 ? armSwing : -armSwing);

                    // 前腕ブロック
                    targetCtx.fillStyle = darkArmor;
                    targetCtx.fillRect(sx - 4.5, sy + 4, 9, 13);
                    targetCtx.strokeRect(sx - 4.5, sy + 4, 9, 13);
                    if (!isFacingBack) {
                        targetCtx.fillStyle = accentLavender;
                        targetCtx.fillRect(sx - 3, sy + 12.5, 6, 2.2);
                    }

                    // 肩の薄紫スパイク突起
                    targetCtx.fillStyle = accentLavender;
                    targetCtx.beginPath();
                    targetCtx.moveTo(sx + side * 1, sy - 11);
                    targetCtx.lineTo(sx + side * 6.5, sy - 6);
                    targetCtx.lineTo(sx + side * 2, sy - 3);
                    targetCtx.lineTo(sx - side * 2.5, sy - 6);
                    targetCtx.closePath();
                    targetCtx.fill();

                    // 六角形・多面体の肩アーマー本体（2面シェーディングでローポリ感）
                    targetCtx.fillStyle = shoulderLight;
                    targetCtx.beginPath();
                    targetCtx.moveTo(sx, sy - 7);
                    targetCtx.lineTo(sx + side * 7.5, sy - 2);
                    targetCtx.lineTo(sx + side * 6.5, sy + 5);
                    targetCtx.lineTo(sx - side * 4.5, sy + 5);
                    targetCtx.lineTo(sx - side * 5.5, sy - 2);
                    targetCtx.closePath();
                    targetCtx.fill();
                    targetCtx.stroke();

                    targetCtx.fillStyle = shoulderDark;
                    targetCtx.beginPath();
                    targetCtx.moveTo(sx, sy - 7);
                    targetCtx.lineTo(sx + side * 7.5, sy - 2);
                    targetCtx.lineTo(sx + side * 6.5, sy + 5);
                    targetCtx.lineTo(sx, sy + 3);
                    targetCtx.closePath();
                    targetCtx.fill();
                });

                // 4. 多面体ヘルメット頭部＆頭頂部スパイク＆薄紫バイザー
                const hx = lookX * 0.35;
                const hy = -35 + lookY * 0.3;

                // 頭頂部の尖った薄紫スパイク
                targetCtx.fillStyle = accentLavender;
                targetCtx.beginPath();
                targetCtx.moveTo(hx, hy - 16);
                targetCtx.lineTo(hx + 3.2, hy - 9);
                targetCtx.lineTo(hx - 3.2, hy - 9);
                targetCtx.closePath();
                targetCtx.fill();

                // 六角多面体ヘルメット
                targetCtx.fillStyle = midArmor;
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 8, hy - 9.5);
                targetCtx.lineTo(hx + 8, hy - 9.5);
                targetCtx.lineTo(hx + 12.5, hy - 2);
                targetCtx.lineTo(hx + 8.5, hy + 6.5);
                targetCtx.lineTo(hx - 8.5, hy + 6.5);
                targetCtx.lineTo(hx - 12.5, hy - 2);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                // ヘルメット下部の陰影ファセット
                targetCtx.fillStyle = darkArmor;
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 12.5, hy - 2);
                targetCtx.lineTo(hx + 12.5, hy - 2);
                targetCtx.lineTo(hx + 8.5, hy + 6.5);
                targetCtx.lineTo(hx - 8.5, hy + 6.5);
                targetCtx.closePath();
                targetCtx.fill();

                if (!isFacingBack) {
                    // 横一文字の発光薄紫バイザー
                    targetCtx.fillStyle = accentLavender;
                    targetCtx.fillRect(hx - 7.5 + lookX * 0.55, hy - 3 + lookY * 0.4, 15, 3.2);
                }

            } else if (ent.role === "saital") {
                // ====================================================================
                // サイタル（サポーター）：ミント帽子＆単眼鏡＆菱形ケープのエルフ魔導士
                // ====================================================================
                const lookX = cosA * 4.5;
                const lookY = sinA * 2.2;
                const legSwing = Math.sin(ent.walkAnim) * 2.5;

                const mintMain = isFlashing ? "#ffffff" : "#78d9b8";
                const mintDark = isFlashing ? "#ffffff" : "#42a888";
                const creamCloth = isFlashing ? "#ffffff" : "#ede6c8";
                const silverHair = isFlashing ? "#ffffff" : "#e2e8f0";

                // 1. クリーム色の四角い脚部
                targetCtx.fillStyle = creamCloth;
                targetCtx.strokeStyle = "#142621";
                targetCtx.lineWidth = 1.2;
                targetCtx.fillRect(-8, -6 - legSwing * 0.5, 6.5, 13);
                targetCtx.strokeRect(-8, -6 - legSwing * 0.5, 6.5, 13);
                targetCtx.fillRect(1.5, -6 + legSwing * 0.5, 6.5, 13);
                targetCtx.strokeRect(1.5, -6 + legSwing * 0.5, 6.5, 13);

                // 2. ミントグリーンの裾広がりローブ
                targetCtx.fillStyle = mintMain;
                targetCtx.beginPath();
                targetCtx.moveTo(-10, -20);
                targetCtx.lineTo(10, -20);
                targetCtx.lineTo(14.5, 1);
                targetCtx.lineTo(-14.5, 1);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                // 3. 左右の袖と手
                [-1, 1].forEach((side) => {
                    const ax = side * 12.5;
                    const ay = -19 + (side === -1 ? legSwing * 0.3 : -legSwing * 0.3);
                    targetCtx.fillStyle = mintMain;
                    targetCtx.beginPath();
                    targetCtx.roundRect(ax - 3, ay, 6, 11, 2);
                    targetCtx.fill();
                    targetCtx.stroke();

                    targetCtx.fillStyle = silverHair;
                    targetCtx.beginPath();
                    targetCtx.arc(ax, ay + 11.5, 2.3, 0, Math.PI * 2);
                    targetCtx.fill();
                });

                // 4. クリーム色のケープ＆中央のミント菱形紋章
                targetCtx.fillStyle = creamCloth;
                targetCtx.beginPath();
                targetCtx.moveTo(-11, -24);
                targetCtx.lineTo(11, -24);
                targetCtx.lineTo(14.5, -13);
                targetCtx.lineTo(-14.5, -13);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                if (!isFacingBack) {
                    const cxGem = lookX * 0.45;
                    targetCtx.fillStyle = mintDark;
                    targetCtx.beginPath();
                    targetCtx.moveTo(cxGem, -21);
                    targetCtx.lineTo(cxGem + 4, -18.5);
                    targetCtx.lineTo(cxGem, -16);
                    targetCtx.lineTo(cxGem - 4, -18.5);
                    targetCtx.closePath();
                    targetCtx.fill();
                }

                // 5. 頭部（銀白髪＆尖ったエルフ耳）
                const hx = lookX * 0.3;
                const hy = -33 + lookY * 0.25;

                // 左右の尖ったエルフ耳
                targetCtx.fillStyle = silverHair;
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 10, hy - 1);
                targetCtx.lineTo(hx - 17, hy - 3.5);
                targetCtx.lineTo(hx - 10, hy + 2.5);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                targetCtx.beginPath();
                targetCtx.moveTo(hx + 10, hy - 1);
                targetCtx.lineTo(hx + 17, hy - 3.5);
                targetCtx.lineTo(hx + 10, hy + 2.5);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                // 丸い頭部
                targetCtx.fillStyle = silverHair;
                targetCtx.beginPath();
                targetCtx.arc(hx, hy, 11.5, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();

                if (!isFacingBack) {
                    // 顔の陰影・前髪ライン
                    targetCtx.fillStyle = isFlashing ? "#ffffff" : "#f8fafc";
                    targetCtx.beginPath();
                    targetCtx.arc(hx, hy - 2.5, 11, Math.PI, Math.PI * 2);
                    targetCtx.fill();

                    // 両サイドの垂れた白髪束
                    targetCtx.fillStyle = "#ffffff";
                    targetCtx.fillRect(hx - 10.5, hy - 3, 3, 13);
                    targetCtx.strokeRect(hx - 10.5, hy - 3, 3, 13);
                    targetCtx.fillRect(hx + 7.5, hy - 3, 3, 13);
                    targetCtx.strokeRect(hx + 7.5, hy - 3, 3, 13);

                    // 右目：穏やかな閉じ線
                    targetCtx.strokeStyle = "#1e293b";
                    targetCtx.lineWidth = 1.6;
                    targetCtx.beginPath();
                    targetCtx.moveTo(hx - 5.5 + lookX * 0.5, hy - 1 + lookY * 0.4);
                    targetCtx.lineTo(hx - 1.5 + lookX * 0.5, hy - 1 + lookY * 0.4);
                    targetCtx.stroke();

                    // 左目：金縁のミントグリーン単眼鏡（モノクル）
                    const mx = hx + 4 + lookX * 0.5;
                    const my = hy - 1.5 + lookY * 0.4;
                    targetCtx.fillStyle = mintMain;
                    targetCtx.beginPath();
                    targetCtx.arc(mx, my, 3.6, 0, Math.PI * 2);
                    targetCtx.fill();
                    targetCtx.strokeStyle = creamCloth;
                    targetCtx.lineWidth = 1.6;
                    targetCtx.stroke();

                    // 小さな笑顔の口
                    targetCtx.strokeStyle = "#1e293b";
                    targetCtx.lineWidth = 1.5;
                    targetCtx.beginPath();
                    targetCtx.arc(hx + lookX * 0.5, hy + 3.2 + lookY * 0.4, 2, 0.1 * Math.PI, 0.9 * Math.PI);
                    targetCtx.stroke();
                }

                // 6. ミントグリーンのとんがり魔導士ハット
                targetCtx.fillStyle = mintDark;
                targetCtx.beginPath();
                targetCtx.ellipse(hx, hy - 9.5, 17, 4, 0, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.strokeStyle = "#142621";
                targetCtx.lineWidth = 1.2;
                targetCtx.stroke();

                targetCtx.fillStyle = mintMain;
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 10, hy - 9.5);
                targetCtx.lineTo(hx, hy - 26);
                targetCtx.lineTo(hx + 10, hy - 9.5);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                // 7. 菱形クリスタル付きの魔導杖
                targetCtx.save();
                targetCtx.translate(14, -12);
                targetCtx.rotate(0.22);
                targetCtx.fillStyle = "#d6c896";
                targetCtx.fillRect(-1.5, -16, 3, 28);
                targetCtx.strokeRect(-1.5, -16, 3, 28);

                targetCtx.fillStyle = mintMain;
                targetCtx.beginPath();
                targetCtx.moveTo(0, -23);
                targetCtx.lineTo(5.5, -17.5);
                targetCtx.lineTo(0, -12);
                targetCtx.lineTo(-5.5, -17.5);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();
                targetCtx.restore();

            } else if (ent.role === "eric") {
                // ====================================================================
                // エリック（キラー）：黒忍者装束、紅蓮マフラー、額当て、刀
                // ====================================================================
                const lookX = cosA * 4.5;
                const lookY = sinA * 2.2;
                const legSwing = Math.sin(ent.walkAnim) * 2.5;
                const flutter = Math.sin(ent.capePhase) * 3;

                const ninjaBlack = isFlashing ? "#ffffff" : "#0f172a";
                const ninjaDark = isFlashing ? "#ffffff" : "#1e293b";
                const scarfRed = isFlashing ? "#ffffff" : "#be123c";
                const skinColor = isFlashing ? "#ffffff" : "#fcd34d";

                // 1. 脚部
                targetCtx.fillStyle = ninjaBlack;
                targetCtx.fillRect(-7, -6 - legSwing * 0.5, 5, 12);
                targetCtx.fillRect(2, -6 + legSwing * 0.5, 5, 12);

                // 2. 胴体（黒忍者装束）
                targetCtx.fillStyle = ninjaDark;
                targetCtx.beginPath();
                targetCtx.moveTo(-11, -22);
                targetCtx.lineTo(11, -22);
                targetCtx.lineTo(13, 2);
                targetCtx.lineTo(-13, 2);
                targetCtx.closePath();
                targetCtx.fill();
                
                // 背負い刀（後ろ向きの時のみ見える）
                if (isFacingBack) {
                    targetCtx.save();
                    targetCtx.translate(0, -12);
                    targetCtx.rotate(Math.PI / 4);
                    targetCtx.fillStyle = "#334155";
                    targetCtx.fillRect(-2, -18, 4, 36);
                    targetCtx.fillStyle = "#94a3b8";
                    targetCtx.fillRect(-3, -20, 6, 2);
                    targetCtx.fillStyle = "#cbd5e1";
                    targetCtx.fillRect(-1.5, -34, 3, 14);
                    targetCtx.restore();
                }

                // 3. なびく紅蓮マフラー（背面部）
                targetCtx.fillStyle = scarfRed;
                targetCtx.beginPath();
                targetCtx.moveTo(-8, -20);
                targetCtx.lineTo(6, -22);
                targetCtx.lineTo(12 + flutter, -4);
                targetCtx.lineTo(5 + flutter * 0.5, -4);
                targetCtx.closePath();
                targetCtx.fill();

                // 4. 頭部
                const hx = lookX * 0.3;
                const hy = -32 + lookY * 0.25;

                targetCtx.fillStyle = skinColor;
                targetCtx.beginPath();
                targetCtx.arc(hx, hy, 10.5, 0, Math.PI * 2);
                targetCtx.fill();

                // 頭巾（目元以外を覆う）
                if (isFacingBack) {
                    targetCtx.fillStyle = ninjaBlack;
                    targetCtx.beginPath();
                    targetCtx.arc(hx, hy, 11, 0, Math.PI * 2);
                    targetCtx.fill();
                } else {
                    targetCtx.fillStyle = ninjaBlack;
                    targetCtx.beginPath();
                    targetCtx.arc(hx, hy, 11, Math.PI * 1.1, Math.PI * 2.9);
                    targetCtx.fill();

                    targetCtx.fillStyle = ninjaBlack;
                    targetCtx.fillRect(hx - 11, hy + 2, 22, 9);
                }

                if (!isFacingBack) {
                    // 金属額当て
                    targetCtx.fillStyle = "#cbd5e1";
                    targetCtx.fillRect(hx - 8, hy - 8, 16, 4.5);
                    targetCtx.fillStyle = "#64748b";
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 6, hy - 5.7, 0.8, 0, Math.PI * 2);
                    targetCtx.arc(hx + 6, hy - 5.7, 0.8, 0, Math.PI * 2);
                    targetCtx.fill();

                    // 目
                    targetCtx.fillStyle = "#1e293b";
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 4 + lookX * 0.3, hy - 1 + lookY * 0.3, 1.8, 0, Math.PI * 2);
                    targetCtx.arc(hx + 4 + lookX * 0.3, hy - 1 + lookY * 0.3, 1.8, 0, Math.PI * 2);
                    targetCtx.fill();
                }

                // 5. 紅蓮マフラー（首回り・前面）
                targetCtx.fillStyle = scarfRed;
                targetCtx.beginPath();
                targetCtx.ellipse(hx, hy + 10, 13, 4.5, 0, 0, Math.PI * 2);
                targetCtx.fill();

                // 6. 手と抜身の小太刀
                [-1, 1].forEach((side) => {
                    const ax = side * 13;
                    const ay = -16 + (side === -1 ? legSwing * 0.4 : -legSwing * 0.4);
                    
                    targetCtx.fillStyle = ninjaBlack;
                    targetCtx.beginPath();
                    targetCtx.arc(ax, ay, 4, 0, Math.PI * 2);
                    targetCtx.fill();

                    // 右手に刀
                    if (side === 1 && !isFacingBack) {
                        targetCtx.save();
                    targetCtx.translate(ax, ay);
                    targetCtx.rotate(ent.facingAngle + Math.PI / 4);
                    targetCtx.fillStyle = "#334155";
                    targetCtx.fillRect(-1.5, -6, 3, 12);
                    targetCtx.fillStyle = "#cbd5e1";
                    targetCtx.fillRect(-1, 6, 2, 16); // 刀身
                    targetCtx.restore();
                }
            });

            } else if (ent.role === "frost") {
                // ====================================================================
                // フロスト（コントローラー）：氷のローブと王冠を被った氷結の帝王
                // ====================================================================
                const lookX = cosA * 4.5;
                const lookY = sinA * 2.2;
                const legSwing = Math.sin(ent.walkAnim) * 2.5;

                // 足（ローブの下）
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#0891b2";
                targetCtx.fillRect(-7, -6 - legSwing * 0.5, 5, 12);
                targetCtx.fillRect(2, -6 + legSwing * 0.5, 5, 12);

                // 氷のローブ
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#06b6d4";
                targetCtx.beginPath();
                targetCtx.moveTo(-12, -22);
                targetCtx.lineTo(12, -22);
                targetCtx.lineTo(15, 4);
                targetCtx.lineTo(-15, 4);
                targetCtx.closePath();
                targetCtx.fill();

                // 首元の白いファー
                targetCtx.fillStyle = "#f1f5f9";
                targetCtx.beginPath();
                targetCtx.ellipse(0, -22, 14, 6, 0, 0, Math.PI*2);
                targetCtx.fill();

                // 顔（青白い肌）
                const hx = lookX * 0.3;
                const hy = -30 + lookY * 0.25;
                targetCtx.fillStyle = "#e0f2fe";
                targetCtx.beginPath();
                targetCtx.arc(hx, hy, 10, 0, Math.PI*2);
                targetCtx.fill();

                if (!isFacingBack) {
                    // 光るシアン色の目
                    targetCtx.fillStyle = "#22d3ee";
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 3.5 + lookX * 0.3, hy - 1 + lookY * 0.3, 2, 0, Math.PI*2);
                    targetCtx.arc(hx + 3.5 + lookX * 0.3, hy - 1 + lookY * 0.3, 2, 0, Math.PI*2);
                    targetCtx.fill();
                }

                // 氷の王冠
                targetCtx.fillStyle = "#67e8f9";
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 10, hy - 5);
                targetCtx.lineTo(hx - 12, hy - 15);
                targetCtx.lineTo(hx - 5, hy - 10);
                targetCtx.lineTo(hx, hy - 18);
                targetCtx.lineTo(hx + 5, hy - 10);
                targetCtx.lineTo(hx + 12, hy - 15);
                targetCtx.lineTo(hx + 10, hy - 5);
                targetCtx.closePath();
                targetCtx.fill();

            } else if (ent.role === "pom") {
                // ====================================================================
                // ポム＆リル（スロワー）：魔女の帽子とローブ
                // ====================================================================
                const lookX = cosA * 4;
                const lookY = sinA * 2;
                const legSwing = Math.sin(ent.walkAnim) * 2.5;

                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#4c1d95";
                targetCtx.fillRect(-6, -6 - legSwing * 0.5, 4, 12);
                targetCtx.fillRect(2, -6 + legSwing * 0.5, 4, 12);

                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#7e22ce";
                targetCtx.beginPath();
                targetCtx.moveTo(-11, -20);
                targetCtx.lineTo(11, -20);
                targetCtx.lineTo(14, 2);
                targetCtx.lineTo(-14, 2);
                targetCtx.closePath();
                targetCtx.fill();

                const hx = lookX * 0.3;
                const hy = -28 + lookY * 0.25;
                targetCtx.fillStyle = "#fde68a";
                targetCtx.beginPath();
                targetCtx.arc(hx, hy, 10, 0, Math.PI * 2);
                targetCtx.fill();

                if (!isFacingBack) {
                    targetCtx.fillStyle = "#4c1d95";
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 3, hy - 1, 1.5, 0, Math.PI * 2);
                    targetCtx.arc(hx + 3, hy - 1, 1.5, 0, Math.PI * 2);
                    targetCtx.fill();
                }

                targetCtx.fillStyle = "#581c87";
                targetCtx.beginPath();
                targetCtx.ellipse(hx, hy - 8, 15, 4, 0, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 9, hy - 8);
                targetCtx.lineTo(hx + 4, -35);
                targetCtx.lineTo(hx + 9, hy - 8);
                targetCtx.closePath();
                targetCtx.fill();
            } else if (ent.role === "lil") {
                // ====================================================================
                // リル（使い魔）：小さなスライム的なモンスター
                // ====================================================================
                const lookX = cosA * 2;
                const lookY = sinA * 1.5;
                const bounce = Math.abs(Math.sin(ent.walkAnim * 1.5)) * 4;

                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#d946ef";
                targetCtx.beginPath();
                targetCtx.ellipse(0, -6 - bounce, 12, 10, 0, 0, Math.PI*2);
                targetCtx.fill();
                
                targetCtx.fillStyle = "#fdf4ff";
                targetCtx.beginPath();
                targetCtx.arc(-4 + lookX, -8 - bounce + lookY, 2, 0, Math.PI*2);
                targetCtx.arc(4 + lookX, -8 - bounce + lookY, 2, 0, Math.PI*2);
                targetCtx.fill();
            } else if (ent.role === "centaur") {
                // ====================================================================
                // ケンタウロス（スピーダー・TEST）：半人半馬の疾風戦斧戦士
                // ====================================================================
                const lookX = cosA * 4.5;
                const lookY = sinA * 2.2;
                const gallop = Math.sin(ent.walkAnim * 1.4) * 4;
                const horseBrown = isFlashing ? "#ffffff" : "#78350f";
                const horseDark = isFlashing ? "#ffffff" : "#451a03";
                const armorCyan = isFlashing ? "#ffffff" : "#06b6d4";

                // 4本の馬の脚（駆ける動き）
                targetCtx.fillStyle = horseDark;
                targetCtx.fillRect(-14, -4 + gallop * 0.5, 4.5, 11);
                targetCtx.fillRect(-7, -4 - gallop * 0.5, 4.5, 11);
                targetCtx.fillRect(4, -4 - gallop * 0.5, 4.5, 11);
                targetCtx.fillRect(10, -4 + gallop * 0.5, 4.5, 11);

                // 馬の胴体
                targetCtx.fillStyle = horseBrown;
                targetCtx.strokeStyle = horseDark;
                targetCtx.lineWidth = 1.4;
                targetCtx.beginPath();
                targetCtx.ellipse(-2, -9, 17, 9, 0, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();

                // なびく尻尾
                targetCtx.strokeStyle = "#fef3c7";
                targetCtx.lineWidth = 3;
                targetCtx.beginPath();
                targetCtx.moveTo(-18, -10);
                targetCtx.quadraticCurveTo(-26, -6 + gallop * 0.6, -24, 2);
                targetCtx.stroke();

                // 人間の上半身＆シアン装甲
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#d97706";
                targetCtx.beginPath();
                targetCtx.roundRect(-7 + lookX * 0.2, -28, 16, 17, 4);
                targetCtx.fill();

                targetCtx.fillStyle = armorCyan;
                targetCtx.fillRect(-9 + lookX * 0.2, -28, 20, 5);

                // 頭部＆疾風の兜
                const hx = 1 + lookX * 0.35;
                const hy = -35 + lookY * 0.25;
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#fed7aa";
                targetCtx.beginPath();
                targetCtx.arc(hx, hy, 8.5, 0, Math.PI * 2);
                targetCtx.fill();

                // 兜＆羽飾り
                targetCtx.fillStyle = armorCyan;
                targetCtx.beginPath();
                targetCtx.arc(hx, hy - 2, 9, Math.PI, Math.PI * 2);
                targetCtx.fill();
                targetCtx.fillStyle = "#facc15";
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 2, hy - 10);
                targetCtx.lineTo(hx + 2, hy - 18);
                targetCtx.lineTo(hx + 6, hy - 10);
                targetCtx.closePath();
                targetCtx.fill();

                if (!isFacingBack) {
                    targetCtx.fillStyle = "#0f172a";
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 2.5 + lookX * 0.3, hy + lookY * 0.2, 1.5, 0, Math.PI * 2);
                    targetCtx.arc(hx + 3 + lookX * 0.3, hy + lookY * 0.2, 1.5, 0, Math.PI * 2);
                    targetCtx.fill();
                }

                // 構えた大戦斧（チャージ中は黄金に輝く）
                const chargeRatio = Math.min(1, (ent.axeChargeTimer || 0) / 5.0);
                targetCtx.save();
                targetCtx.translate(10, -20);
                targetCtx.rotate(-0.4 - chargeRatio * 0.9);
                targetCtx.fillStyle = "#94a3b8";
                targetCtx.fillRect(-1.8, -18, 3.6, 26);
                targetCtx.fillStyle = chargeRatio >= 0.95 ? "#facc15" : "#38bdf8";
                targetCtx.strokeStyle = "#ffffff";
                targetCtx.lineWidth = 1;
                targetCtx.beginPath();
                targetCtx.moveTo(1, -18);
                targetCtx.quadraticCurveTo(15, -14, 10, -4);
                targetCtx.lineTo(1, -9);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();
                targetCtx.restore();

                // 斧を振った時の斬撃アークエフェクト
                if (ent.axeSwingAnim && ent.axeSwingAnim > 0) {
                    const alpha = ent.axeSwingAnim / 0.28;
                    targetCtx.save();
                    targetCtx.rotate(ent.axeSwingAngle);
                    targetCtx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
                    targetCtx.lineWidth = 8 * alpha;
                    targetCtx.beginPath();
                    targetCtx.arc(0, 0, 120, -0.95, 0.95);
                    targetCtx.stroke();
                    targetCtx.restore();
                }
            } else if (ent.role === "rearn") {
                // ====================================================================
                // レアーン（アタックディーラー）：両手を横に広げた紫衣の呪い操り人形
                // ====================================================================
                const lookX = cosA * 4.5;
                const lookY = sinA * 2;
                const sway = Math.sin(ent.walkAnim) * 2.5;
                const isPuppetBlack = ent.isPuppet;
                const dollSkin = isPuppetBlack ? "#09080f" : (isFlashing ? "#ffffff" : "#f3e8ff");
                const dollOutfit = isPuppetBlack ? "#09080f" : (isFlashing ? "#ffffff" : "#581c87");
                const dollTrim = isPuppetBlack ? "#a855f7" : (isFlashing ? "#ffffff" : "#9333ea");
                const accentPurple = isFlashing ? "#ffffff" : "#c084fc";
                const deepPurple = isFlashing ? "#ffffff" : "#3b0764";

                // 1. 頭上の紫木製十字架（操りバー）＆光る紫の操作糸
                targetCtx.save();
                targetCtx.strokeStyle = "rgba(216, 180, 254, 0.72)";
                targetCtx.lineWidth = 1.1;
                targetCtx.beginPath();
                // 頭・両手へつながる操り糸
                targetCtx.moveTo(0, -49);
                targetCtx.lineTo(lookX * 0.3, -34);
                targetCtx.moveTo(-14, -49);
                targetCtx.lineTo(-22, -18 + sway * 0.4);
                targetCtx.moveTo(14, -49);
                targetCtx.lineTo(22, -18 - sway * 0.4);
                targetCtx.stroke();

                // 紫の操作バー
                targetCtx.strokeStyle = isPuppetBlack ? "#3b0764" : "#7e22ce";
                targetCtx.lineWidth = 3.2;
                targetCtx.lineCap = "round";
                targetCtx.beginPath();
                targetCtx.moveTo(-16, -49);
                targetCtx.lineTo(16, -49);
                targetCtx.stroke();
                targetCtx.restore();

                // 2. 関節のある人形の脚（紫ブーツ付き）
                targetCtx.fillStyle = dollSkin;
                targetCtx.strokeStyle = isPuppetBlack ? "#a855f7" : "#6b21a8";
                targetCtx.lineWidth = 1.2;
                targetCtx.fillRect(-7, -6 - sway * 0.5, 4.5, 13);
                targetCtx.strokeRect(-7, -6 - sway * 0.5, 4.5, 13);
                targetCtx.fillRect(2.5, -6 + sway * 0.5, 4.5, 13);
                targetCtx.strokeRect(2.5, -6 + sway * 0.5, 4.5, 13);

                targetCtx.fillStyle = deepPurple;
                targetCtx.fillRect(-7, 2 - sway * 0.5, 4.5, 5);
                targetCtx.fillRect(2.5, 2 + sway * 0.5, 4.5, 5);

                // 3. 両手を横に大きく広げたポーズ（紫の袖＆球体関節）
                targetCtx.strokeStyle = dollSkin;
                targetCtx.lineWidth = 5;
                targetCtx.lineCap = "round";
                targetCtx.beginPath();
                targetCtx.moveTo(-23, -18 + sway * 0.4);
                targetCtx.lineTo(23, -18 - sway * 0.4);
                targetCtx.stroke();

                // 紫のパフ袖
                targetCtx.fillStyle = dollTrim;
                targetCtx.beginPath();
                targetCtx.arc(-11, -18 + sway * 0.15, 4.2, 0, Math.PI * 2);
                targetCtx.arc(11, -18 - sway * 0.15, 4.2, 0, Math.PI * 2);
                targetCtx.fill();

                // 肘・手首の紫球体関節
                targetCtx.fillStyle = accentPurple;
                targetCtx.beginPath();
                targetCtx.arc(-16, -18 + sway * 0.25, 2.3, 0, Math.PI * 2);
                targetCtx.arc(16, -18 - sway * 0.25, 2.3, 0, Math.PI * 2);
                targetCtx.arc(-23, -18 + sway * 0.4, 2.8, 0, Math.PI * 2);
                targetCtx.arc(23, -18 - sway * 0.4, 2.8, 0, Math.PI * 2);
                targetCtx.fill();

                // 4. 紫ゴシック人形の胴体ドレス
                targetCtx.fillStyle = dollOutfit;
                targetCtx.strokeStyle = accentPurple;
                targetCtx.lineWidth = 1.4;
                targetCtx.beginPath();
                targetCtx.moveTo(-9, -22);
                targetCtx.lineTo(9, -22);
                targetCtx.lineTo(13.5, -3);
                targetCtx.lineTo(-13.5, -3);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.stroke();

                // 胸の鮮やかな紫リボン
                if (!isFacingBack) {
                    targetCtx.fillStyle = accentPurple;
                    targetCtx.beginPath();
                    targetCtx.moveTo(0, -18);
                    targetCtx.lineTo(-5.5, -21.5);
                    targetCtx.lineTo(-5.5, -14.5);
                    targetCtx.closePath();
                    targetCtx.moveTo(0, -18);
                    targetCtx.lineTo(5.5, -21.5);
                    targetCtx.lineTo(5.5, -14.5);
                    targetCtx.closePath();
                    targetCtx.fill();
                }

                // 5. 操り人形の頭部（紫の髪＆ゴシックリボン）
                const hx = lookX * 0.3;
                const hy = -31 + lookY * 0.25;
                targetCtx.fillStyle = dollSkin;
                targetCtx.strokeStyle = isPuppetBlack ? "#a855f7" : "#6b21a8";
                targetCtx.lineWidth = 1.3;
                targetCtx.beginPath();
                targetCtx.arc(hx, hy, 10.5, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();

                // 紫のボブヘア・前髪
                targetCtx.fillStyle = isPuppetBlack ? "#1e1b2e" : "#6b21a8";
                targetCtx.beginPath();
                if (isFacingBack) {
                    targetCtx.arc(hx, hy, 11, 0, Math.PI * 2);
                } else {
                    targetCtx.arc(hx, hy - 1, 11, Math.PI, Math.PI * 2);
                    targetCtx.lineTo(hx + 11, hy + 2);
                    targetCtx.lineTo(hx + 7, hy - 4);
                    targetCtx.lineTo(hx, hy - 6);
                    targetCtx.lineTo(hx - 7, hy - 4);
                    targetCtx.lineTo(hx - 11, hy + 2);
                    targetCtx.closePath();
                }
                targetCtx.fill();

                // 頭頂の紫リボン飾り
                targetCtx.fillStyle = accentPurple;
                targetCtx.beginPath();
                targetCtx.ellipse(hx - 5, hy - 10, 4.5, 2.5, -0.3, 0, Math.PI * 2);
                targetCtx.ellipse(hx + 5, hy - 10, 4.5, 2.5, 0.3, 0, Math.PI * 2);
                targetCtx.fill();

                if (!isFacingBack) {
                    // 紫に怪しく光るボタン目
                    targetCtx.fillStyle = "#a855f7";
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 3.8 + lookX * 0.35, hy - 0.5 + lookY * 0.25, 2.5, 0, Math.PI * 2);
                    targetCtx.arc(hx + 3.8 + lookX * 0.35, hy - 0.5 + lookY * 0.25, 2.5, 0, Math.PI * 2);
                    targetCtx.fill();

                    targetCtx.fillStyle = "#f5d0fe";
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 4.3 + lookX * 0.35, hy - 1.2 + lookY * 0.25, 0.9, 0, Math.PI * 2);
                    targetCtx.arc(hx + 3.3 + lookX * 0.35, hy - 1.2 + lookY * 0.25, 0.9, 0, Math.PI * 2);
                    targetCtx.fill();

                    // 人形の継ぎ目口
                    targetCtx.strokeStyle = isPuppetBlack ? "#c084fc" : "#4c1d95";
                    targetCtx.lineWidth = 1.4;
                    targetCtx.beginPath();
                    targetCtx.moveTo(hx - 4.2 + lookX * 0.35, hy + 4.8 + lookY * 0.25);
                    targetCtx.lineTo(hx + 4.2 + lookX * 0.35, hy + 4.8 + lookY * 0.25);
                    targetCtx.stroke();
                }
            } else if (ent.role === "forever") {
                // ====================================================================
                // フォーエバー（スナイパー）：黄金の蜂スナイパー（羽・縞模様・触角・針ランス）
                // ====================================================================
                const lookX = cosA * 4.5;
                const lookY = sinA * 2.2;
                const wingFlap = Math.sin(gameState.time * 36) * 5;
                const legSwing = Math.sin(ent.walkAnim) * 2.5;
                const beeYellow = isFlashing ? "#ffffff" : "#facc15";
                const beeBlack = isFlashing ? "#ffffff" : "#0f172a";

                // 1. 高速で羽ばたく半透明の蜂の羽（背面左右）
                targetCtx.save();
                targetCtx.fillStyle = "rgba(224, 242, 254, 0.72)";
                targetCtx.strokeStyle = "#38bdf8";
                targetCtx.lineWidth = 1.2;
                // 左羽
                targetCtx.beginPath();
                targetCtx.ellipse(-14, -22 + wingFlap * 0.4, 11, 5.5, -0.45 - wingFlap * 0.04, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();
                // 右羽
                targetCtx.beginPath();
                targetCtx.ellipse(14, -22 + wingFlap * 0.4, 11, 5.5, 0.45 + wingFlap * 0.04, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();
                targetCtx.restore();

                // 2. 脚部（黒ブーツ）
                targetCtx.fillStyle = beeBlack;
                targetCtx.fillRect(-7, -6 - legSwing * 0.5, 4.5, 12);
                targetCtx.fillRect(2.5, -6 + legSwing * 0.5, 4.5, 12);

                // 3. 黒×黄ストライプの蜂ボディ＆お尻の針
                targetCtx.fillStyle = beeYellow;
                targetCtx.strokeStyle = beeBlack;
                targetCtx.lineWidth = 1.4;
                targetCtx.beginPath();
                targetCtx.ellipse(0, -13, 11, 12, 0, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();

                // 黒い縞模様
                targetCtx.fillStyle = beeBlack;
                targetCtx.fillRect(-10, -17, 20, 3.5);
                targetCtx.fillRect(-9.5, -10, 19, 3.5);

                // 後ろ向き時はお尻の鋭い針が見える
                if (isFacingBack) {
                    targetCtx.fillStyle = "#e2e8f0";
                    targetCtx.beginPath();
                    targetCtx.moveTo(-3, -3);
                    targetCtx.lineTo(3, -3);
                    targetCtx.lineTo(0, 6);
                    targetCtx.closePath();
                    targetCtx.fill();
                }

                // 4. 頭部＆触角＆スナイパーゴーグル
                const hx = lookX * 0.3;
                const hy = -29 + lookY * 0.25;

                // 触角（左右）
                targetCtx.strokeStyle = beeBlack;
                targetCtx.lineWidth = 2;
                targetCtx.beginPath();
                targetCtx.moveTo(hx - 4, hy - 8);
                targetCtx.quadraticCurveTo(hx - 9, hy - 18, hx - 13, hy - 14);
                targetCtx.moveTo(hx + 4, hy - 8);
                targetCtx.quadraticCurveTo(hx + 9, hy - 18, hx + 13, hy - 14);
                targetCtx.stroke();
                targetCtx.fillStyle = beeYellow;
                targetCtx.beginPath();
                targetCtx.arc(hx - 13, hy - 14, 2.2, 0, Math.PI * 2);
                targetCtx.arc(hx + 13, hy - 14, 2.2, 0, Math.PI * 2);
                targetCtx.fill();

                // 頭部ベース
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#fde047";
                targetCtx.strokeStyle = beeBlack;
                targetCtx.lineWidth = 1.3;
                targetCtx.beginPath();
                targetCtx.arc(hx, hy, 10, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.stroke();

                if (!isFacingBack) {
                    // クールな黒スナイパーゴーグル＆光るシアン／赤レンズ
                    targetCtx.fillStyle = beeBlack;
                    targetCtx.beginPath();
                    targetCtx.roundRect(hx - 8.5 + lookX * 0.3, hy - 3.5 + lookY * 0.2, 17, 6.5, 3);
                    targetCtx.fill();

                    const eyeGlow = ent.foreverHuntActive ? "#ef4444" : (ent.foreverChargedShot ? "#facc15" : "#38bdf8");
                    targetCtx.fillStyle = eyeGlow;
                    targetCtx.beginPath();
                    targetCtx.arc(hx - 3.8 + lookX * 0.35, hy - 0.2 + lookY * 0.2, 2.2, 0, Math.PI * 2);
                    targetCtx.arc(hx + 3.8 + lookX * 0.35, hy - 0.2 + lookY * 0.2, 2.2, 0, Math.PI * 2);
                    targetCtx.fill();
                }

                // 5. 構えた蜂針スナイパーランス（1500強化時は先端が黄金に輝く）
                targetCtx.save();
                targetCtx.translate(0, -12);
                targetCtx.rotate(ent.facingAngle);
                targetCtx.fillStyle = beeBlack;
                targetCtx.fillRect(-4, -2.5, 22, 5);
                targetCtx.fillStyle = ent.foreverChargedShot ? "#facc15" : "#fef08a";
                targetCtx.beginPath();
                targetCtx.moveTo(18, -4.5);
                targetCtx.lineTo(35, 0);
                targetCtx.lineTo(18, 4.5);
                targetCtx.closePath();
                targetCtx.fill();
                targetCtx.restore();

                // 6. ウルト中の超広角600ダメージ攻撃エフェクト
                if (ent.foreverSwingAnim && ent.foreverSwingAnim > 0) {
                    const alpha = ent.foreverSwingAnim / 0.24;
                    targetCtx.save();
                    targetCtx.rotate(ent.foreverSwingAngle);
                    targetCtx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
                    targetCtx.lineWidth = 10 * alpha;
                    targetCtx.beginPath();
                    targetCtx.arc(0, 0, 145, -1.48, 1.48);
                    targetCtx.stroke();
                    targetCtx.restore();
                }
            } else if (ent.role === "knight") {
                // ダークナイト（AI用）
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#1e3a8a";
                targetCtx.beginPath();
                targetCtx.roundRect(-14, -24, 28, 28, 8);
                targetCtx.fill();

                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#94a3b8";
                targetCtx.beginPath();
                targetCtx.arc(0, -28, 12, 0, Math.PI * 2);
                targetCtx.fill();

                targetCtx.fillStyle = "#38bdf8";
                targetCtx.fillRect(-7, -30, 14, 3.5);
            } else if (ent.role === "witch") {
                // シャドウウィッチ（AI用）
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#581c87";
                targetCtx.beginPath();
                targetCtx.moveTo(-14, 6);
                targetCtx.lineTo(0, -24);
                targetCtx.lineTo(14, 6);
                targetCtx.closePath();
                targetCtx.fill();

                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#f3e8ff";
                targetCtx.beginPath();
                targetCtx.arc(0, -24, 10, 0, Math.PI * 2);
                targetCtx.fill();

                // 魔女ハット
                targetCtx.fillStyle = isFlashing ? "#ffffff" : "#3b0764";
                targetCtx.beginPath();
                targetCtx.ellipse(0, -31, 16, 4.5, 0, 0, Math.PI * 2);
                targetCtx.fill();
                targetCtx.beginPath();
                targetCtx.moveTo(-10, -31);
                targetCtx.lineTo(0, -47);
                targetCtx.lineTo(10, -31);
                targetCtx.closePath();
                targetCtx.fill();
            }

            targetCtx.restore();
        }

        function drawBrawler25D(ent) {
            const player = getPlayer();

            // 草むらに潜む敵は、プレイヤーが近づく(165px以内)か攻撃/被弾して露見するまで非表示
            if (ent.inBush && ent.revealedTimer <= 0 && player && ent.team !== player.team) {
                const distToPlayer = Math.hypot(ent.x - player.x, ent.y - player.y);
                if (distToPlayer > 165) return;
            }

            // プレイヤー自身が草むらにいる時、敵に視認されているか判定
            let playerSpottedInBush = false;
            if (ent.isPlayer && ent.inBush) {
                if (ent.revealedTimer > 0) {
                    playerSpottedInBush = true;
                } else {
                    for (const other of gameState.entities) {
                        if (other.dead || other.team === ent.team) continue;
                        if (Math.hypot(other.x - ent.x, other.y - ent.y) <= 165) {
                            playerSpottedInBush = true;
                            break;
                        }
                    }
                }
            }

            ctx.save();
            if (ent.inBush) ctx.globalAlpha = playerSpottedInBush ? 0.85 : 0.45;

            // 足元のチームリング
            ctx.strokeStyle = ent.isPlayer
                ? "rgba(250, 204, 21, 0.85)"
                : (ent.team === "blue" ? "rgba(56, 189, 248, 0.7)" : "rgba(244, 63, 94, 0.7)");
            ctx.lineWidth = ent.isPlayer ? 3 : 2;
            ctx.beginPath();
            ctx.ellipse(ent.x, ent.y + 8, ent.radius * 1.15, ent.radius * 0.58, 0, 0, Math.PI * 2);
            ctx.stroke();

            // キャラクター本体モデル描画（人形化中は真っ黒に染めた姿で両手を横に上げてくるくる回る）
            if (ent.isPuppet) {
                ctx.save();
                ctx.translate(ent.x, ent.y);
                const spinWobble = Math.sin(ent.puppetSpin * 2) * 3;
                // 影
                ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
                ctx.beginPath();
                ctx.ellipse(0, 8, ent.radius, ent.radius * 0.5, 0, 0, Math.PI * 2);
                ctx.fill();

                // 頭上の赤い操り糸
                ctx.strokeStyle = "rgba(244, 63, 94, 0.75)";
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(0, -50);
                ctx.lineTo(0, -34);
                ctx.moveTo(-16, -50);
                ctx.lineTo(-24, -18 + spinWobble);
                ctx.moveTo(16, -50);
                ctx.lineTo(24, -18 - spinWobble);
                ctx.stroke();

                // 真っ黒に染まった体＆横に上げた両手
                ctx.strokeStyle = "#050509";
                ctx.lineWidth = 6;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(-24, -18 + spinWobble);
                ctx.lineTo(24, -18 - spinWobble);
                ctx.stroke();

                ctx.fillStyle = "#050509";
                ctx.strokeStyle = "#dc2626";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.roundRect(-11, -24, 22, 24, 6);
                ctx.fill();
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(0, -33, 11, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                // 回転する赤い目
                const eyeX = Math.cos(ent.puppetSpin) * 5;
                if (Math.sin(ent.puppetSpin) > -0.3) {
                    ctx.fillStyle = "#ef4444";
                    ctx.beginPath();
                    ctx.arc(eyeX - 3, -33, 2.2, 0, Math.PI * 2);
                    ctx.arc(eyeX + 3, -33, 2.2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            } else {
                drawBrawlerModelOnly(ctx, ent, ent.x, ent.y, 1.0);
            }

            // 頭上HPバー＆弾薬ゲージ＆名前描画
            const barW = 46;
            const barH = 5.5;
            const barY = ent.y - 54;
            const hpRatio = Math.max(0, ent.hp / ent.maxHp);

            ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
            ctx.fillRect(ent.x - barW / 2 - 1, barY - 1, barW + 2, barH + 2);

            ctx.fillStyle = ent.team === "blue" ? "#38bdf8" : "#f43f5e";
            ctx.fillRect(ent.x - barW / 2, barY, barW * hpRatio, barH);

            // プレイヤー用 弾薬ゲージ（キャラのmaxAmmoに対応：通常3発 / ケンタウロス2発）
            if (ent.isPlayer) {
                const ammoY = barY + 8;
                const slots = Math.round(ent.maxAmmo);
                const segW = (barW - (slots - 1) * 2) / slots;
                for (let s = 0; s < slots; s++) {
                    const fillRatio = Math.max(0, Math.min(1, ent.ammo - s));
                    const sx = ent.x - barW / 2 + s * (segW + 2);
                    ctx.fillStyle = "rgba(2, 6, 23, 0.8)";
                    ctx.fillRect(sx, ammoY, segW, 3.5);
                    ctx.fillStyle = fillRatio >= 1 ? "#fb923c" : "#94a3b8";
                    ctx.fillRect(sx, ammoY, segW * fillRatio, 3.5);
                }

                // ケンタウロス専用：速度ゲージ（3.5〜12.5）＆斧チャージゲージ（250→700）
                if (ent.role === "centaur") {
                    const spdRatio = Math.max(0, Math.min(1, (ent.centaurSpeedScale - 3.5) / (12.5 - 3.5)));
                    const spdY = barY - 22;
                    ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
                    ctx.fillRect(ent.x - barW / 2, spdY, barW, 4);
                    ctx.fillStyle = spdRatio > 0.75 ? "#facc15" : "#22d3ee";
                    ctx.fillRect(ent.x - barW / 2, spdY, barW * spdRatio, 4);

                    ctx.font = "900 9px Inter, sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillStyle = spdRatio > 0.75 ? "#fde047" : "#67e8f9";
                    ctx.fillText(`SPD ${ent.centaurSpeedScale.toFixed(1)}`, ent.x, spdY - 3);

                    if (ent.axeChargeTimer > 0) {
                        const cRatio = Math.min(1, ent.axeChargeTimer / 5.0);
                        const dmgPreview = Math.round(250 + 450 * cRatio);
                        const cY = barY - 36;
                        ctx.fillStyle = "rgba(2, 6, 23, 0.9)";
                        ctx.fillRect(ent.x - barW / 2, cY, barW, 5);
                        ctx.fillStyle = cRatio >= 0.95 ? "#facc15" : "#fb923c";
                        ctx.fillRect(ent.x - barW / 2, cY, barW * cRatio, 5);
                        ctx.fillStyle = cRatio >= 0.95 ? "#fef08a" : "#fed7aa";
                        ctx.fillText(`斧 ${dmgPreview} DMG`, ent.x, cY - 3);
                    }
                }

                // フォーエバー専用：1500強化弾 / 探知2倍速＆壁貫通 / ウルト残り秒数表示
                if (ent.role === "forever") {
                    ctx.font = "900 9px Inter, sans-serif";
                    ctx.textAlign = "center";
                    if (ent.foreverUltTimer > 0) {
                        ctx.fillStyle = "#fde047";
                        ctx.fillText(`🐝 RUSH ${ent.foreverUltTimer.toFixed(1)}s`, ent.x, barY - 22);
                    } else if (ent.foreverChargedShot) {
                        ctx.fillStyle = "#facc15";
                        ctx.fillText("⚡ 1500 DMG READY!", ent.x, barY - 22);
                    }
                    if (ent.foreverHuntActive) {
                        ctx.fillStyle = "#fb7185";
                        ctx.fillText("🔥 SPD×2 / 壁貫通", ent.x, barY - 34);
                    }
                }
            }

            // 名前ラベル
            ctx.font = "800 10px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillStyle = ent.isPlayer ? "#fde047" : "#e2e8f0";
            ctx.fillText(ent.name, ent.x, barY - 5);

            // 人形化中の残り時間インジケーター（5秒カウントダウン）
            if (ent.isPuppet) {
                ctx.font = "900 10px Inter, sans-serif";
                ctx.fillStyle = "#d8b4fe";
                ctx.fillText(`🟣 人形化 ${Math.max(1, Math.ceil(ent.puppetTimer))}s`, ent.x, barY - 18);
            }

            // 草むら隠密ステータス表示（プレイヤー用）
            if (ent.isPlayer && ent.inBush) {
                ctx.font = "900 10px Inter, sans-serif";
                ctx.fillStyle = playerSpottedInBush ? "#fb7185" : "#4ade80";
                ctx.fillText(playerSpottedInBush ? "⚠ 発見中" : "🌿 隠密中", ent.x, barY - 18);
            }

            // 所持ジェム表示
            if (ent.gems > 0) {
                ctx.fillStyle = "#06b6d4";
                ctx.beginPath();
                ctx.moveTo(ent.x, barY - 25);
                ctx.lineTo(ent.x + 6, barY - 18);
                ctx.lineTo(ent.x, barY - 11);
                ctx.lineTo(ent.x - 6, barY - 18);
                ctx.closePath();
                ctx.fill();
                ctx.font = "900 9px Inter, sans-serif";
                ctx.fillStyle = "#ffffff";
                ctx.fillText(ent.gems, ent.x, barY - 15);
            }

            ctx.restore();
        }

        function drawProjectiles() {
            for (const p of gameState.projectiles) {
                ctx.save();
                ctx.translate(p.x, p.y);

                if (p.type === "blaze_orb") {
                    const grad = ctx.createRadialGradient(0, -6, 2, 0, -6, p.radius * 1.8);
                    grad.addColorStop(0, "rgba(254, 240, 138, 0.95)");
                    grad.addColorStop(0.55, "rgba(249, 115, 22, 0.85)");
                    grad.addColorStop(1, "rgba(220, 38, 38, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 1.8, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#fef08a";
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 0.7, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === "viper_snipe") {
                    const angle = Math.atan2(p.vy, p.vx);
                    ctx.rotate(angle);
                    const grad = ctx.createLinearGradient(-22, -6, 12, -6);
                    grad.addColorStop(0, "rgba(244, 114, 182, 0)");
                    grad.addColorStop(1, "rgba(244, 114, 182, 0.95)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.ellipse(-4, -6, 18, 5, 0, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#fce7f3";
                    ctx.beginPath();
                    ctx.arc(6, -6, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === "viper_pierce_ult") {
                    const angle = Math.atan2(p.vy, p.vx);
                    ctx.rotate(angle);
                    const grad = ctx.createRadialGradient(0, -6, 3, 0, -6, 26);
                    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
                    grad.addColorStop(0.45, "rgba(244, 114, 182, 0.95)");
                    grad.addColorStop(0.8, "rgba(250, 204, 21, 0.7)");
                    grad.addColorStop(1, "rgba(244, 114, 182, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.ellipse(0, -6, 28, 16, 0, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#ffffff";
                    ctx.beginPath();
                    ctx.ellipse(6, -6, 12, 5, 0, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === "titan_orb") {
                    const grad = ctx.createRadialGradient(0, -6, 2, 0, -6, p.radius * 1.7);
                    grad.addColorStop(0, "rgba(243, 232, 255, 0.95)");
                    grad.addColorStop(0.55, "rgba(168, 85, 247, 0.85)");
                    grad.addColorStop(1, "rgba(88, 28, 135, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 1.7, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#e9d5ff";
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 0.68, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === "saital_center") {
                    const angle = Math.atan2(p.vy, p.vx);
                    ctx.rotate(angle);
                    const grad = ctx.createRadialGradient(0, -6, 2, 0, -6, 20);
                    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
                    grad.addColorStop(0.5, "rgba(52, 211, 153, 0.9)");
                    grad.addColorStop(1, "rgba(16, 185, 129, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.ellipse(0, -6, 20, 11, 0, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#ecfdf5";
                    ctx.beginPath();
                    ctx.moveTo(10, -6);
                    ctx.lineTo(0, -11);
                    ctx.lineTo(-10, -6);
                    ctx.lineTo(0, -1);
                    ctx.closePath();
                    ctx.fill();
                } else if (p.type === "pom_flask") {
                    const progress = 1 - (p.life / p.maxLife);
                    const arcHeight = Math.sin(progress * Math.PI) * 40;
                    
                    ctx.save();
                    ctx.translate(0, -arcHeight);
                    const angle = gameState.time * 10;
                    ctx.rotate(angle);
                    
                    ctx.fillStyle = "#d946ef";
                    ctx.beginPath();
                    ctx.arc(0, 0, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = "#fdf4ff";
                    ctx.fillRect(-2, -8, 4, 4);
                    ctx.restore();
                    
                    ctx.fillStyle = "rgba(0,0,0,0.3)";
                    ctx.beginPath();
                    ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI*2);
                    ctx.fill();
                } else if (p.type === "saital_outer") {
                    const grad = ctx.createRadialGradient(0, -6, 2, 0, -6, p.radius * 1.7);
                    grad.addColorStop(0, "rgba(236, 253, 245, 0.95)");
                    grad.addColorStop(0.6, "rgba(110, 231, 183, 0.85)");
                    grad.addColorStop(1, "rgba(16, 185, 129, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 1.7, 0, Math.PI * 2);
                    ctx.fill();
                } else if (p.type === "rearn_homing") {
                    const grad = ctx.createRadialGradient(0, -6, 2, 0, -6, p.radius * 2.0);
                    grad.addColorStop(0, "rgba(254, 205, 211, 1)");
                    grad.addColorStop(0.45, "rgba(225, 29, 72, 0.9)");
                    grad.addColorStop(0.8, "rgba(15, 10, 25, 0.7)");
                    grad.addColorStop(1, "rgba(15, 10, 25, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 2.0, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.fillStyle = "#09080f";
                    ctx.strokeStyle = "#f43f5e";
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 0.65, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                } else if (p.type === "forever_sting" || p.type === "forever_super_sting") {
                    const angle = Math.atan2(p.vy, p.vx);
                    const isSuper = p.type === "forever_super_sting";
                    ctx.rotate(angle);

                    const glowR = isSuper ? 26 : 14;
                    const grad = ctx.createRadialGradient(0, -6, 2, 0, -6, glowR);
                    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
                    grad.addColorStop(0.45, isSuper ? "rgba(250, 204, 21, 0.95)" : "rgba(253, 224, 71, 0.85)");
                    grad.addColorStop(1, "rgba(234, 179, 8, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.ellipse(0, -6, glowR * 1.1, isSuper ? 12 : 6, 0, 0, Math.PI * 2);
                    ctx.fill();

                    // 鋭い蜂の針形状
                    ctx.fillStyle = isSuper ? "#fef08a" : "#ffffff";
                    ctx.strokeStyle = "#0f172a";
                    ctx.lineWidth = 1.3;
                    ctx.beginPath();
                    ctx.moveTo(isSuper ? 22 : 13, -6);
                    ctx.lineTo(isSuper ? -12 : -8, isSuper ? -11 : -9);
                    ctx.lineTo(isSuper ? -7 : -4, -6);
                    ctx.lineTo(isSuper ? -12 : -8, isSuper ? -1 : -3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                } else {
                    const grad = ctx.createRadialGradient(0, -6, 2, 0, -6, p.radius * 1.7);
                    grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
                    grad.addColorStop(0.6, "rgba(168, 85, 247, 0.85)");
                    grad.addColorStop(1, "rgba(88, 28, 135, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(0, -6, p.radius * 1.7, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.restore();
            }
        }

        function drawTorchLights() {
            for (let r = 0; r < MAP_ROWS; r++) {
                for (let c = 0; c < MAP_COLS; c++) {
                    if (gameState.map[r][c] === 5) {
                        const cx = c * TILE_SIZE + TILE_SIZE / 2;
                        const cy = r * TILE_SIZE + TILE_SIZE / 2 - 26;
                        const flicker = Math.sin(gameState.time * 16 + r * 3) * 5;
                        const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, 60 + flicker);
                        grad.addColorStop(0, "rgba(251, 146, 60, 0.3)");
                        grad.addColorStop(1, "rgba(251, 146, 60, 0)");
                        ctx.fillStyle = grad;
                        ctx.beginPath();
                        ctx.arc(cx, cy, 60 + flicker, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
        }

        function drawDarkVignette() {
            const cx = viewWidth / 2;
            const cy = viewHeight / 2;
            const maxR = Math.hypot(cx, cy);
            const grad = ctx.createRadialGradient(cx, cy, maxR * 0.42, cx, cy, maxR);
            grad.addColorStop(0, "rgba(0, 0, 0, 0)");
            grad.addColorStop(1, "rgba(3, 2, 8, 0.72)");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, viewWidth, viewHeight);
        }

        // ----------------------------------------------------------------------------
        // 10. デュアルバーチャルスティックUI描画
        // ----------------------------------------------------------------------------
        function drawVirtualSticks() {
            const player = getPlayer();

            // 1. 左：移動スティック
            const ms = input.moveStick;
            ctx.save();
            ctx.beginPath();
            ctx.arc(ms.baseX, ms.baseY, ms.radius, 0, Math.PI * 2);
            ctx.fillStyle = ms.active ? "rgba(56, 189, 248, 0.18)" : "rgba(148, 163, 184, 0.12)";
            ctx.fill();
            ctx.strokeStyle = ms.active ? "rgba(56, 189, 248, 0.55)" : "rgba(148, 163, 184, 0.3)";
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(ms.currX, ms.currY, 22, 0, Math.PI * 2);
            ctx.fillStyle = ms.active ? "rgba(56, 189, 248, 0.75)" : "rgba(226, 232, 240, 0.45)";
            ctx.fill();
            ctx.restore();

            // 2. 右：通常攻撃スティック（赤 / キャンセル時はグレー＆×印）
            const as = input.attackStick;
            ctx.save();
            ctx.beginPath();
            ctx.arc(as.baseX, as.baseY, as.radius, 0, Math.PI * 2);
            ctx.fillStyle = as.isCanceled
                ? "rgba(100, 116, 139, 0.25)"
                : (as.active ? "rgba(239, 68, 68, 0.25)" : "rgba(239, 68, 68, 0.14)");
            ctx.fill();
            ctx.strokeStyle = as.isCanceled ? "rgba(148, 163, 184, 0.75)" : "rgba(248, 113, 113, 0.55)";
            ctx.lineWidth = 2.5;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(as.currX, as.currY, 24, 0, Math.PI * 2);
            ctx.fillStyle = as.isCanceled ? "#475569" : "#ef4444";
            ctx.fill();
            ctx.strokeStyle = as.isCanceled ? "#cbd5e1" : "#fecaca";
            ctx.lineWidth = 2;
            ctx.stroke();

            if (as.isCanceled) {
                ctx.strokeStyle = "#f87171";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(as.currX - 7, as.currY - 7);
                ctx.lineTo(as.currX + 7, as.currY + 7);
                ctx.moveTo(as.currX + 7, as.currY - 7);
                ctx.lineTo(as.currX - 7, as.currY + 7);
                ctx.stroke();
            } else if (player && player.role === "viper") {
                ctx.strokeStyle = "#fce7f3";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(as.currX, as.currY, 8, 0, Math.PI * 2);
                ctx.moveTo(as.currX - 12, as.currY);
                ctx.lineTo(as.currX + 12, as.currY);
                ctx.moveTo(as.currX, as.currY - 12);
                ctx.lineTo(as.currX, as.currY + 12);
                ctx.stroke();
            } else if (player && player.role === "titan") {
                ctx.fillStyle = "#e9d5ff";
                ctx.beginPath();
                ctx.arc(as.currX - 10, as.currY, 2.2, 0, Math.PI * 2);
                ctx.arc(as.currX - 5, as.currY - 1, 2.4, 0, Math.PI * 2);
                ctx.arc(as.currX, as.currY - 1.5, 2.6, 0, Math.PI * 2);
                ctx.arc(as.currX + 5, as.currY - 1, 2.4, 0, Math.PI * 2);
                ctx.arc(as.currX + 10, as.currY, 2.2, 0, Math.PI * 2);
                ctx.fill();
            } else if (player && player.role === "saital") {
                ctx.fillStyle = "#a7f3d0";
                ctx.beginPath();
                ctx.arc(as.currX - 7, as.currY + 1, 2.5, 0, Math.PI * 2);
                ctx.arc(as.currX + 7, as.currY + 1, 2.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#ffffff";
                ctx.beginPath();
                ctx.arc(as.currX, as.currY - 3, 3.8, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.fillStyle = "#fef08a";
                ctx.beginPath();
                ctx.arc(as.currX - 7, as.currY, 3, 0, Math.PI * 2);
                ctx.arc(as.currX, as.currY - 2, 3.3, 0, Math.PI * 2);
                ctx.arc(as.currX + 7, as.currY, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();

            // 3. 右上寄り：ウルトスティック（黄 / キャンセル時はグレー＆×印）
            const us = input.ultStick;
            const ultCharge = player ? player.ultCharge : 0;
            const isReady = ultCharge >= 100;

            ctx.save();
            ctx.beginPath();
            ctx.arc(us.baseX, us.baseY, us.radius, 0, Math.PI * 2);
            ctx.fillStyle = us.isCanceled
                ? "rgba(100, 116, 139, 0.3)"
                : (isReady ? "rgba(250, 204, 21, 0.28)" : "rgba(15, 23, 42, 0.65)");
            ctx.fill();
            ctx.strokeStyle = us.isCanceled ? "#94a3b8" : (isReady ? "#facc15" : "rgba(148, 163, 184, 0.35)");
            ctx.lineWidth = 2.5;
            ctx.stroke();

            if (ultCharge > 0) {
                const drawCharge = ultCharge % 100;
                if (drawCharge > 0 || !isReady) {
                    ctx.strokeStyle = "#facc15";
                    ctx.lineWidth = 3.5;
                    ctx.beginPath();
                    ctx.arc(
                        us.baseX,
                        us.baseY,
                        us.radius,
                        -Math.PI / 2,
                        -Math.PI / 2 + (Math.PI * 2 * (drawCharge === 0 ? 1 : drawCharge / 100))
                    );
                    ctx.stroke();
                }
            }

            ctx.beginPath();
            ctx.arc(us.currX, us.currY, 19, 0, Math.PI * 2);
            ctx.fillStyle = us.isCanceled ? "#475569" : (isReady ? "#facc15" : "#334155");
            ctx.fill();

            if (us.isCanceled) {
                ctx.strokeStyle = "#f87171";
                ctx.lineWidth = 2.8;
                ctx.beginPath();
                ctx.moveTo(us.currX - 6, us.currY - 6);
                ctx.lineTo(us.currX + 6, us.currY + 6);
                ctx.moveTo(us.currX + 6, us.currY - 6);
                ctx.lineTo(us.currX - 6, us.currY + 6);
                ctx.stroke();
            } else {
                ctx.font = "900 10px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillStyle = isReady ? "#0f172a" : "#cbd5e1";
                if (isReady && player.maxUltCharge > 100) {
                    const stocks = Math.floor(ultCharge / 100);
                    ctx.fillText(`ULTx${stocks}`, us.currX, us.currY);
                } else {
                    ctx.fillText(isReady ? "ULT" : `${Math.floor(ultCharge)}%`, us.currX, us.currY);
                }
            }
            ctx.restore();
        }

        function drawZones() {
            // レアーン周囲のウルトチャージ円＆ブラッドムーン領域（床面に完全な真円で描画）
            for (const ent of gameState.entities) {
                if (ent.dead || ent.role !== "rearn" || ent.isPuppet) continue;
                const r = ent.rearnZoneRadius || 210;
                ctx.save();
                if (ent.rearnUltTimer > 0) {
                    // 真っ黒のブラッドムーン領域（完全な真円）
                    ctx.fillStyle = "rgba(5, 2, 12, 0.92)";
                    ctx.beginPath();
                    ctx.arc(ent.x, ent.y, r, 0, Math.PI * 2);
                    ctx.fill();

                    // 領域内に浮かぶ紅と紫のブラッドムーン
                    const moonGrad = ctx.createRadialGradient(ent.x, ent.y, 12, ent.x, ent.y, r * 0.62);
                    moonGrad.addColorStop(0, "rgba(220, 38, 38, 0.72)");
                    moonGrad.addColorStop(0.58, "rgba(147, 51, 234, 0.38)");
                    moonGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
                    ctx.fillStyle = moonGrad;
                    ctx.beginPath();
                    ctx.arc(ent.x, ent.y, r * 0.65, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = "#ef4444";
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.arc(ent.x, ent.y, r, 0, Math.PI * 2);
                    ctx.stroke();

                    ctx.font = "900 16px Inter, sans-serif";
                    ctx.textAlign = "center";
                    ctx.fillStyle = "#fca5a5";
                    ctx.fillText(`BLOOD MOON ${Math.ceil(ent.rearnUltTimer)}s`, ent.x, ent.y - r + 24);
                } else {
                    // 通常時のチャージ円（完全な真円）
                    let hasEnemyInside = false;
                    for (const other of gameState.entities) {
                        if (other.dead || other.team === ent.team) continue;
                        if (Math.hypot(other.x - ent.x, other.y - ent.y) <= r + other.radius) {
                            hasEnemyInside = true;
                            break;
                        }
                    }
                    ctx.fillStyle = hasEnemyInside ? "rgba(168, 85, 247, 0.16)" : "rgba(88, 28, 135, 0.08)";
                    ctx.beginPath();
                    ctx.arc(ent.x, ent.y, r, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = hasEnemyInside ? "rgba(192, 132, 252, 0.85)" : "rgba(168, 85, 247, 0.45)";
                    ctx.lineWidth = hasEnemyInside ? 3 : 2;
                    ctx.setLineDash([12, 8]);
                    ctx.beginPath();
                    ctx.arc(ent.x, ent.y, r, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                ctx.restore();
            }

            // フォーエバーの目の先の細い探知範囲（HP半分以下の敵がいると赤／黄金に光り、移動速度2倍＆壁貫通）
            for (const ent of gameState.entities) {
                if (ent.dead || ent.role !== "forever" || ent.isPuppet) continue;
                const huntRange = 480;
                const huntHalfAngle = (Math.PI * 10) / 180;
                ctx.save();
                const isActive = ent.foreverHuntActive;
                ctx.fillStyle = isActive ? "rgba(251, 113, 133, 0.14)" : "rgba(250, 204, 21, 0.06)";
                ctx.beginPath();
                ctx.moveTo(ent.x, ent.y);
                ctx.arc(ent.x, ent.y, huntRange, ent.facingAngle - huntHalfAngle, ent.facingAngle + huntHalfAngle);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = isActive ? "rgba(251, 113, 133, 0.72)" : "rgba(250, 204, 21, 0.3)";
                ctx.lineWidth = isActive ? 2.5 : 1.5;
                ctx.setLineDash([10, 8]);
                ctx.beginPath();
                ctx.moveTo(ent.x, ent.y);
                ctx.arc(ent.x, ent.y, huntRange, ent.facingAngle - huntHalfAngle, ent.facingAngle + huntHalfAngle);
                ctx.closePath();
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            for (const z of gameState.zones) {
                ctx.save();
                const alpha = Math.min(1, z.life / 0.4) * 0.45;
                if (z.type === "frost_attack") {
                    const grad = ctx.createRadialGradient(z.x, z.y, 12, z.x, z.y, z.radius);
                    grad.addColorStop(0, `rgba(103, 232, 249, ${alpha * 1.1})`);
                    grad.addColorStop(1, "rgba(6, 182, 212, 0)");
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.moveTo(z.x, z.y);
                    ctx.arc(z.x, z.y, z.radius, z.angle - z.spread / 2, z.angle + z.spread / 2);
                    ctx.closePath();
                    ctx.fill();
                } else if (z.type === "frost_ult") {
                    ctx.fillStyle = `rgba(165, 243, 252, ${alpha * 0.7})`;
                    ctx.beginPath();
                    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = `rgba(34, 211, 238, ${alpha * 1.8})`;
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        function drawGems() {
            for (const g of gameState.gems) {
                const bob = Math.sin(g.bobPhase) * 3.5;
                ctx.save();
                ctx.translate(g.x, g.y + bob);

                // 足元の影
                ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
                ctx.beginPath();
                ctx.ellipse(0, 10 - bob, 9, 4.5, 0, 0, Math.PI * 2);
                ctx.fill();

                // 光のオーラ
                const glow = ctx.createRadialGradient(0, -4, 2, 0, -4, 18);
                glow.addColorStop(0, "rgba(34, 211, 238, 0.65)");
                glow.addColorStop(1, "rgba(34, 211, 238, 0)");
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(0, -4, 18, 0, Math.PI * 2);
                ctx.fill();

                // ダイヤモンド本体
                ctx.fillStyle = "#22d3ee";
                ctx.strokeStyle = "#cffafe";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(0, -14);
                ctx.lineTo(9, -4);
                ctx.lineTo(0, 6);
                ctx.lineTo(-9, -4);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.restore();
            }
        }

        function getAimRayDistance(startX, startY, angle, maxDist) {
            const step = 12;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            for (let d = step; d <= maxDist; d += step) {
                const cx = startX + cosA * d;
                const cy = startY + sinA * d;
                const col = Math.floor(cx / TILE_SIZE);
                const row = Math.floor(cy / TILE_SIZE);
                if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) {
                    return Math.max(0, d - step);
                }
                const tile = gameState.map[row][col];
                if (tile === 1 || tile === 5) {
                    return Math.max(0, d - step * 0.5);
                }
            }
            return maxDist;
        }

        function drawPlayerAimGuide() {
            const player = getPlayer();
            if (!player || player.dead || gameState.status !== "playing") return;

            const isAimingAttack = (input.attackStick.active && !input.attackStick.isCanceled) || input.mouseCharge.active;
            const isAimingUlt = input.ultStick.active && !input.ultStick.isCanceled && player.ultCharge >= 100;
            if (!isAimingAttack && !isAimingUlt) return;

            let angle = player.facingAngle;
            let aimRatio = 1.0;

            if (isAimingUlt) {
                if (input.ultStick.maxMovedDist >= 16) {
                    angle = Math.atan2(input.ultStick.dy, input.ultStick.dx);
                    aimRatio = Math.min(1, input.ultStick.dragDist / input.ultStick.radius);
                } else {
                    const auto = getAutoAimData(player);
                    angle = auto.angle;
                    aimRatio = Math.min(1, auto.dist / 600);
                }
            } else if (input.attackStick.active) {
                if (input.attackStick.maxMovedDist >= 16) {
                    angle = Math.atan2(input.attackStick.dy, input.attackStick.dx);
                    aimRatio = Math.min(1, input.attackStick.dragDist / input.attackStick.radius);
                } else {
                    const auto = getAutoAimData(player);
                    angle = auto.angle;
                    aimRatio = Math.min(1, auto.dist / player.range);
                }
            } else if (input.mouseCharge.active && input.mouse.active) {
                const wx = input.mouse.x - viewWidth / 2 + gameState.camera.x;
                const wy = input.mouse.y - viewHeight / 2 + gameState.camera.y;
                angle = Math.atan2(wy - player.y, wx - player.x);
                aimRatio = Math.min(1, Math.hypot(wx - player.x, wy - player.y) / player.range);
            }

            const fwdX = Math.cos(angle);
            const fwdY = Math.sin(angle);
            const perpX = -fwdY;
            const perpY = fwdX;

            ctx.save();

            // サッカーボール所持中のシュートエイムガイド（壁に当たると反射軌道を予測表示）
            if (gameState.soccer.active && gameState.soccer.ball.holderId === player.id) {
                const maxLen = isAimingUlt ? 540 : 340;
                const ballR = gameState.soccer.ball.radius || 15;
                const step = 6;
                const maxBounces = 4;

                const isSolidForAim = (px, py) => {
                    // 上下コート境界
                    if (py < TILE_SIZE + ballR || py > MAP_HEIGHT - TILE_SIZE - ballR) return true;
                    // ゴール枠外の左右境界
                    const inGoalY = py >= 5.0 * TILE_SIZE && py <= 13.0 * TILE_SIZE;
                    if (!inGoalY && (px < TILE_SIZE + ballR || px > MAP_WIDTH - TILE_SIZE - ballR)) return true;

                    const col = Math.floor(px / TILE_SIZE);
                    const row = Math.floor(py / TILE_SIZE);
                    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return true;
                    const tile = gameState.map[row][col];
                    if (tile === 1 || tile === 3 || tile === 5) {
                        const isOuter = (row === 0 || row === MAP_ROWS - 1 || col === 0 || col === MAP_COLS - 1);
                        // スーパーシュート中は外周以外の障害物壁を粉砕して突き進むため反射しない
                        if (isAimingUlt && !isOuter && !gameState.soccer.suddenDeath) return false;
                        return true;
                    }
                    return false;
                };

                let curX = player.x;
                let curY = player.y;
                let dirX = fwdX;
                let dirY = fwdY;
                let traveled = 0;
                let bounces = 0;
                const points = [{ x: curX, y: curY, bounce: false }];

                while (traveled < maxLen) {
                    const nextX = curX + dirX * step;
                    const nextY = curY + dirY * step;

                    // ゴールラインを超えたらそこで軌道表示終了
                    const inGoalY = nextY >= 5.0 * TILE_SIZE && nextY <= 13.0 * TILE_SIZE;
                    if (inGoalY && (nextX <= TILE_SIZE * 1.1 || nextX >= MAP_WIDTH - TILE_SIZE * 1.1)) {
                        points.push({ x: nextX, y: nextY, bounce: false });
                        break;
                    }

                    if (isSolidForAim(nextX, nextY)) {
                        if (bounces >= maxBounces) {
                            points.push({ x: curX, y: curY, bounce: true });
                            break;
                        }
                        const hitX = isSolidForAim(curX + dirX * step, curY);
                        const hitY = isSolidForAim(curX, curY + dirY * step);
                        if (hitX) dirX = -dirX;
                        if (hitY) dirY = -dirY;
                        if (!hitX && !hitY) {
                            dirX = -dirX;
                            dirY = -dirY;
                        }
                        points.push({ x: curX, y: curY, bounce: true });
                        bounces++;
                        traveled += step;
                        continue;
                    }

                    curX = nextX;
                    curY = nextY;
                    traveled += step;
                }
                points.push({ x: curX, y: curY, bounce: false });

                // 折れ線エイムガイド描画
                ctx.strokeStyle = isAimingUlt ? "rgba(250, 204, 21, 0.88)" : "rgba(52, 211, 153, 0.85)";
                ctx.lineWidth = isAimingUlt ? 9 : 6;
                ctx.lineCap = "round";
                ctx.lineJoin = "round";
                ctx.setLineDash([12, 8]);
                ctx.beginPath();
                ctx.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x, points[i].y);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                // 反射ポイント＆終点マーカー
                for (let i = 1; i < points.length; i++) {
                    const pt = points[i];
                    if (pt.bounce) {
                        ctx.fillStyle = "#ffffff";
                        ctx.strokeStyle = isAimingUlt ? "#facc15" : "#34d399";
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    }
                }
                const lastPt = points[points.length - 1];
                ctx.fillStyle = isAimingUlt ? "#facc15" : "#34d399";
                ctx.beginPath();
                ctx.arc(lastPt.x, lastPt.y, isAimingUlt ? 8 : 6, 0, Math.PI * 2);
                ctx.fill();

                ctx.restore();
                return;
            }

            if (isAimingUlt) {
                if (player.role === "blaze") {
                    // ブレイズウルト：前方高速ダッシュ軌道（約170px）
                    const dashLen = getAimRayDistance(player.x, player.y, angle, 180);
                    const ex = player.x + fwdX * dashLen;
                    const ey = player.y + fwdY * dashLen;
                    ctx.strokeStyle = "rgba(250, 204, 21, 0.35)";
                    ctx.lineWidth = 42;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = "rgba(251, 146, 60, 0.95)";
                    ctx.lineWidth = 4;
                    ctx.setLineDash([10, 6]);
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = "#facc15";
                    ctx.beginPath();
                    ctx.arc(ex, ey, 9, 0, Math.PI * 2);
                    ctx.fill();
                } else if (player.role === "viper") {
                    // ヴァイパーウルト：ハートブレイク・キャノン（超長距離・壁貫通なし）
                    const startX = player.x + fwdX * 28;
                    const startY = player.y + fwdY * 28;
                    const dist = getAimRayDistance(startX, startY, angle, 820);
                    const ex = startX + fwdX * dist;
                    const ey = startY + fwdY * dist;

                    ctx.strokeStyle = "rgba(244, 114, 182, 0.28)";
                    ctx.lineWidth = 30;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
                    ctx.lineWidth = 4;
                    ctx.setLineDash([14, 8]);
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // 先端レティクル
                    ctx.strokeStyle = "#facc15";
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.arc(ex, ey, 14, 0, Math.PI * 2);
                    ctx.stroke();
                } else if (player.role === "titan") {
                    // タイタンウルト：自身中心の半径200px円形ノヴァ範囲
                    ctx.fillStyle = "rgba(192, 132, 252, 0.18)";
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, 200, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = "#facc15";
                    ctx.lineWidth = 3;
                    ctx.setLineDash([12, 8]);
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, 200, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                } else if (player.role === "saital") {
                    // サイタルウルト：自身中心の半径230px円形回復範囲
                    ctx.fillStyle = "rgba(52, 211, 153, 0.18)";
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, 230, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = "#facc15";
                    ctx.lineWidth = 3;
                    ctx.setLineDash([12, 8]);
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, 230, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                } else if (player.role === "frost") {
                    const dist = Math.max(60, aimRatio * 600);
                    const tx = player.x + fwdX * dist;
                    const ty = player.y + fwdY * dist;
                    ctx.strokeStyle = "rgba(250, 204, 21, 0.85)";
                    ctx.lineWidth = 3;
                    ctx.setLineDash([8, 6]);
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.lineTo(tx, ty);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = "rgba(34, 211, 238, 0.22)";
                    ctx.beginPath();
                    ctx.arc(tx, ty, 165, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = "#facc15";
                    ctx.stroke();
                } else if (player.role === "pom") {
                    const tx = player.x + fwdX * 55;
                    const ty = player.y + fwdY * 55;
                    ctx.fillStyle = "rgba(217, 70, 239, 0.25)";
                    ctx.strokeStyle = "#facc15";
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(tx, ty, 34, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                } else if (player.role === "centaur") {
                    const dist = 480; // 15m突撃距離
                    const ex = player.x + fwdX * dist;
                    const ey = player.y + fwdY * dist;
                    ctx.strokeStyle = "rgba(250, 204, 21, 0.65)";
                    ctx.lineWidth = 56;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                } else if (player.role === "rearn") {
                    // レアーンウルト：自身中心の半径210pxブラッドムーン領域ガイド
                    const r = player.rearnZoneRadius || 210;
                    ctx.fillStyle = "rgba(15, 5, 12, 0.55)";
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, r, 0, Math.PI * 2);
                    ctx.fill();

                    ctx.strokeStyle = "#f43f5e";
                    ctx.lineWidth = 3.5;
                    ctx.setLineDash([12, 8]);
                    ctx.beginPath();
                    ctx.arc(player.x, player.y, r, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                } else if (player.role === "forever") {
                    // フォーエバーウルト：毎秒15の速度で前方ダッシュ軌道（約216px）
                    const dashLen = getAimRayDistance(player.x, player.y, angle, 216);
                    const ex = player.x + fwdX * dashLen;
                    const ey = player.y + fwdY * dashLen;
                    ctx.strokeStyle = "rgba(250, 204, 21, 0.42)";
                    ctx.lineWidth = 40;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = "#fde047";
                    ctx.lineWidth = 3.5;
                    ctx.setLineDash([10, 6]);
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);
                } else {
                    const len = player.role === "eric" ? 400 : 220;
                    const ex = player.x + fwdX * len;
                    const ey = player.y + fwdY * len;
                    ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
                    ctx.lineWidth = 36;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                }
                ctx.restore();
                return;
            }

            // 通常攻撃エイムガイド
            if (player.role === "blaze") {
                // ブレイズ：横に並んだ3つの火球（-24, 0, +24）それぞれの軌道線
                const offsets = [-24, 0, 24];
                offsets.forEach((offset, idx) => {
                    const fOff = idx === 1 ? 26 : 20;
                    const sx = player.x + fwdX * fOff + perpX * offset;
                    const sy = player.y + fwdY * fOff + perpY * offset;
                    const dist = getAimRayDistance(sx, sy, angle, player.range);
                    const ex = sx + fwdX * dist;
                    const ey = sy + fwdY * dist;

                    ctx.strokeStyle = "rgba(251, 146, 60, 0.26)";
                    ctx.lineWidth = 14;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = "rgba(254, 240, 138, 0.82)";
                    ctx.lineWidth = 2.5;
                    ctx.setLineDash([10, 7]);
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = "#fde047";
                    ctx.beginPath();
                    ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
                    ctx.fill();
                });
            } else if (player.role === "titan") {
                // タイタン：横に並んだ5つのエネルギー弾（-36, -18, 0, +18, +36）それぞれの軌道線
                const offsets = [-36, -18, 0, 18, 36];
                offsets.forEach((offset, idx) => {
                    const fOff = idx === 2 ? 26 : (idx === 1 || idx === 3 ? 22 : 18);
                    const sx = player.x + fwdX * fOff + perpX * offset;
                    const sy = player.y + fwdY * fOff + perpY * offset;
                    const dist = getAimRayDistance(sx, sy, angle, player.range);
                    const ex = sx + fwdX * dist;
                    const ey = sy + fwdY * dist;

                    ctx.strokeStyle = "rgba(168, 85, 247, 0.24)";
                    ctx.lineWidth = 11;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = "rgba(233, 213, 255, 0.85)";
                    ctx.lineWidth = 2;
                    ctx.setLineDash([8, 6]);
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.fillStyle = "#d8b4fe";
                    ctx.beginPath();
                    ctx.arc(ex, ey, 3.8, 0, Math.PI * 2);
                    ctx.fill();
                });
            } else if (player.role === "viper") {
                // ヴァイパー：超長射程の細く鋭いスナイパーレーザー照準線＋先端レティクル
                const sx = player.x + fwdX * 26;
                const sy = player.y + fwdY * 26;
                const dist = getAimRayDistance(sx, sy, angle, player.range);
                const ex = sx + fwdX * dist;
                const ey = sy + fwdY * dist;

                ctx.strokeStyle = "rgba(244, 114, 182, 0.25)";
                ctx.lineWidth = 10;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();

                ctx.strokeStyle = "rgba(252, 231, 243, 0.92)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(ex, ey);
                ctx.stroke();

                // スナイパー照準レティクル
                ctx.strokeStyle = "#f472b6";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(ex, ey, 9, 0, Math.PI * 2);
                ctx.moveTo(ex - 13, ey);
                ctx.lineTo(ex + 13, ey);
                ctx.moveTo(ex, ey - 13);
                ctx.lineTo(ex, ey + 13);
                ctx.stroke();
            } else if (player.role === "saital") {
                // サイタル：外側2本(-22, +22)＋中央太め高火力1本(0)の3連貫通ライン
                const lanes = [
                    { offset: -22, bandW: 11, lineW: 2, color: "rgba(167, 243, 208, 0.78)" },
                    { offset: 22, bandW: 11, lineW: 2, color: "rgba(167, 243, 208, 0.78)" },
                    { offset: 0, bandW: 17, lineW: 3.2, color: "rgba(52, 211, 153, 0.95)" }
                ];
                lanes.forEach((lane) => {
                    const sx = player.x + fwdX * 20 + perpX * lane.offset;
                    const sy = player.y + fwdY * 20 + perpY * lane.offset;
                    const dist = getAimRayDistance(sx, sy, angle, player.range);
                    const ex = sx + fwdX * dist;
                    const ey = sy + fwdY * dist;

                    ctx.strokeStyle = lane.offset === 0 ? "rgba(52, 211, 153, 0.3)" : "rgba(110, 231, 183, 0.18)";
                    ctx.lineWidth = lane.bandW;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = lane.color;
                    ctx.lineWidth = lane.lineW;
                    ctx.setLineDash(lane.offset === 0 ? [] : [8, 6]);
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    // 先端の菱形マーカー
                    const mSize = lane.offset === 0 ? 6 : 4;
                    ctx.fillStyle = lane.offset === 0 ? "#ecfdf5" : "#6ee7b7";
                    ctx.beginPath();
                    ctx.moveTo(ex + fwdX * mSize, ey + fwdY * mSize);
                    ctx.lineTo(ex + perpX * mSize, ey + perpY * mSize);
                    ctx.lineTo(ex - fwdX * mSize, ey - fwdY * mSize);
                    ctx.lineTo(ex - perpX * mSize, ey - perpY * mSize);
                    ctx.closePath();
                    ctx.fill();
                });
            } else if (player.role === "pom") {
                const dist = Math.max(40, aimRatio * player.range);
                const tx = player.x + fwdX * dist;
                const ty = player.y + fwdY * dist;

                ctx.strokeStyle = "rgba(217, 70, 239, 0.85)";
                ctx.lineWidth = 3;
                ctx.setLineDash([8, 6]);
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.lineTo(tx, ty);
                ctx.stroke();
                ctx.setLineDash([]);

                // 着弾範囲サークル（拡大済み半径65px）
                ctx.fillStyle = "rgba(217, 70, 239, 0.22)";
                ctx.beginPath();
                ctx.arc(tx, ty, 65, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "#e879f9";
                ctx.lineWidth = 2.5;
                ctx.stroke();
            } else if (player.role === "frost") {
                const spread = Math.PI / 4;
                ctx.fillStyle = "rgba(103, 232, 249, 0.22)";
                ctx.strokeStyle = "rgba(34, 211, 238, 0.8)";
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.arc(player.x, player.y, player.range, angle - spread / 2, angle + spread / 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            } else if (player.role === "centaur") {
                const chargeRatio = Math.min(1, (player.axeChargeTimer || 0) / 5.0);
                const spreadDeg = 35 + 135 * chargeRatio;
                const halfSpread = (Math.PI * spreadDeg) / 360;
                ctx.fillStyle = chargeRatio >= 0.95 ? "rgba(250, 204, 21, 0.28)" : "rgba(56, 189, 248, 0.22)";
                ctx.strokeStyle = chargeRatio >= 0.95 ? "#facc15" : "#38bdf8";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.arc(player.x, player.y, player.range, angle - halfSpread, angle + halfSpread);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            } else if (player.role === "rearn") {
                // レアーン通常攻撃：左右に弧を描く2本の壁貫通ホーミングカーブガイド
                const ex = player.x + fwdX * player.range;
                const ey = player.y + fwdY * player.range;
                [-1, 1].forEach((side) => {
                    const ctrlX = player.x + fwdX * (player.range * 0.45) + perpX * (side * 120);
                    const ctrlY = player.y + fwdY * (player.range * 0.45) + perpY * (side * 120);

                    ctx.strokeStyle = "rgba(244, 63, 94, 0.26)";
                    ctx.lineWidth = 12;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = "rgba(254, 205, 211, 0.9)";
                    ctx.lineWidth = 2.2;
                    ctx.setLineDash([9, 6]);
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.quadraticCurveTo(ctrlX, ctrlY, ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);
                });
                ctx.fillStyle = "#f43f5e";
                ctx.beginPath();
                ctx.arc(ex, ey, 6, 0, Math.PI * 2);
                ctx.fill();
            } else if (player.role === "forever") {
                if (player.foreverUltTimer > 0) {
                    // ウルト中の5秒間：ケンタウロス最大チャージと同等の170度超広角ガイド
                    const halfSpread = (Math.PI * 170) / 360;
                    ctx.fillStyle = "rgba(250, 204, 21, 0.25)";
                    ctx.strokeStyle = "#facc15";
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.moveTo(player.x, player.y);
                    ctx.arc(player.x, player.y, 165, angle - halfSpread, angle + halfSpread);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                } else {
                    // 通常スナイプエイム線（HP1/3以下の敵探知時は壁貫通のためフル射程表示）
                    const sx = player.x + fwdX * 26;
                    const sy = player.y + fwdY * 26;
                    const dist = player.foreverHuntActive ? player.range : getAimRayDistance(sx, sy, angle, player.range);
                    const ex = sx + fwdX * dist;
                    const ey = sy + fwdY * dist;
                    const isSuper = player.foreverChargedShot;

                    ctx.strokeStyle = isSuper ? "rgba(250, 204, 21, 0.35)" : "rgba(253, 224, 71, 0.22)";
                    ctx.lineWidth = isSuper ? 16 : 9;
                    ctx.lineCap = "round";
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();

                    ctx.strokeStyle = player.foreverHuntActive ? "#fb7185" : (isSuper ? "#fef08a" : "#fde047");
                    ctx.lineWidth = isSuper ? 3 : 2;
                    if (player.foreverHuntActive) ctx.setLineDash([12, 6]);
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    ctx.strokeStyle = isSuper ? "#facc15" : "#fde047";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(ex, ey, isSuper ? 11 : 8, 0, Math.PI * 2);
                    ctx.stroke();
                }
            } else {
                const guideW = player.role === "eric" ? 36 : 32;
                const ex = player.x + fwdX * player.range;
                const ey = player.y + fwdY * player.range;
                ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
                ctx.lineWidth = guideW;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(player.x, player.y);
                ctx.lineTo(ex, ey);
                ctx.stroke();
            }

            ctx.restore();
        }

        function drawEffects() {
            // 残像
            for (const aiImg of gameState.afterimages) {
                const alpha = (aiImg.life / aiImg.maxLife) * 0.45;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = aiImg.type === "blaze_ult"
                    ? "#f97316"
                    : aiImg.type === "centaur_ult"
                    ? "#38bdf8"
                    : aiImg.type === "forever_ult"
                    ? "#facc15"
                    : "#94a3b8";
                ctx.beginPath();
                ctx.arc(aiImg.x, aiImg.y - 10, 18, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // 衝撃波リング
            for (const sw of gameState.shockwaves) {
                const progress = 1 - (sw.life / sw.maxLife);
                const r = sw.maxRadius * progress;
                const alpha = 1 - progress;
                ctx.save();
                ctx.strokeStyle = sw.color;
                ctx.globalAlpha = alpha * 0.85;
                ctx.lineWidth = 5 * (1 - progress * 0.5);
                ctx.beginPath();
                ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }

            // パーティクル
            for (const pt of gameState.particles) {
                const alpha = Math.max(0, pt.life / pt.maxLife);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = pt.color;
                ctx.beginPath();
                ctx.arc(pt.x, pt.y - 6, pt.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // ダメージ・回復フローティングテキスト
            for (const ft of gameState.floatingTexts) {
                const alpha = Math.min(1, ft.life / (ft.maxLife * 0.5));
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.font = "900 13px Inter, sans-serif";
                ctx.textAlign = "center";
                ctx.strokeStyle = "rgba(2, 6, 23, 0.9)";
                ctx.lineWidth = 3.5;
                ctx.strokeText(ft.text, ft.x, ft.y);
                ctx.fillStyle = ft.color;
                ctx.fillText(ft.text, ft.x, ft.y);
                ctx.restore();
            }
        }

        function drawTile25D(r, c, tile) {
            const x = c * TILE_SIZE;
            const y = r * TILE_SIZE;

            if (tile === 1) {
                // 2.5D 石壁
                const wallH = 22;
                ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
                ctx.fillRect(x + 4, y + 6, TILE_SIZE, TILE_SIZE);

                // 正面壁面
                ctx.fillStyle = "#1e1b2e";
                ctx.fillRect(x, y - wallH + 14, TILE_SIZE, TILE_SIZE + wallH - 14);

                // 上面天板
                ctx.fillStyle = "#332e4d";
                ctx.fillRect(x, y - wallH, TILE_SIZE, TILE_SIZE - 12);

                ctx.strokeStyle = "#4c4570";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x + 0.75, y - wallH + 0.75, TILE_SIZE - 1.5, TILE_SIZE - 13.5);
            } else if (tile === 2) {
                // ダークブッシュ（草むら）
                const player = getPlayer();
                const playerNear = player && !player.dead && Math.hypot(player.x - (x + TILE_SIZE / 2), player.y - (y + TILE_SIZE / 2)) < 90;
                ctx.save();
                if (playerNear) ctx.globalAlpha = 0.55;

                const sway = Math.sin(gameState.time * 2.5 + r + c) * 2;
                ctx.fillStyle = "#064e3b";
                ctx.beginPath();
                ctx.roundRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6, 12);
                ctx.fill();

                ctx.fillStyle = "#047857";
                ctx.beginPath();
                ctx.arc(x + 18 + sway, y + 22, 14, 0, Math.PI * 2);
                ctx.arc(x + 38 - sway, y + 24, 13, 0, Math.PI * 2);
                ctx.arc(x + 28, y + 36, 15, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = "#10b981";
                ctx.beginPath();
                ctx.arc(x + 22 + sway, y + 18, 6, 0, Math.PI * 2);
                ctx.arc(x + 35 - sway, y + 20, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else if (tile === 3) {
                // 壊せる骨箱
                const lift = 12;
                ctx.fillStyle = "#475569";
                ctx.fillRect(x + 6, y - lift + 10, TILE_SIZE - 12, TILE_SIZE - 10);
                ctx.fillStyle = "#64748b";
                ctx.fillRect(x + 6, y - lift, TILE_SIZE - 12, TILE_SIZE - 18);
                ctx.strokeStyle = "#cbd5e1";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(x + 6, y - lift, TILE_SIZE - 12, TILE_SIZE - 18);

                // 骸骨マーク
                ctx.fillStyle = "#f8fafc";
                ctx.beginPath();
                ctx.arc(x + TILE_SIZE / 2, y + 16, 6, 0, Math.PI * 2);
                ctx.fill();
            } else if (tile === 5) {
                // 松明の石柱＋炎
                const cx = x + TILE_SIZE / 2;
                const cy = y + TILE_SIZE / 2;
                ctx.fillStyle = "#27233a";
                ctx.fillRect(cx - 12, cy - 22, 24, 34);
                ctx.fillStyle = "#3f395c";
                ctx.beginPath();
                ctx.arc(cx, cy - 22, 13, 0, Math.PI * 2);
                ctx.fill();

                const flicker = Math.sin(gameState.time * 18 + r) * 2.5;
                ctx.fillStyle = "#f97316";
                ctx.beginPath();
                ctx.arc(cx, cy - 28, 8 + flicker * 0.4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#fef08a";
                ctx.beginPath();
                ctx.arc(cx, cy - 27, 4.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        function drawSoccerBall() {
            if (!gameState.soccer.active) return;
            const ball = gameState.soccer.ball;
            ctx.save();
            ctx.translate(ball.x, ball.y);

            // 影
            ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
            ctx.beginPath();
            ctx.ellipse(0, 7, ball.radius * 0.95, ball.radius * 0.48, 0, 0, Math.PI * 2);
            ctx.fill();

            if (ball.superShot) {
                const grad = ctx.createRadialGradient(0, -4, 4, 0, -4, ball.radius * 2.1);
                grad.addColorStop(0, "rgba(250, 204, 21, 0.9)");
                grad.addColorStop(1, "rgba(250, 204, 21, 0)");
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(0, -4, ball.radius * 2.1, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.translate(0, -4);
            ctx.rotate(ball.spin);
            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#0f172a";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // サッカーボールの五角形模様
            ctx.fillStyle = "#1e293b";
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const a = (i * Math.PI * 2) / 5;
                const px = Math.cos(a) * 6;
                const py = Math.sin(a) * 6;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }

        function renderHomeMenuStage() {
            ctx.fillStyle = "#09080f";
            ctx.fillRect(0, 0, viewWidth, viewHeight);

            const cx = viewWidth / 2;
            const cy = viewHeight * 0.53;

            // ステージの魔法陣＆スポットライト
            const spot = ctx.createRadialGradient(cx, cy, 15, cx, cy, Math.min(viewWidth, viewHeight) * 0.45);
            spot.addColorStop(0, "rgba(251, 191, 36, 0.22)");
            spot.addColorStop(0.55, "rgba(88, 28, 135, 0.14)");
            spot.addColorStop(1, "rgba(9, 8, 15, 0)");
            ctx.fillStyle = spot;
            ctx.beginPath();
            ctx.arc(cx, cy, Math.min(viewWidth, viewHeight) * 0.45, 0, Math.PI * 2);
            ctx.fill();

            // 台座リング
            ctx.strokeStyle = "rgba(251, 191, 36, 0.45)";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(cx, cy + 28, 86, 30, 0, 0, Math.PI * 2);
            ctx.stroke();

            const sel = getSelectedBrawlerData();
            const previewEnt = {
                role: sel.id,
                radius: 22,
                facingAngle: gameState.time * 1.15,
                walkAnim: gameState.time * 2.5,
                capePhase: gameState.time * 6.0,
                hurtFlash: 0,
                axeChargeTimer: 0,
                axeSwingAnim: 0
            };
            drawBrawlerModelOnly(ctx, previewEnt, cx, cy + 12, 2.35);

            // キャラ選択モーダル内のミニプレビューキャンバス更新
            const modalEl = document.getElementById("startModal");
            const heroCanvas = document.getElementById("heroPreviewCanvas");
            if (modalEl && !modalEl.classList.contains("hidden") && heroCanvas) {
                const hCtx = heroCanvas.getContext("2d");
                const dpr = Math.min(window.devicePixelRatio || 1, 2);
                const rect = heroCanvas.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    heroCanvas.width = Math.floor(rect.width * dpr);
                    heroCanvas.height = Math.floor(rect.height * dpr);
                    hCtx.save();
                    hCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    const hw = rect.width;
                    const hh = rect.height;
                    hCtx.clearRect(0, 0, hw, hh);

                    hCtx.strokeStyle = "rgba(251, 191, 36, 0.4)";
                    hCtx.lineWidth = 2;
                    hCtx.beginPath();
                    hCtx.ellipse(hw / 2, hh * 0.82, 44, 15, 0, 0, Math.PI * 2);
                    hCtx.stroke();

                    drawBrawlerModelOnly(hCtx, previewEnt, hw / 2, hh * 0.76, 1.45);
                    hCtx.restore();
                }
            }
        }

        function renderGame() {
            if (gameState.status === "menu") {
                renderHomeMenuStage();
                return;
            }

            ctx.fillStyle = "#09080f";
            ctx.fillRect(0, 0, viewWidth, viewHeight);

            ctx.save();
            const shakeX = gameState.camera.shake > 0 ? (Math.random() - 0.5) * gameState.camera.shake : 0;
            const shakeY = gameState.camera.shake > 0 ? (Math.random() - 0.5) * gameState.camera.shake : 0;
            ctx.translate(
                Math.round(viewWidth / 2 - gameState.camera.x + shakeX),
                Math.round(viewHeight / 2 - gameState.camera.y + shakeY)
            );

            // 1. 床・危険地帯サークル・サッカーコート描画
            drawArenaFloor();

            // 2. 滞留エリア・ジェム・エイムガイド描画
            drawZones();
            drawGems();
            drawPlayerAimGuide();

            // 3. Y座標ソートによる2.5Dオブジェクト（壁・草むら・骨箱・松明・キャラ・ボール）描画
            const renderables = [];
            const startCol = Math.max(0, Math.floor((gameState.camera.x - viewWidth / 2) / TILE_SIZE) - 1);
            const endCol = Math.min(MAP_COLS - 1, Math.ceil((gameState.camera.x + viewWidth / 2) / TILE_SIZE) + 1);
            const startRow = Math.max(0, Math.floor((gameState.camera.y - viewHeight / 2) / TILE_SIZE) - 1);
            const endRow = Math.min(MAP_ROWS - 1, Math.ceil((gameState.camera.y + viewHeight / 2) / TILE_SIZE) + 1);

            for (let r = startRow; r <= endRow; r++) {
                for (let c = startCol; c <= endCol; c++) {
                    const tile = gameState.map[r][c];
                    if (tile === 1 || tile === 2 || tile === 3 || tile === 5) {
                        renderables.push({
                            sortY: (r + 1) * TILE_SIZE,
                            draw: () => drawTile25D(r, c, tile)
                        });
                    }
                }
            }

            for (const ent of gameState.entities) {
                if (ent.dead) continue;
                renderables.push({
                    sortY: ent.y + ent.radius * 0.5,
                    draw: () => drawBrawler25D(ent)
                });
            }

            if (gameState.soccer.active) {
                renderables.push({
                    sortY: gameState.soccer.ball.y + 6,
                    draw: () => drawSoccerBall()
                });
            }

            renderables.sort((a, b) => a.sortY - b.sortY);
            for (const item of renderables) {
                item.draw();
            }

            // 4. 弾丸・エフェクト・松明光源
            drawProjectiles();
            drawEffects();
            drawTorchLights();

            ctx.restore();

            // 5. 画面ビネット ＆ バーチャルスティックUI
            drawDarkVignette();
            if (gameState.status === "playing") {
                drawVirtualSticks();
            }
        }

        // ----------------------------------------------------------------------------
        // 11. マッチ初期化 ＆ 6人顔ポートレート紹介カットイン ＆ メインアニメーションループ
        // ----------------------------------------------------------------------------
        function showMatchStartLineup(entities, onComplete) {
            gameState.status = "intro";
            const introOverlay = document.getElementById("matchIntroOverlay");
            const blueGrid = document.getElementById("introBlueGrid");
            const redGrid = document.getElementById("introRedGrid");

            const blueTeam = entities.filter((e) => e.team === "blue");
            const redTeam = entities.filter((e) => e.team === "red");

            const buildCardHtml = (ent, idx, isBlue) => {
                const borderClass = isBlue
                    ? "border-sky-400/70 bg-gradient-to-b from-sky-950/90 to-slate-950"
                    : "border-rose-500/70 bg-gradient-to-b from-rose-950/90 to-slate-950";
                const nameColor = ent.isPlayer
                    ? "text-amber-300"
                    : (isBlue ? "text-sky-200" : "text-rose-200");
                const roleData = BRAWLER_ROSTER.find((b) => b.id === ent.role);
                const roleLabel = roleData ? roleData.name : "ダークナイト";

                return `
                    <div class="rounded-2xl border-2 ${borderClass} p-2 sm:p-3 flex flex-col items-center shadow-xl">
                        <div class="w-full h-24 sm:h-32 rounded-xl bg-slate-900/90 border border-slate-700/70 overflow-hidden flex items-center justify-center mb-1.5">
                            <canvas id="portraitCanvas_${ent.id}" class="w-full h-full block"></canvas>
                        </div>
                        <div class="text-xs sm:text-base font-black ${nameColor} truncate w-full text-center">${ent.name}</div>
                        <div class="text-[10px] text-slate-400 font-bold">${roleLabel}</div>
                    </div>
                `;
            };

            blueGrid.innerHTML = blueTeam.map((e, i) => buildCardHtml(e, i, true)).join("");
            redGrid.innerHTML = redTeam.map((e, i) => buildCardHtml(e, i, false)).join("");

            introOverlay.classList.remove("hidden");

            // 各キャンバスに実物と全く同じ描画関数(drawBrawlerModelOnly)で大きな顔アップを描画
            requestAnimationFrame(() => {
                entities.forEach((ent) => {
                    const pCanvas = document.getElementById(`portraitCanvas_${ent.id}`);
                    if (!pCanvas) return;
                    const pCtx = pCanvas.getContext("2d");
                    const dpr = Math.min(window.devicePixelRatio || 1, 2);
                    const rect = pCanvas.getBoundingClientRect();
                    pCanvas.width = Math.max(120, Math.floor(rect.width * dpr));
                    pCanvas.height = Math.max(100, Math.floor(rect.height * dpr));

                    pCtx.save();
                    pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    const w = pCanvas.width / dpr;
                    const h = pCanvas.height / dpr;

                    // 背景スポットライト
                    const bgGrad = pCtx.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w * 0.6);
                    bgGrad.addColorStop(0, ent.team === "blue" ? "rgba(56, 189, 248, 0.25)" : "rgba(244, 63, 94, 0.25)");
                    bgGrad.addColorStop(1, "rgba(2, 6, 23, 0)");
                    pCtx.fillStyle = bgGrad;
                    pCtx.fillRect(0, 0, w, h);

                    // 正面を向いた実物モデルを顔アップ中心に大きく拡大描画
                    const portraitEnt = {
                        ...ent,
                        facingAngle: Math.PI * 0.5, // 正面カメラ向き
                        walkAnim: 0,
                        hurtFlash: 0,
                        inBush: false
                    };
                    drawBrawlerModelOnly(pCtx, portraitEnt, w / 2, h * 1.18, 2.55);
                    pCtx.restore();
                });
            });

            setTimeout(() => {
                introOverlay.classList.add("hidden");
                onComplete();
            }, 2400);
        }

        function initMatch() {
            gameState.status = "intro"; // ← 追加：1戦目の "ended" 状態をリセット
            if (typeof updateMyPresence === "function") updateMyPresence("in_match");
            resizeCanvas();             // ← 追加：2戦目以降もキャンバスサイズを確実に再計算
          
            const isSoccer = selectedGameMode === "kickoff_soccer";
            const isDanger = selectedGameMode === "danger_zone";
            const isKnockout = selectedGameMode === "knockout";
            gameState.map = isSoccer
                ? createSoccerArenaMap()
                : isDanger
                ? createDangerZoneArenaMap()
                : isKnockout
                ? createKnockoutArenaMap()
                : createArenaMap();
            gameState.entities = [];
            gameState.projectiles = [];
            gameState.zones = []; // ゾーン初期化追加
            gameState.gems = [];
            gameState.particles = [];
            gameState.shockwaves = [];
            gameState.floatingTexts = [];
            gameState.afterimages = [];
            gameState.gemSpawnerTimer = 1.5;
            gameState.blueGems = 0;
            gameState.redGems = 0;
            gameState.countdownTimer = 15.0;
            gameState.countdownTeam = null;
            gameState.stats = { kills: 0, damage: 0 };

            const ov = document.getElementById("respawnOverlay");
            if (ov) {
                ov.classList.add("hidden");
                ov.innerHTML = `撃破された！復活まで <span id="respawnSec" class="text-white text-lg">3</span> 秒...`;
            }

            // ノックアウト状態初期化
            gameState.knockout = {
                active: isKnockout,
                blueRounds: 0,
                redRounds: 0,
                currentRound: 1,
                roundResetTimer: 0,
                lastRoundWinner: null
            };

            // 危険地帯状態初期化
            gameState.dangerZone = {
                active: isDanger,
                x: MAP_WIDTH / 2,
                y: MAP_HEIGHT / 2,
                radius: 175,
                blueProgress: 0,
                redProgress: 0,
                bluePresent: false,
                redPresent: false,
                contested: false
            };

            // サッカー状態初期化
            gameState.soccer.active = isSoccer;
            gameState.soccer.blueGoals = 0;
            gameState.soccer.redGoals = 0;
            gameState.soccer.matchTimer = 180.0;
            gameState.soccer.suddenDeath = false;
            gameState.soccer.goalResetTimer = 0;
            gameState.soccer.lastConcedingTeam = null;
            gameState.soccer.ball = {
                x: MAP_WIDTH / 2,
                y: MAP_HEIGHT / 2,
                vx: 0,
                vy: 0,
                radius: 15,
                holderId: null,
                lastKickerId: null,
                lastKickerTeam: null,
                pickupCooldown: 0,
                superShot: false,
                spin: 0
            };

            // 上部HUDの表示切り替え（ダイヤ or サッカータイマー or 危険地帯 or ノックアウト）
            document.getElementById("blueGemCount").textContent = isDanger ? "0%" : "0";
            document.getElementById("redGemCount").textContent = isDanger ? "0%" : "0";
            if (isSoccer) {
                document.getElementById("hudDiamondIcon").classList.add("hidden");
                document.getElementById("hudSoccerClock").classList.remove("hidden");
                document.getElementById("hudSoccerClock").textContent = "03:00";
                document.getElementById("hudObjectiveLabel").textContent = "FIRST TO 2 GOALS";
            } else if (isDanger) {
                document.getElementById("hudDiamondIcon").classList.add("hidden");
                document.getElementById("hudSoccerClock").classList.remove("hidden");
                document.getElementById("hudSoccerClock").textContent = "ZONE";
                document.getElementById("hudObjectiveLabel").textContent = "CAPTURE 100%";
            } else if (isKnockout) {
                document.getElementById("hudDiamondIcon").classList.add("hidden");
                document.getElementById("hudSoccerClock").classList.remove("hidden");
                document.getElementById("hudSoccerClock").textContent = "ROUND 1";
                document.getElementById("hudObjectiveLabel").textContent = "FIRST TO 3 WINS";
            } else {
                document.getElementById("hudDiamondIcon").classList.remove("hidden");
                document.getElementById("hudSoccerClock").classList.add("hidden");
                document.getElementById("hudObjectiveLabel").textContent = "10 DIAMONDS";
            }

            const selectedData = getSelectedBrawlerData();
            const catMeta = getCategoryMeta(selectedData.category);

            // 左上HUDを選択キャラに合わせて更新
            document.getElementById("hudCharIcon").innerHTML = selectedData.svgMini;
            document.getElementById("hudCharName").textContent = `${selectedData.enName} (${selectedData.name})`;
            const hudCatEl = document.getElementById("hudCharCategory");
            hudCatEl.textContent = catMeta.name;
            hudCatEl.className = `px-1.5 py-0.5 rounded text-[9px] font-bold border ${catMeta.badgeClass}`;

// 青チーム（左陣地）：ソロなら味方ボット2体、協力マルチなら自分＋フレンド＋味方ボット1体
            const blueSpawnX = 2.5 * TILE_SIZE;
            if (window.coopState && window.coopState.active && window.coopState.roomData) {
                const rData = window.coopState.roomData;
                const isHost = window.coopState.role === "host";
                const myInfo = isHost ? rData.host : rData.guest;
                const friendInfo = isHost ? rData.guest : rData.host;

                const myEntity = createBrawler(1, `${myInfo.name} (YOU)`, "blue", myInfo.charId, true, blueSpawnX, MAP_HEIGHT * 0.35);
                const friendEntity = createBrawler(2, `${friendInfo.name} (FRIEND)`, "blue", friendInfo.charId, false, blueSpawnX, MAP_HEIGHT * 0.65);
                friendEntity.isCoopFriend = true; // AIに動かさせず通信座標で動かす印

                const allyRole2 = myInfo.charId === "eric" ? "knight" : "eric";
                const allyName2 = myInfo.charId === "eric" ? "ダークナイト" : "ハヤテ";
                const botEntity = createBrawler(3, allyName2, "blue", allyRole2, false, blueSpawnX, MAP_HEIGHT * 0.5);

                gameState.entities.push(myEntity, friendEntity, botEntity);
            } else {
                const allyRole1 = selectedData.id === "saital" ? "titan" : "saital";
                const allyName1 = selectedData.id === "saital" ? "クロガネ" : "ミコト";
                const allyRole2 = selectedData.id === "eric" ? "knight" : "eric";
                const allyName2 = selectedData.id === "eric" ? "ダークナイト" : "ハヤテ";

                gameState.entities.push(
                    createBrawler(1, `${selectedData.name} (YOU)`, "blue", selectedData.id, true, blueSpawnX, MAP_HEIGHT * 0.5),
                    createBrawler(2, allyName1, "blue", allyRole1, false, blueSpawnX, MAP_HEIGHT * 0.3),
                    createBrawler(3, allyName2, "blue", allyRole2, false, blueSpawnX, MAP_HEIGHT * 0.7)
                );
            }
            // 赤チーム（右陣地）：1人ずつ個別の名前（日本語名含む）がついた敵ボット3体
            const redSpawnX = MAP_WIDTH - 2.5 * TILE_SIZE;
            gameState.entities.push(
                createBrawler(4, "クリムゾン", "red", "blaze", false, redSpawnX, MAP_HEIGHT * 0.5),
                createBrawler(5, "クロガネ", "red", "titan", false, redSpawnX, MAP_HEIGHT * 0.28),
                createBrawler(6, "ベノム", "red", "viper", false, redSpawnX, MAP_HEIGHT * 0.72)
            );

            // 初期ジェムを中央に2個配置（ダイヤハント系のみ）
            if (!isSoccer && !isDanger && !isKnockout) {
                spawnGem(MAP_WIDTH / 2 - 20, MAP_HEIGHT / 2, false);
                spawnGem(MAP_WIDTH / 2 + 20, MAP_HEIGHT / 2, false);
            }

            gameState.camera.x = blueSpawnX + 180;
            gameState.camera.y = MAP_HEIGHT * 0.5;

            document.getElementById("homeLobbyOverlay").classList.add("hidden");
            document.getElementById("startModal").classList.add("hidden");
            document.getElementById("modeSelectModal").classList.add("hidden");
            document.getElementById("resultModal").classList.add("hidden");
            document.getElementById("countdownBanner").classList.add("hidden");

            // 6人の顔画像＆名前カットイン画面を表示してからバトル開始
            showMatchStartLineup(gameState.entities, () => {
                gameState.status = "playing";
                document.getElementById("hudLayer").classList.remove("hidden");
                if (isSoccer) {
                    showToast(`${selectedData.name}でキックオフ！先に2点決めて勝利しろ！`);
                } else if (isDanger) {
                    showToast(`${selectedData.name}で出撃！中央の危険地帯を100%まで踏め！`);
                } else if (isKnockout) {
                    showToast(`ROUND 1 START！死んだらアウト、先に3本取れ！`);
                } else {
                    showToast(`${selectedData.name}で出撃！中央のダイヤモンドを10個集めろ！`);
                }
            });
        }

        function returnToCharacterSelect() {
            gameState.status = "menu";
            document.getElementById("resultModal").classList.add("hidden");
            document.getElementById("hudLayer").classList.add("hidden");
            document.getElementById("respawnOverlay").classList.add("hidden");
            document.getElementById("matchIntroOverlay").classList.add("hidden");
            document.getElementById("startModal").classList.add("hidden");
            document.getElementById("modeSelectModal").classList.add("hidden");
            document.getElementById("homeLobbyOverlay").classList.remove("hidden");
            updateHomeLobbyUI();
        }

        // ホーム画面・モーダルUIボタンイベントバインド
        document.getElementById("openModeSelectBtn").addEventListener("click", () => {
            renderModeSelectModal();
            document.getElementById("modeSelectModal").classList.remove("hidden");
        });

        document.getElementById("closeModeSelectBtn").addEventListener("click", () => {
            document.getElementById("modeSelectModal").classList.add("hidden");
        });

        document.getElementById("openBrawlerSelectBtn").addEventListener("click", () => {
            renderCharacterSelectUI();
            document.getElementById("startModal").classList.remove("hidden");
        });

        document.getElementById("closeBrawlerSelectBtn").addEventListener("click", () => {
            updateHomeLobbyUI();
            document.getElementById("startModal").classList.add("hidden");
        });

        document.getElementById("startBattleBtn").addEventListener("click", () => {
            updateHomeLobbyUI();
            document.getElementById("startModal").classList.add("hidden");
        });

        document.getElementById("homePlayBtn").addEventListener("click", async () => {
            await sound.init();
            initMatch();
        });

        const playAgainEl = document.getElementById("playAgainBtn");
        if (playAgainEl) {
            playAgainEl.addEventListener("click", async () => {
                await sound.init();
                initMatch();
            });
        }

        const backToSelectEl = document.getElementById("backToSelectBtn");
        if (backToSelectEl) backToSelectEl.addEventListener("click", returnToCharacterSelect);
        document.getElementById("menuReturnBtn").addEventListener("click", returnToCharacterSelect);

        function toggleSoundUI() {
            const isOn = sound.toggle();
            document.getElementById("soundOnIcon").classList.toggle("hidden", !isOn);
            document.getElementById("soundOffIcon").classList.toggle("hidden", isOn);
            const homeBtn = document.getElementById("homeSoundBtn");
            if (homeBtn) homeBtn.innerHTML = `<span class="text-base">${isOn ? "🔊" : "🔇"}</span>`;
        }

        document.getElementById("soundToggleBtn").addEventListener("click", async () => {
            await sound.init();
            toggleSoundUI();
        });

        document.getElementById("homeSoundBtn").addEventListener("click", async () => {
            await sound.init();
            toggleSoundUI();
        });

        // メインループ（requestAnimationFrame）
        let lastFrameTime = performance.now();
        function gameLoop(now) {
            const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
            lastFrameTime = now;

            updateGame(dt);
            renderGame();

            requestAnimationFrame(gameLoop);
        }

        function bootGame() {
            renderCharacterSelectUI();
            updateHomeLobbyUI();
            selectGameMode(selectedGameMode, false);
            resizeCanvas();
            updateDefaultStickPositions();
            lastFrameTime = performance.now();
            requestAnimationFrame(gameLoop);
        }

        if (document.readyState === "complete") {
            bootGame();
        } else {
            window.addEventListener("load", bootGame);
// ============================================================================
// フェーズ3：フレンド協力マルチプレイシステム（名前重複ゼロ・完全独立版）
// ============================================================================
const coopDb = window._coopDb;
const coopAuth = window._coopAuth;
const coopDoc = (...args) => window._coopDoc(...args);
const coopSetDoc = (...args) => window._coopSetDoc(...args);
const coopUpdateDoc = (...args) => window._coopUpdateDoc(...args);
const coopOnSnapshot = (...args) => window._coopOnSnapshot(...args);
window.coopState = {
  active: false,
  roomId: null,
  role: null,
  roomData: null,
  unsubscribeRoom: null,
  syncTimer: null
};

const COOP_MODE_LABELS = {
  diamond_hunt: "💎 ダイヤモンドハント",
  kickoff_soccer: "⚽ キックオフサッカー",
  danger_zone: "☣️ 危険地帯",
  knockout: "💀 ノックアウト"
};

window.handleIncomingCoopInvite = function(userData) {
  const invite = userData?.coopInvite;
  const banner = document.getElementById("coopInviteBanner");
  const textEl = document.getElementById("coopInviteText");
  if (!banner || !textEl) return;

  if (invite && invite.roomId && !window.coopState.active) {
    if (Date.now() - (invite.createdAt || 0) < 60000) {
      textEl.textContent = `${invite.fromName} さんから協力バトルの招待！`;
      banner.dataset.roomId = invite.roomId;
      banner.classList.remove("hidden");
      return;
    }
  }
  banner.classList.add("hidden");
};

window.inviteFriendToCoop = async function(friendUid, friendName) {
  const user = coopAuth.currentUser;
  if (!user) {
    alert("ログイン情報が見つかりません。再読み込みしてください。");
    return;
  }
  try {
    const roomId = `coop_${user.uid}_${Date.now()}`;
    const myName = (typeof playerStats !== "undefined" && playerStats.username) ? playerStats.username : "プレイヤー";
    const myCharId = (typeof selectedData !== "undefined" && selectedData.id) ? selectedData.id : "blaze";
    const myCharName = (typeof selectedData !== "undefined" && selectedData.name) ? selectedData.name : "ブレイズ";
    const mode = (typeof selectedGameMode !== "undefined") ? selectedGameMode : "diamond_hunt";

    await coopSetDoc(coopDoc(coopDb, "rooms", roomId), {
      status: "lobby",
      mode: mode,
      host: {
        uid: user.uid,
        name: myName,
        charId: myCharId,
        charName: myCharName,
        ready: true
      },
      guest: {
        uid: friendUid,
        name: friendName,
        charId: "saital",
        charName: "ミコト",
        joined: false,
        ready: false
      },
      hostState: null,
      guestState: null,
      updatedAt: Date.now()
    });

    await coopUpdateDoc(coopDoc(coopDb, "users", friendUid), {
      coopInvite: {
        roomId: roomId,
        fromUid: user.uid,
        fromName: myName,
        createdAt: Date.now()
      }
    });

    document.getElementById("friendsModal")?.classList.add("hidden");
    enterCoopRoom(roomId, "host");
  } catch (err) {
    console.error(err);
    alert("招待送信エラー: " + err.message);
  }
};

document.getElementById("acceptCoopInviteBtn")?.addEventListener("click", async () => {
  const banner = document.getElementById("coopInviteBanner");
  const roomId = banner?.dataset.roomId;
  const user = coopAuth.currentUser;
  if (!roomId || !user) return;

  try {
    banner.classList.add("hidden");
    await coopUpdateDoc(coopDoc(coopDb, "users", user.uid), { coopInvite: null });

    const myCharId = (typeof selectedData !== "undefined" && selectedData.id) ? selectedData.id : "saital";
    const myCharName = (typeof selectedData !== "undefined" && selectedData.name) ? selectedData.name : "ミコト";

    await coopUpdateDoc(coopDoc(coopDb, "rooms", roomId), {
      "guest.joined": true,
      "guest.ready": false,
      "guest.charId": myCharId,
      "guest.charName": myCharName
    });

    enterCoopRoom(roomId, "guest");
  } catch (err) {
    alert("ルーム参加エラー: " + err.message);
  }
});

document.getElementById("declineCoopInviteBtn")?.addEventListener("click", async () => {
  const banner = document.getElementById("coopInviteBanner");
  if (banner) banner.classList.add("hidden");
  const user = coopAuth.currentUser;
  if (user) {
    await coopUpdateDoc(coopDoc(coopDb, "users", user.uid), { coopInvite: null });
  }
});

function enterCoopRoom(roomId, role) {
  window.leaveCoopRoom(false);
  window.coopState.active = true;
  window.coopState.roomId = roomId;
  window.coopState.role = role;

  const modal = document.getElementById("coopRoomModal");
  modal?.classList.remove("hidden");

  const modeSelect = document.getElementById("coopRoomModeSelect");
  const readyBtn = document.getElementById("coopReadyToggleBtn");
  const startBtn = document.getElementById("coopStartMatchBtn");

  if (role === "host") {
    modeSelect?.classList.remove("hidden");
    startBtn?.classList.remove("hidden");
    readyBtn?.classList.add("hidden");
  } else {
    modeSelect?.classList.add("hidden");
    startBtn?.classList.add("hidden");
    readyBtn?.classList.remove("hidden");
  }

  window.coopState.unsubscribeRoom = coopOnSnapshot(coopDoc(coopDb, "rooms", roomId), (snap) => {
    if (!snap.exists()) {
      alert("ルームが解散されました。");
      window.leaveCoopRoom(false);
      return;
    }
    const data = snap.data();
    window.coopState.roomData = data;

    if (data.status === "closed") {
      alert("ホストがルームを解散しました。");
      window.leaveCoopRoom(false);
      return;
    }

    renderCoopLobbyUI(data);

    if (data.status === "playing" && typeof gameState !== "undefined" && gameState.status !== "intro" && gameState.status !== "playing") {
      modal?.classList.add("hidden");
      if (typeof selectGameMode === "function") selectGameMode(data.mode, false);
      if (typeof startGame === "function") {
        startGame();
      } else {
        document.getElementById("homeScreen")?.classList.add("hidden");
        document.getElementById("hudLayer")?.classList.remove("hidden");
        if (typeof initMatch === "function") initMatch();
      }
      startCoopBattleSync();
    }

    if (data.status === "playing" && typeof gameState !== "undefined" && (gameState.status === "intro" || gameState.status === "playing")) {
      applyRemoteCoopPacket(data);
    }
  });
}

function renderCoopLobbyUI(data) {
  const modeLabel = document.getElementById("coopRoomModeLabel");
  const modeSelect = document.getElementById("coopRoomModeSelect");
  const hostSlot = document.getElementById("coopHostSlot");
  const guestSlot = document.getElementById("coopGuestSlot");
  const statusMsg = document.getElementById("coopRoomStatusMsg");
  const startBtn = document.getElementById("coopStartMatchBtn");
  const readyBtn = document.getElementById("coopReadyToggleBtn");

  if (modeLabel) modeLabel.textContent = COOP_MODE_LABELS[data.mode] || data.mode;
  if (modeSelect && window.coopState.role === "host") modeSelect.value = data.mode;

  if (hostSlot) {
    hostSlot.innerHTML = `
      <div class="flex items-center gap-2.5">
        <span class="text-lg">👑</span>
        <div>
          <div class="text-sm font-black text-white">${data.host.name} <span class="text-[10px] text-cyan-300">(ホスト)</span></div>
          <div class="text-[11px] text-cyan-200">使用キャラ: <b>${data.host.charName}</b></div>
        </div>
      </div>
      <span class="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-black">READY</span>
    `;
  }

  if (guestSlot) {
    if (!data.guest.joined) {
      guestSlot.innerHTML = `
        <div class="flex items-center gap-2.5">
          <span class="text-lg animate-pulse">⏳</span>
          <div>
            <div class="text-sm font-black text-slate-300">${data.guest.name} を招待中...</div>
            <div class="text-[11px] text-slate-500">相手が「参加する」を押すのを待っています</div>
          </div>
        </div>
        <span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 text-xs font-bold">待機中</span>
      `;
    } else {
      guestSlot.innerHTML = `
        <div class="flex items-center gap-2.5">
          <span class="text-lg">🤝</span>
          <div>
            <div class="text-sm font-black text-white">${data.guest.name} <span class="text-[10px] text-emerald-300">(フレンド)</span></div>
            <div class="text-[11px] text-emerald-200">使用キャラ: <b>${data.guest.charName}</b></div>
          </div>
        </div>
        <span class="px-2.5 py-1 rounded-lg ${data.guest.ready ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-amber-500/20 text-amber-300 border border-amber-500/40"} text-xs font-black">
          ${data.guest.ready ? "READY!" : "準備中..."}
        </span>
      `;
    }
  }

  if (window.coopState.role === "host") {
    const canStart = data.guest.joined && data.guest.ready;
    if (startBtn) {
      startBtn.disabled = !canStart;
      startBtn.classList.toggle("opacity-40", !canStart);
    }
    if (statusMsg) {
      statusMsg.textContent = !data.guest.joined
        ? "フレンドの参加を待っています..."
        : !data.guest.ready
        ? "フレンドが「準備OK」を押すと開始できます！"
        : "✅ 全員準備完了！「協力バトル開始！」を押してください！";
    }
  } else {
    if (readyBtn) {
      readyBtn.textContent = data.guest.ready ? "⏸ 準備を解除する" : "✋ 準備OKにする";
    }
    if (statusMsg) {
      statusMsg.textContent = data.guest.ready
        ? "ホストがバトルを開始するのを待っています..."
        : "準備ができたら「準備OKにする」を押してください！";
    }
  }
}

document.getElementById("coopRoomModeSelect")?.addEventListener("change", async (e) => {
  if (!window.coopState.active || window.coopState.role !== "host") return;
  await coopUpdateDoc(coopDoc(coopDb, "rooms", window.coopState.roomId), { mode: e.target.value });
});

document.getElementById("coopReadyToggleBtn")?.addEventListener("click", async () => {
  if (!window.coopState.active || window.coopState.role !== "guest" || !window.coopState.roomData) return;
  const nextReady = !window.coopState.roomData.guest.ready;
  await coopUpdateDoc(coopDoc(coopDb, "rooms", window.coopState.roomId), { "guest.ready": nextReady });
});

document.getElementById("coopStartMatchBtn")?.addEventListener("click", async () => {
  if (!window.coopState.active || window.coopState.role !== "host" || !window.coopState.roomData) return;
  if (!window.coopState.roomData.guest.joined || !window.coopState.roomData.guest.ready) return;
  await coopUpdateDoc(coopDoc(coopDb, "rooms", window.coopState.roomId), { status: "playing" });
});

window.leaveCoopRoom = async function(notifyFirestore = true) {
  if (window.coopState.syncTimer) clearInterval(window.coopState.syncTimer);
  if (window.coopState.unsubscribeRoom) window.coopState.unsubscribeRoom();
  const prevRoomId = window.coopState.roomId;
  const prevRole = window.coopState.role;

  window.coopState.active = false;
  window.coopState.roomId = null;
  window.coopState.role = null;
  window.coopState.roomData = null;
  window.coopState.syncTimer = null;
  window.coopState.unsubscribeRoom = null;

  document.getElementById("coopRoomModal")?.classList.add("hidden");

  if (notifyFirestore && prevRoomId) {
    try {
      if (prevRole === "host") {
        await coopUpdateDoc(coopDoc(coopDb, "rooms", prevRoomId), { status: "closed" });
      } else {
        await coopUpdateDoc(coopDoc(coopDb, "rooms", prevRoomId), { "guest.joined": false, "guest.ready": false });
      }
    } catch (e) {}
  }
};

document.getElementById("leaveCoopRoomBtn")?.addEventListener("click", () => window.leaveCoopRoom(true));

function startCoopBattleSync() {
  if (window.coopState.syncTimer) clearInterval(window.coopState.syncTimer);
  window.coopState.syncTimer = setInterval(async () => {
    if (!window.coopState.active || !window.coopState.roomId || typeof gameState === "undefined" || gameState.status === "ended") return;
    const me = gameState.entities.find((e) => e.isPlayer);
    if (!me) return;

    const field = window.coopState.role === "host" ? "hostState" : "guestState";
    try {
      await coopUpdateDoc(coopDoc(coopDb, "rooms", window.coopState.roomId), {
        [field]: {
          x: Math.round(me.x),
          y: Math.round(me.y),
          vx: Math.round(me.vx),
          vy: Math.round(me.vy),
          angle: Number(me.facingAngle.toFixed(2)),
          hp: Math.round(me.hp),
          dead: !!me.dead,
          gems: me.gems || 0
        }
      });
    } catch (e) {}
  }, 100);
}

function applyRemoteCoopPacket(data) {
  const remote = window.coopState.role === "host" ? data.guestState : data.hostState;
  if (!remote || typeof gameState === "undefined") return;
  const friendEntity = gameState.entities.find((e) => e.isCoopFriend);
  if (!friendEntity) return;

  friendEntity.x += (remote.x - friendEntity.x) * 0.45;
  friendEntity.y += (remote.y - friendEntity.y) * 0.45;
  friendEntity.vx = remote.vx;
  friendEntity.vy = remote.vy;
  friendEntity.facingAngle = remote.angle;
  friendEntity.hp = remote.hp;
  friendEntity.dead = remote.dead;
  friendEntity.gems = remote.gems;
  if (Math.hypot(remote.vx, remote.vy) > 5) {
    friendEntity.walkAnim += 0.25;
  }
}
        }
