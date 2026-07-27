# desknet's NEO v6.0 R1.0 画面構造調査メモ

このドキュメントは、desknet's NEO v6.0 R1.0の「電子会議室」新着情報画面のHTML構造を
調査した結果を記録するためのものです。

**重要な注記**: 以下、実機で確認できた項目には「確認済み」、確認できていない項目には
明確に「未確認」と記載します。未確認の項目を確認済みであるかのように記載することは
しません。実画面のHTMLがさらに提供され次第、このドキュメントと
`src/desknets/forum-parser.js` / `src/desknets/authentication-detector.js` の
セレクターを更新してください。

## 確認した画面

- **確認済み**: 電子会議室の新着情報一覧（新着トピックの行が`<tr>`要素として並ぶ
  画面）のHTML断片を実機から入手し、匿名化のうえ
  `tests/fixtures/desknets-v6-new-arrivals.html` に反映済みです。
- **未確認**: ログイン切れ画面・エラー画面・アクセス権限がない場合の画面。

## 新着情報画面のURL形式

- **確認済み**: desknet's NEOの電子会議室はハッシュルーティングを採用しています。
  ベースとなるCGIスクリプトのURL（例:
  `http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on`）に対して、
  トピックへのリンクはURLのハッシュ部分（例: `#cmd=forumalist&fid=8&tid=2319&init=1`）で
  表現されます。`fid`（会議室ID）・`tid`（トピックID）はハッシュ内のクエリ文字列として
  格納されており、通常の`URLSearchParams`（`url.searchParams`）では取得できません。
  `src/desknets/url-utils.js` の `extractHashParam()` でハッシュ部分を
  `URLSearchParams`として解析します。
- 設定画面には、電子会議室の新着情報画面そのもののURL（ベースURLではなく）を
  登録することを案内しています。トップ画面URLでは新着情報のHTMLが取得できない
  可能性があるため注意が必要です。

## 認証切れ時の遷移

- **未確認**。ログイン画面へのリダイレクト、401/403エラー、専用のセッション切れ画面の
  いずれになるかは実画面で確認する必要があります。
- 本実装では `src/desknets/authentication-detector.js` に、一般的なグループウェアで
  見られるパターン（`input[type=password]` の存在、「ログイン」「セッション」等の
  キーワード）をヒューリスティックとして実装していますが、これは推測に基づく
  暫定実装です。

## 新着情報取得による既読状態への影響

- **未確認**。新着情報画面をGETで取得するだけで投稿が既読になる仕様かどうかは、
  実機で検証する必要があります。
- 本実装ではGETリクエストのみを行い、POST・更新・削除・既読化API等は一切呼び出して
  いません。ただし、desknet's NEO側の実装によっては、新着情報画面の閲覧自体が
  既読化のトリガーになっている可能性があり、その場合は通常のブラウザ操作で
  画面を開いたときと同じ影響が生じます（拡張機能が既読状態を追加で変更することは
  ありません）。

## 投稿単位（確認済み）

新着情報画面は「投稿」ではなく、各トピックの最新状態を1行（`<tr>`）で表示する
一覧のようです。投稿単位の識別は、次の手がかりで最も近い`<tr>`要素を単位として
扱います。

```javascript
const topicLinks = Array.from(
  doc.querySelectorAll("a.jforum-topiclink[data-fid][data-tid]")
);
const rows = topicLinks.map((link) => link.closest("tr")).filter(Boolean);
```

同じ`tr`が複数回選ばれないよう、`Set`で重複排除しています（`:has()`セレクターには
依存していません）。

この画面が「投稿単位」ではなく「トピックの最新投稿概要」を表示している可能性がある
ため、同一トピックへ短時間に複数投稿された場合、途中の投稿を個別に検知できない
可能性があります（詳細はREADMEの制限事項を参照）。

## 会議室リンク・会議室名・会議室ID（確認済み）

- 会議室リンク: `a.jforum-forumlink[data-fid]`
- 会議室名: リンクの`title`属性を優先し、無ければ`textContent`
- 会議室ID: `forumLink.dataset.fid` → `topicLink.dataset.fid` →
  ハッシュパラメーター`fid` → 取得できなければ`null`

## トピックリンク・トピック名・トピックID（確認済み）

- トピックリンク: `a.jforum-topiclink[data-fid][data-tid]`
- トピック名: リンクの`title`属性を優先し、無ければ`textContent`。
  対象トピック判定は完全一致のため、前後の空白・改行のみ除去し、内部の連続空白の
  変換・大文字小文字変換・全角半角変換は行いません。
- トピックID: `topicLink.dataset.tid` → ハッシュパラメーター`tid` →
  取得できなければ`null`
- 投稿IDに相当する属性は見当たりませんでした（後述の識別キーを参照）。

## 投稿概要（確認済み）

`.forum-top-list-memo`のテキストを使用します。`<br>`要素は改行として扱ったうえで
（`textContent`だけでは`<br>`の前後が連結されてしまうため、`<br>`をテキストノードの
改行に置き換えてから抽出）、通知表示用には連続する空白・改行を単一の半角スペースへ
正規化し、80〜120文字程度に切り詰めます。HTMLはそのまま保存・表示せず、
`textContent`（＋`<br>`置換）だけを使用します。

## 投稿者（確認済み）

`.forum-top-list-name span`の`title`属性を優先し、無ければ同要素の`textContent`、
それも無ければ`.forum-top-list-name`全体の`textContent`を使用します。

## 投稿日時（確認済み）

`.forum-top-list-date`のテキスト（例: `07/24 15:14`）をそのまま使用します。年が
含まれていないため、初期版では年を無理に補完していません。前後の空白・改行のみ
除去して識別キーに使用します。

## 未読行のCSSクラス（確認済み、ただし検知の主軸にはしない）

未読の行には`forum-unread`・`unread`というクラスが付与されています。ただし、
desknet's NEO側で既読状態が変わった後も同じ投稿を安定して識別できるようにするため、
新着判定はCSSクラスの有無だけに依存せず、投稿内容から作った識別キー（後述）で
判定します。

## 対象URLの取得方法（確認済み）

トピックリンクの`href`（ハッシュのみの相対URL、例:
`#cmd=forumalist&fid=8&tid=2319&init=1`）を、設定済みの新着情報画面URLに対して
`new URL(href, documentBaseUrl)`で解決します。これにより、生成されるURLは元の
新着情報画面URLのオリジン・パス・通常のクエリ文字列を維持したまま、ハッシュ部分
だけがトピック表示用に置き換わります。

```text
設定URL:
http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on

生成URL（トピックリンクのhrefを解決した結果）:
http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on#cmd=forumalist&fid=8&tid=2319&init=1
```

通知クリック時・「電子会議室を開く」時は、この生成URLまたは設定URLと同一オリジンで
あることを必ず確認したうえで開きます。

## 新着識別キー（確認済みの構造にもとづく設計）

投稿IDに相当する属性が見当たらないため、次の値を組み合わせてSHA-256でハッシュ化した
ものを識別キーとしています（`src/shared/text-utils.js` の `buildCompositeKeySource`）。

- 会議室ID
- トピックID
- トピック名
- 投稿者
- 投稿日時
- 投稿概要

同一トピックへの新規投稿によって投稿者・投稿日時・投稿概要のいずれかが変化すれば、
異なる識別キーとなり新着として検知できます。投稿本文や職員名そのものは
`chrome.storage.local`へ保存せず、ハッシュ値だけを保存します。

## 対象トピックの照合方法（v0.2.0、確認済みの構造にもとづく設計）

v0.2.0では、通知対象トピックの設定に会議室ID（`fid`）・トピックID（`tid`）を
保存し、新着情報画面から取得した投稿の`roomId`・`topicId`（＝`data-fid`・
`data-tid`から取得した値）と照合します（`src/desknets/topic-matcher.js`）。

優先順位:

1. 設定側の`forumId`・`topicId`の両方が、投稿側の`roomId`・`topicId`と一致する
2. `forumId`・`topicId`を持たない設定（旧バージョンからの移行直後など）に限り、
   トピック名の完全一致で照合する
3. 上記のいずれにも一致しない投稿は対象外とする

この方式により、電子会議室側でトピック名が変更されても、`fid`・`tid`が
変わらなければ同一トピックとして継続して検知できます。

## 採用したDOMセレクター（優先順位）

`src/desknets/forum-parser.js` は、desknet's NEO v6専用パーサー
（`PARSER_MODE.DESKNETS_V6`）を最優先で実行します。トピックリンクが1件も
見つからない場合にのみ、以下の汎用パーサー（実画面未確認の暫定実装）へ
フォールバックします。

**desknet's NEO v6専用（確認済み）**

1. 投稿候補: `a.jforum-topiclink[data-fid][data-tid]` の最寄りの`tr`
2. 会議室名/ID: `a.jforum-forumlink[data-fid]`
3. トピック名/ID: `a.jforum-topiclink[data-fid][data-tid]`
4. 投稿概要: `.forum-top-list-memo`
5. 投稿者: `.forum-top-list-name span`
6. 投稿日時: `.forum-top-list-date`

**汎用パーサー（実画面未確認、フォールバック用）**

1. `[data-post-id], [data-topic-post-id], [data-forum-post]`（識別子ベース）
2. `[data-room-name][data-topic-name], [data-room-id][data-topic-id]`（data-*属性）
3. `#newArrivalList li, #newArrivalList tr, ...`（ラベル文字列・相対DOM構造）
4. `table.newArrivals tr, ul.newArrivals li, ...`（CSSクラス名、最終手段）

## セレクターの安定性評価

- `jforum-topiclink` / `jforum-forumlink` / `forum-top-list-*` は実機確認済みの
  クラス名であり、desknet's NEO（jForumベース）のテンプレートに由来すると
  考えられるため、同一バージョン内では比較的安定していると考えられます。
  ただし、カスタマイズや将来のバージョンアップで変更される可能性は残ります。
- 汎用パーサーのセレクターは、実画面ではなく一般的な業務グループウェアの
  新着情報一覧を想定した**仮の設計**のままです。

## 将来の画面変更時に確認すべき箇所

- desknet's NEOのバージョンアップやカスタマイズによりHTML構造が変わった場合は、
  以下を確認してください。
  1. `a.jforum-topiclink[data-fid][data-tid]` に相当する、トピックへのリンク要素
  2. `a.jforum-forumlink[data-fid]` に相当する、会議室へのリンク要素
  3. `.forum-top-list-memo` / `.forum-top-list-name` / `.forum-top-list-date` に
     相当する、投稿概要・投稿者・投稿日時の要素
  4. ハッシュルーティングのパラメーター名（`fid`・`tid`）
  5. ログイン切れ・エラー画面のHTML構造（`src/desknets/authentication-detector.js`、
     未確認のまま）
- 変更が必要な場合は、`src/desknets/forum-parser.js` と
  `src/desknets/authentication-detector.js` の2ファイルのみを修正すれば
  対応できるように設計している。
- `tests/fixtures/desknets-v6-new-arrivals.html` を実際の画面差分に合わせて
  更新し、`tests/desknets-v6-parser.test.js` で解析結果を検証すること。
