# desknet's NEO v6.0 R1.0 画面構造と解析仕様

desknet's NEO v6.0 R1.0の「電子会議室」新着情報画面について、実機のHTMLから確認した
構造と、それにもとづく解析・照合の仕様をまとめる。実装は
`src/desknets/forum-parser.js`・`src/desknets/authentication-detector.js`・
`src/desknets/url-utils.js` に対応する。

匿名化した実画面のHTML断片は `tests/fixtures/desknets-v6-new-arrivals.html` にあり、
`tests/desknets-v6-parser.test.js` で解析結果を検証している。

## 新着情報画面のURL形式

電子会議室はハッシュルーティングを採用している。ベースとなるCGIスクリプトのURL（例:
`http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on`）に対し、
トピックへのリンクはハッシュ部分（例: `#cmd=forumalist&fid=8&tid=2319&init=1`）で
表現される。

`fid`（会議室ID）・`tid`（トピックID）はハッシュ内のクエリ文字列として格納されるため、
`url.searchParams` では取得できない。`src/desknets/url-utils.js` の `getHashParams()` で
ハッシュ文字列を `URLSearchParams` として解析する。

設定画面には、ベースURLやトップ画面ではなく、新着情報画面そのもののURLを登録するよう
案内している。トップ画面URLでは新着情報のHTMLを取得できない。

## 投稿の単位

新着情報画面は「投稿」単位ではなく、各トピックの最新状態を1行（`<tr>`）で表示する
一覧である。`a.jforum-topiclink[data-fid][data-tid]` を手がかりに最寄りの`<tr>`を
投稿候補の行として扱う。1つの行に複数のトピックリンクが含まれる場合でも、同じ行を
二重に数えないよう重複を除外する。

この方式のため、同一トピックへ短時間に複数投稿された場合、途中の投稿を個別に検知
できない（READMEの「既知の制限」を参照）。

## DOMセレクター

`src/desknets/forum-parser.js` は、desknet's NEO v6専用パーサー
（`PARSER_MODE.DESKNETS_V6`）を最優先で実行し、トピックリンクが1件も見つからない
場合にのみ汎用パーサーへフォールバックする。

### desknet's NEO v6専用（実機確認済み）

| 対象 | セレクター・取得方法 |
| --- | --- |
| 投稿候補の行 | `a.jforum-topiclink[data-fid][data-tid]` の最寄りの`tr` |
| 会議室リンク・会議室名 | `a.jforum-forumlink[data-fid]`。名前は`title`属性を優先し、無ければ`textContent` |
| 会議室ID | `forumLink.dataset.fid` → `topicLink.dataset.fid` → ハッシュの`fid` → `null` |
| トピックリンク・トピック名 | `a.jforum-topiclink[data-fid][data-tid]`。名前は`title`属性を優先し、無ければ`textContent` |
| トピックID | `topicLink.dataset.tid` → ハッシュの`tid` → `null` |
| 投稿概要 | `.forum-top-list-memo` |
| 投稿者 | `.forum-top-list-name span` の`title`属性 → 同要素の`textContent` → `.forum-top-list-name` 全体の`textContent` |
| 投稿日時 | `.forum-top-list-date`（例: `07/24 15:14`） |

投稿IDに相当する属性は存在しない（後述の識別キーを参照）。

### 汎用パーサー（実画面未確認のフォールバック）

一般的な業務グループウェアの新着情報一覧を想定した仮の設計であり、実画面での確認は
していない。優先順位は、識別子ベース（`[data-post-id]`等）→ `data-*`属性 →
ラベル文字列・相対DOM構造 → CSSクラス名の順。

### セレクターの安定性

`jforum-topiclink` / `jforum-forumlink` / `forum-top-list-*` はdesknet's NEO
（jForumベース）のテンプレートに由来すると考えられ、同一バージョン内では比較的安定して
いると考えられる。ただしカスタマイズや将来のバージョンアップで変更される可能性はある。

## テキスト抽出の方針

- **投稿概要**: `<br>`要素は改行として扱う。`textContent`だけでは`<br>`の前後が連結
  されてしまうため、`<br>`をテキストノードの改行へ置き換えてから抽出する。通知表示用には
  連続する空白・改行を単一の半角スペースへ正規化し、80〜120文字程度に切り詰める。
  HTMLはそのまま保存・表示せず、`textContent`（＋`<br>`置換）だけを使用する。
- **トピック名**: 照合に完全一致を使うため、前後の空白・改行のみ除去し、内部の連続空白の
  変換・大文字小文字変換・全角半角変換は行わない。
- **投稿日時**: 年が含まれていないため、年の補完は行わず、前後の空白・改行のみ除去して
  識別キーに使用する。

## 未読状態を検知の主軸にしない理由

未読の行には`forum-unread`・`unread`というクラスが付与されている。ただし、desknet's NEO側で
既読状態が変わった後も同じ投稿を安定して識別できるようにするため、新着判定はCSSクラスの
有無ではなく、投稿内容から作った識別キーで行う。

## 新着識別キー

投稿IDに相当する属性が無いため、次の値を組み合わせてSHA-256でハッシュ化したものを
識別キーとする（`src/shared/text-utils.js` の `buildCompositeKeySource`）。

- 会議室ID / トピックID / トピック名 / 投稿者 / 投稿日時 / 投稿概要

同一トピックへの新規投稿によって投稿者・投稿日時・投稿概要のいずれかが変化すれば、
異なる識別キーとなり新着として検知できる。投稿本文や職員名そのものは
`chrome.storage.local` へ保存せず、ハッシュ値だけを保存する。

## 対象トピックの照合

`src/desknets/topic-matcher.js` は、設定側の会議室ID（`fid`）・トピックID（`tid`）と、
新着情報画面から取得した投稿の`roomId`・`topicId`（＝`data-fid`・`data-tid`由来）を
照合する。優先順位は次のとおり。

1. 設定側の`forumId`・`topicId`の両方が、投稿側の`roomId`・`topicId`と一致する
2. `forumId`・`topicId`を持たない設定（旧バージョンからの移行直後など）に限り、
   トピック名の完全一致で照合する
3. 上記のいずれにも一致しない投稿は対象外とする

これにより、電子会議室側でトピック名が変更されても、`fid`・`tid`が変わらなければ同一
トピックとして検知を継続できる。

## トピックURLの解決

トピックリンクの`href`（ハッシュのみの相対URL）を、設定済みの新着情報画面URLに対して
`new URL(href, documentBaseUrl)` で解決する。生成されるURLは元の新着情報画面URLの
オリジン・パス・通常のクエリ文字列を維持し、ハッシュ部分だけがトピック表示用に
置き換わる。

```text
設定URL:
http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on

生成URL:
http://groupware.example.local/scripts/dneo/zforum.exe?cmd=forumlist&log=on#cmd=forumalist&fid=8&tid=2319&init=1
```

通知クリック時・「電子会議室を開く」時は、この生成URLまたは設定URLが、設定済みの
desknet's NEOと同一オリジンであることを検証したうえで開く。

## 未検証の事項

- **ログイン切れ画面・エラー画面・アクセス権限がない場合の画面**: 実機で未確認。
  `src/desknets/authentication-detector.js` の判定は、一般的なグループウェアで見られる
  パターン（`input[type=password]` の存在、「ログイン」「セッション」等のキーワード）に
  もとづくヒューリスティックである。実画面のHTMLを入手できた場合は判定条件を見直すこと。
- **新着情報画面の取得が既読状態に与える影響**: 未検証。本実装はGETリクエストのみを行い、
  POST・更新・削除・既読化APIは一切呼び出していない。ただしdesknet's NEO側の実装に
  よっては閲覧自体が既読化のトリガーになっている可能性があり、その場合は通常の
  ブラウザ操作で画面を開いたときと同じ影響が生じる。

## 画面変更時に確認する箇所

desknet's NEOのバージョンアップやカスタマイズでHTML構造が変わった場合は、次を確認する。

1. `a.jforum-topiclink[data-fid][data-tid]` に相当するトピックへのリンク要素
2. `a.jforum-forumlink[data-fid]` に相当する会議室へのリンク要素
3. `.forum-top-list-memo` / `.forum-top-list-name` / `.forum-top-list-date` に相当する、
   投稿概要・投稿者・投稿日時の要素
4. ハッシュルーティングのパラメーター名（`fid`・`tid`）
5. ログイン切れ・エラー画面のHTML構造

修正が `src/desknets/forum-parser.js` と `src/desknets/authentication-detector.js` の
2ファイルで完結するよう設計している。あわせて
`tests/fixtures/desknets-v6-new-arrivals.html` を実際の画面へ更新し、
`tests/desknets-v6-parser.test.js` で検証すること。
