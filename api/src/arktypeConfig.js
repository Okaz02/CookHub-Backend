const { configure } = require('arktype/config');

// ArkType が返すエラーメッセージは既定では英語（"must be a string"）なので、
// そのままクライアントに返す文言を日本語に差し替える。
//
// この設定は arktype 本体（require('arktype')）を読み込むより先に済ませる必要があり、
// 他のどのモジュールよりも先に読み込まれる config.js の先頭から読み込んでいる。
//
// 差し替えるのは「なぜ弾かれたのか」の一文（problem）だけ。
// 「どの項目が駄目だったのか」は app.js のエラーハンドラが項目名を添えて組み立てる。

// 型の呼び名。エラーの「何を期待していたか」に埋め込まれる
const typeNames = {
    string: '文字列',
    number: '数値',
    boolean: '真偽値',
    object: 'オブジェクト'
};

configure({
    // 宣言していないキーは検証後の値から落とす。
    // フォークと更新は既存のDB行に入力を重ねてから検証するので、これが無いと
    // recipe_id や created_at といった入力ではない列まで db 層に流れてしまう
    onUndeclaredKey: 'delete',

    keywords: typeNames,

    required: { problem: () => '必須です' },
    domain: { problem: (error) => `${error.expected}で指定してください` },
    // 形式の名前（メールアドレス・コミットハッシュ等）は各スキーマが describe で付ける
    pattern: { problem: (error) => `${error.expected}の形式で指定してください` },
    // 1文字以上＝「空でないこと」なので、文字数ではなく未入力として伝える
    minLength: { problem: (error) => (error.rule <= 1 ? '必須です' : `${error.rule}文字以上で指定してください`) },
    maxLength: { problem: (error) => `${error.rule}文字以内で指定してください` },
    min: { problem: (error) => `${error.rule}${error.exclusive ? 'より大きい' : '以上の'}数値で指定してください` },
    max: { problem: (error) => `${error.rule}${error.exclusive ? 'より小さい' : '以下の'}数値で指定してください` },
    divisor: { problem: (error) => (error.rule === 1 ? '整数で指定してください' : `${error.rule}の倍数で指定してください`) }
});
